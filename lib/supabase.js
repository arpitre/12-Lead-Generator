/* A thin wrapper over Supabase's auth API (GoTrue).
 *
 * Called only from the server side, so the browser never holds a Supabase
 * token and never talks to Supabase directly. That is the whole reason the
 * anon key can stay in an environment variable instead of shipping inside the
 * page.
 */

/* Whether a variable is absent or merely empty is the difference between "it
 * never reached the runtime" and "it arrived carrying nothing" — a binding that
 * is not wired up versus a value that was saved blank. From inside a deployment
 * those are the only two things distinguishable about a missing setting, and
 * they point at completely different fixes, so the distinction is kept. */
function state(value) {
  if (value === undefined || value === null) return 'absent';
  if (String(value).trim() === '') return 'blank';
  return 'ok';
}

export function config(env) {
  const clean = v => String(v || '').trim().replace(/\/+$/, '');
  return {
    url: clean(env.SUPABASE_URL),
    anonKey: String(env.SUPABASE_ANON_KEY || '').trim(),
    // Trimmed deliberately: a trailing newline off a copy-paste would otherwise
    // become part of the signing key, silently and permanently.
    secret: String(env.SESSION_SECRET || '').trim(),
    siteUrl: clean(env.SITE_URL),
    presence: {
      SUPABASE_URL: state(env.SUPABASE_URL),
      SUPABASE_ANON_KEY: state(env.SUPABASE_ANON_KEY),
      SESSION_SECRET: state(env.SESSION_SECRET)
    }
  };
}

/* Missing configuration is a deployment mistake, not a user error, so it gets
 * its own message rather than being reported as a failed sign-in. */
export function configError(cfg) {
  const presence = cfg.presence || {};
  const name = key => presence[key] === 'blank' ? `${key} (set, but empty)` : `${key} (not set)`;

  const missing = [];
  if (!cfg.url) missing.push(name('SUPABASE_URL'));
  if (!cfg.anonKey) missing.push(name('SUPABASE_ANON_KEY'));
  if (!cfg.secret) missing.push(name('SESSION_SECRET'));
  if (!missing.length) return null;
  return `The server is missing its configuration: ${missing.join(', ')}. See docs/AUTH-SETUP.md.`;
}

/* Supabase issues two generations of key. The legacy `anon` key is itself a
 * JWT; the current publishable key (`sb_publishable_...`) is not.
 *
 * That distinction matters because GoTrue parses the Authorization bearer as a
 * JWT when one is present. Sending a publishable key there earns a 401 that
 * reads like a rejected password, so the bearer is only ever set to something
 * that is actually a token: a real user token when we hold one, the anon key
 * when it is a JWT, and nothing at all otherwise. `apikey` carries the project
 * credential in every case, which is what identifies the project. */
function isJwt(value) {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
}

export async function gotrue(cfg, path, { method = 'POST', body, token } = {}) {
  const headers = { apikey: cfg.anonKey, 'content-type': 'application/json' };
  const bearer = token || (isJwt(cfg.anonKey) ? cfg.anonKey : null);
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  let response;
  try {
    response = await fetch(`${cfg.url}/auth/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    return { ok: false, status: 0, data: null, offline: true };
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

/* GoTrue is inconsistent about which field carries the human-readable reason,
 * so check all of them before falling back. */
export function gotrueMessage(result, fallback) {
  if (result && result.offline) return 'Could not reach the authentication service. Try again in a moment.';
  const data = result && result.data;
  if (!data) return fallback;
  const message = data.msg || data.error_description || data.message ||
    (typeof data.error === 'string' ? data.error : null);
  return message || fallback;
}

/* True when the sign-in failed only because the address has not been confirmed
 * yet — the one failure worth offering a "resend it" button for. */
export function isUnconfirmed(result) {
  const data = (result && result.data) || {};
  if (data.error_code === 'email_not_confirmed') return true;
  return /email not confirmed/i.test(gotrueMessage(result, ''));
}
