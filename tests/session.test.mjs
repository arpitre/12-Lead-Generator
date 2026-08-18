import assert from 'node:assert';
import { sign, verify } from '../lib/session.js';
import { parseCookies, cookie, isEmail } from '../lib/http.js';

const SECRET = 'test-secret-value-0123456789';
let pass = 0;
const ok = (name) => { pass++; console.log('  ok  ' + name); };

// --- session tokens ---------------------------------------------------
const future = Math.floor(Date.now() / 1000) + 3600;
const token = await sign({ sub: 'u1', email: 'a@b.co', exp: future }, SECRET);

assert.deepStrictEqual((await verify(token, SECRET)).email, 'a@b.co');
ok('valid token round-trips');

assert.strictEqual(await verify(token, 'wrong-secret'), null);
ok('token signed with another secret is rejected');

// Flip one character of the payload, keeping the signature.
const [body, sig] = token.split('.');
const tampered = body.slice(0, -2) + (body.slice(-2, -1) === 'A' ? 'B' : 'A') + body.slice(-1) + '.' + sig;
assert.strictEqual(await verify(tampered, SECRET), null);
ok('tampered payload is rejected');

const expired = await sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
assert.strictEqual(await verify(expired, SECRET), null);
ok('expired token is rejected');

const noExp = await sign({ sub: 'u1' }, SECRET);
assert.strictEqual(await verify(noExp, SECRET), null);
ok('token without an expiry is rejected');

for (const junk of ['', 'abc', 'a.b', '.', 'x.', null, undefined, {}, 'a'.repeat(500)]) {
  assert.strictEqual(await verify(junk, SECRET), null);
}
ok('malformed tokens are rejected without throwing');

// A forged "alg:none"-style JWT must not be mistaken for a session.
const jwt = Buffer.from('{"alg":"none"}').toString('base64url') + '.' +
            Buffer.from(JSON.stringify({ sub: 'admin', exp: future })).toString('base64url') + '.';
assert.strictEqual(await verify(jwt, SECRET), null);
ok('unsigned JWT-shaped token is rejected');

// --- cookies ----------------------------------------------------------
const c = cookie('ekg_session', 'a b+c', { maxAge: 60 });
assert.ok(c.includes('HttpOnly') && c.includes('Secure') && c.includes('SameSite=Lax'), c);
ok('cookies are HttpOnly, Secure and SameSite=Lax');

const req = new Request('https://x.test/', { headers: { cookie: 'ekg_session=a%20b; other=2' } });
assert.strictEqual(parseCookies(req).ekg_session, 'a b');
ok('cookie parsing decodes values');

assert.ok(isEmail('a@b.co') && !isEmail('nope') && !isEmail('a@b') && !isEmail(''));
ok('email shape check');

console.log('\n' + pass + ' assertions passed');
