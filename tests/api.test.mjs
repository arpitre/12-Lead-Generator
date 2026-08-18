import assert from 'node:assert';
import { onRequestPost as signup } from '../functions/api/signup.js';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestPost as recover } from '../functions/api/recover.js';
import { onRequestPost as reset } from '../functions/api/reset.js';
import { onRequestGet as confirm } from '../functions/auth/confirm.js';
import { verify } from '../lib/session.js';
import { gotrue } from '../lib/supabase.js';

const SECRET = 'test-secret-value-0123456789';
const env = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SESSION_SECRET: SECRET,
  SITE_URL: 'https://ekg.test'
};

let pass = 0;
const ok = (n) => { pass++; console.log('  ok  ' + n); };
let seen = [];

function stub(status, body) {
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

const post = (fn, body, cookie) => {
  seen = [];
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return fn({ request: new Request('https://ekg.test/x', { method: 'POST', headers, body: JSON.stringify(body) }), env });
};

const SESSION = { access_token: 'at', refresh_token: 'rt', user: { id: 'u1', email: 'a@b.co' } };

// --- signup -----------------------------------------------------------
stub(200, { id: 'u1', email: 'a@b.co' });                       // no session => confirmation required
let res = await post(signup, { email: 'A@B.co ', password: 'a-long-passphrase' });
let body = await res.json();
assert.strictEqual(res.status, 200);
assert.strictEqual(body.verify, true);
assert.strictEqual(res.headers.getSetCookie().length, 0, 'signup must not sign anyone in');
assert.strictEqual(seen[0].body.email, 'a@b.co', 'email should be trimmed and lowercased');
assert.ok(seen[0].url.includes('redirect_to='), 'confirmation redirect not passed to Supabase');
ok('signup asks for confirmation and grants no session');

res = await post(signup, { email: 'a@b.co', password: 'short' });
assert.strictEqual(res.status, 400);
ok('signup rejects a password under 10 characters');

res = await post(signup, { email: 'nope', password: 'a-long-passphrase' });
assert.strictEqual(res.status, 400);
ok('signup rejects a malformed address');

// --- login ------------------------------------------------------------
stub(200, SESSION);
res = await post(login, { email: 'a@b.co', password: 'a-long-passphrase' });
let cookies = res.headers.getSetCookie();
const session = cookies.find(c => c.startsWith('ekg_session=')).split(';')[0].slice('ekg_session='.length);
assert.deepStrictEqual((await verify(decodeURIComponent(session), SECRET)).email, 'a@b.co');
assert.ok(cookies.some(c => c.startsWith('ekg_refresh=')));
ok('login mints a verified session cookie and stores the refresh token');

stub(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
res = await post(login, { email: 'a@b.co', password: 'a-long-passphrase' });
body = await res.json();
assert.strictEqual(body.needsVerification, true);
ok('an unconfirmed address is reported as such, so the resend button appears');

stub(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
res = await post(login, { email: 'ghost@b.co', password: 'whatever-long' });
body = await res.json();
assert.strictEqual(res.status, 401);
assert.match(body.error, /do not match/);
assert.ok(!/user|exist|found/i.test(body.error), 'reply hints at whether the account exists');
ok('a bad sign-in cannot be used to discover who has an account');

// --- password reset ---------------------------------------------------
stub(200, {});
res = await post(recover, { email: 'ghost@b.co' });
assert.strictEqual(res.status, 200);
ok('a reset request answers the same way for any address');

// The email link lands on /auth/confirm, which spends the token server-side.
seen = [];
stub(200, SESSION);
res = await confirm({ request: new Request('https://ekg.test/auth/confirm?token_hash=abc&type=recovery'), env });
assert.strictEqual(res.status, 302);
assert.strictEqual(res.headers.get('location'), '/reset');
cookies = res.headers.getSetCookie();
assert.ok(cookies.some(c => c.startsWith('ekg_recovery=')), 'no recovery cookie');
assert.ok(!cookies.some(c => c.startsWith('ekg_session=')), 'a reset link must not grant a full session');
assert.strictEqual(seen[0].body.token_hash, 'abc');
ok('a reset link buys a recovery cookie only, never a session');

res = await confirm({ request: new Request('https://ekg.test/auth/confirm?token_hash=abc&type=signup'), env });
assert.strictEqual(res.headers.get('location'), '/simulator/');
assert.ok(res.headers.getSetCookie().some(c => c.startsWith('ekg_session=')));
ok('a confirmation link signs the new account in and lands in the simulator');

stub(401, { msg: 'Token has expired or is invalid' });
res = await confirm({ request: new Request('https://ekg.test/auth/confirm?token_hash=old&type=signup'), env });
assert.match(res.headers.get('location'), /^\/login\?error=/);
ok('a spent or expired link is bounced to /login with an explanation');

res = await post(reset, { password: 'a-long-passphrase' });
assert.strictEqual(res.status, 401);
assert.strictEqual((await res.json()).expired, true);
ok('setting a password without a recovery cookie is refused');

stub(200, { id: 'u1' });
res = await post(reset, { password: 'a-long-passphrase' }, 'ekg_recovery=rectoken');
assert.strictEqual(res.status, 200);
assert.strictEqual(seen[0].body.password, 'a-long-passphrase');
assert.ok(res.headers.getSetCookie().every(c => c.includes('Max-Age=0')), 'reset must end every session');
ok('a completed reset signs every session out');

// --- misconfiguration -------------------------------------------------
res = await login({ request: new Request('https://ekg.test/x', { method: 'POST', body: '{}' }), env: {} });
assert.strictEqual(res.status, 500);
assert.match((await res.json()).error, /missing its configuration/);
ok('a server missing its keys says so instead of failing as a bad password');


// --- the two generations of Supabase project key ----------------------
// The legacy `anon` key is a JWT; the current publishable key is not. GoTrue
// parses the Authorization bearer as a JWT when one is present, so sending the
// publishable key there earns a 401 that reads exactly like a wrong password.
const LEGACY_ANON = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl';
const PUBLISHABLE = 'sb_publishable_k8ym3XZwwPLYnlJkqVvelw';

stub(200, {});
seen = [];
await gotrue({ url: 'https://proj.supabase.co', anonKey: PUBLISHABLE }, '/token', { body: {} });
assert.strictEqual(seen[0].headers.apikey, PUBLISHABLE, 'the project key must always be sent as apikey');
assert.ok(!seen[0].headers.authorization, 'a publishable key must not be sent as a bearer token');
ok('a publishable key identifies the project without posing as a JWT');

seen = [];
await gotrue({ url: 'https://proj.supabase.co', anonKey: LEGACY_ANON }, '/token', { body: {} });
assert.strictEqual(seen[0].headers.authorization, 'Bearer ' + LEGACY_ANON);
ok('a legacy anon key is still sent as the bearer, as GoTrue expects');

seen = [];
await gotrue({ url: 'https://proj.supabase.co', anonKey: PUBLISHABLE }, '/user', { token: 'user-access-token' });
assert.strictEqual(seen[0].headers.authorization, 'Bearer user-access-token');
assert.strictEqual(seen[0].headers.apikey, PUBLISHABLE);
ok("a real user token always wins the bearer, whichever key format is configured");

console.log('\n' + pass + ' API checks passed');
