/* Signed session tokens.
 *
 * The gate runs on every request, including each CSS and JS file, so it has to
 * decide "is this person signed in?" locally — a call out to Supabase per asset
 * would put a network round trip in front of the whole page.
 *
 * So rather than re-verifying Supabase's own access token on each hit, a
 * successful sign-in mints one of these: a compact HMAC-SHA256 token holding
 * only the user id, the email and an expiry. It is verified with WebCrypto in
 * microseconds and needs no key discovery, which also sidesteps the fact that
 * Supabase projects sign their JWTs with either a shared secret or an elliptic
 * key depending on when the project was created.
 *
 * Format is `base64url(json).base64url(hmac)` — deliberately not a JWT, because
 * a JWT header invites a parser to negotiate the algorithm with the attacker.
 * There is exactly one algorithm here and it is not written down in the token.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : '';
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function sign(payload, secret) {
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  );
  return `${body}.${b64urlEncode(signature)}`;
}

/* Returns the payload, or null for anything that is not a currently valid
 * token — bad signature, malformed, or expired. Callers only ever need to know
 * which of those two it is. */
export async function verify(token, secret) {
  if (typeof token !== 'string' || !secret) return null;

  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  let signature;
  try {
    signature = b64urlDecode(token.slice(dot + 1));
  } catch {
    return null;
  }

  // crypto.subtle.verify compares in constant time, so this does not leak the
  // expected signature one byte at a time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(body));
  if (!ok) return null;

  let payload;
  try {
    payload = JSON.parse(decoder.decode(b64urlDecode(body)));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  return payload;
}
