import assert from 'node:assert';
import { onRequest } from '../functions/_middleware.js';
import { sign } from '../lib/session.js';

const SECRET = 'test-secret-value-0123456789';
const env = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: SECRET,
  SITE_URL: 'https://ekg.test'
};

let pass = 0;
const ok = (name) => { pass++; console.log('  ok  ' + name); };

const SERVED = new Response('<app>', { status: 200 });
let nextCalls = 0;

function call(path, { cookie, accept = 'text/html', refreshOk = null } = {}) {
  nextCalls = 0;
  globalThis.fetch = async () => {
    if (refreshOk === null) throw new Error('middleware should not have called out');
    return new Response(
      JSON.stringify(refreshOk
        ? { access_token: 'at', refresh_token: 'rt2', user: { id: 'u1', email: 'a@b.co' } }
        : { error: 'invalid_grant' }),
      { status: refreshOk ? 200 : 400, headers: { 'content-type': 'application/json' } }
    );
  };
  const headers = { accept };
  if (cookie) headers.cookie = cookie;
  return onRequest({
    request: new Request('https://ekg.test' + path, { headers }),
    env,
    data: {},
    next: async () => { nextCalls++; return SERVED.clone(); }
  });
}

const live = await sign({ sub: 'u1', email: 'a@b.co', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

// --- the point of the whole exercise ----------------------------------
// Each of these is a direct request for part of the simulator, with no session.
for (const path of ['/', '/index.html', '/assets/js/explain.js', '/assets/js/catalog.js',
                    '/assets/css/app.css', '/12-lead-generator.html', '/api/me']) {
  const res = await call(path, { accept: path.endsWith('.js') ? '*/*' : 'text/html' });
  assert.ok(res.status === 302 || res.status === 401, path + ' returned ' + res.status);
  assert.strictEqual(nextCalls, 0, path + ' reached the static asset');
}
ok('signed out: app, its scripts and the standalone file are all refused');

let res = await call('/assets/js/explain.js', { accept: '*/*' });
assert.strictEqual(res.status, 401);
ok('a direct asset fetch gets 401, not a redirect it would ignore');

res = await call('/', { accept: 'text/html' });
assert.strictEqual(res.status, 302);
assert.strictEqual(res.headers.get('location'), '/login');
ok('signed out: browsing to the app redirects to /login');

res = await call('/some/case?x=1', { accept: 'text/html' });
assert.strictEqual(res.headers.get('location'), '/login?next=%2Fsome%2Fcase%3Fx%3D1');
ok('the requested page is preserved in ?next=');

// --- the allowlist ----------------------------------------------------
for (const path of ['/login', '/login.html', '/login/', '/reset', '/auth/confirm',
                    '/api/login', '/api/signup', '/assets/css/auth.css']) {
  await call(path);
  assert.strictEqual(nextCalls, 1, path + ' was gated but should be public');
}
ok('sign-in surface is reachable while signed out, in every spelling');

// --- signed in --------------------------------------------------------
await call('/assets/js/explain.js', { cookie: 'ekg_session=' + live, accept: '*/*' });
assert.strictEqual(nextCalls, 1);
ok('signed in: the app is served');

// --- forged and stale sessions ---------------------------------------
const forged = await sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }, 'attacker-secret');
res = await call('/', { cookie: 'ekg_session=' + forged });
assert.strictEqual(nextCalls, 0);
assert.strictEqual(res.status, 302);
ok('a session cookie signed with the wrong key does not open the gate');

const stale = await sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
res = await call('/', { cookie: 'ekg_session=' + stale + '; ekg_refresh=rt', refreshOk: true });
assert.strictEqual(nextCalls, 1);
const setCookies = res.headers.getSetCookie();
assert.ok(setCookies.some(c => c.startsWith('ekg_session=')), 'no refreshed session cookie');
assert.ok(setCookies.some(c => c.startsWith('ekg_refresh=')), 'no rotated refresh cookie');
ok('an expired session is refreshed silently and the cookies are rotated');

res = await call('/', { cookie: 'ekg_session=' + stale + '; ekg_refresh=revoked', refreshOk: false });
assert.strictEqual(nextCalls, 0);
assert.strictEqual(res.status, 302);
assert.ok(res.headers.getSetCookie().some(c => c.includes('Max-Age=0')));
ok('a revoked refresh token is refused and the stale cookies are cleared');

console.log('\n' + pass + ' gate checks passed');
