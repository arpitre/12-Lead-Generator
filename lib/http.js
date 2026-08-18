/* Small response helpers for the Pages Functions.
 *
 * Everything here is deliberately dependency-free: these run in the Workers
 * runtime, where the standard library is fetch, Headers, Response and
 * WebCrypto. Nothing needs a bundler beyond what Pages already does.
 */

function build(extra, cookies) {
  const h = new Headers(extra || {});
  // Nothing behind the auth layer may be cached by a shared proxy.
  h.set('cache-control', 'no-store');
  for (const c of cookies || []) h.append('set-cookie', c);
  return h;
}

export function json(data, { status = 200, cookies = [], headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: build({ 'content-type': 'application/json; charset=utf-8', ...headers }, cookies)
  });
}

export function redirect(location, { status = 303, cookies = [], headers = {} } = {}) {
  return new Response(null, { status, headers: build({ location, ...headers }, cookies) });
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/* Session cookies are HttpOnly so no script — ours or an injected one — can
 * read them, Secure so they never travel in the clear, and Lax so a link from
 * an email still arrives authenticated while a cross-site POST does not. */
export function cookie(name, value, { maxAge, path = '/' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAge !== undefined) bits.push(`Max-Age=${Math.floor(maxAge)}`);
  return bits.join('; ');
}

export function clearCookie(name, path = '/') {
  return cookie(name, '', { maxAge: 0, path });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/* Deliberately loose. The authoritative check on whether an address exists is
 * whether the confirmation email arrives, so this only catches typos that are
 * certainly wrong. */
export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
