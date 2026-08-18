/* A thin wrapper over Supabase's auth API (GoTrue).
 *
 * Called only from the server side, so the browser never holds a Supabase
 * token and never talks to Supabase directly. That is the whole reason the
 * anon key can stay in an environment variable instead of shipping inside the
 * page.
 */

export function config(env) {
  const trim = v => String(v || '').replace(/\/+$/, '');
  return {
    url: trim(env.SUPABASE_URL),
    anonKey: String(env.SUPABASE_ANON_KEY || ''),
    secret: String(env.SESSION_SECRET || ''),
    siteUrl: trim(env.SITE_URL)
  };
}

/* Missing configuration is a deployment mistake, not a user error, so it gets
 * its own message rather than being reported as a failed sign-in. */
export function configError(cfg) {
  const missing = [];
  if (!cfg.url) missing.push('SUPABASE_URL');
  if (!cfg.anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!cfg.secret) missing.push('SESSION_SECRET');
  if (!missing.length) return null;
  return `The server is missing its configuration (${missing.join(', ')}). See docs/AUTH-SETUP.md.`;
}

export async function gotrue(cfg, path, { method = 'POST', body, token } = {}) {
  let response;
  try {
    response = await fetch(`${cfg.url}/auth/v1${path}`, {
      method,
      headers: {
        apikey: cfg.anonKey,
        authorization: `Bearer ${token || cfg.anonKey}`,
        'content-type': 'application/json'
      },
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
