import { json, readJson, parseCookies } from '../../lib/http.js';
import { config, configError, gotrue, gotrueMessage } from '../../lib/supabase.js';
import { RECOVERY_COOKIE, signedOutCookies } from '../../lib/auth.js';

const MIN_PASSWORD = 10;

/* Finish a password reset.
 *
 * Authority to do this comes from the recovery cookie, which /auth/confirm set
 * after redeeming the single-use token out of the reset email. The token never
 * reaches the browser, so it cannot be left behind in history or a referrer. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const cfg = config(env);

  const misconfigured = configError(cfg);
  if (misconfigured) return json({ error: misconfigured }, { status: 500 });

  const recoveryToken = parseCookies(request)[RECOVERY_COOKIE];
  if (!recoveryToken) {
    return json(
      { error: 'This reset link has expired. Request a new one.', expired: true },
      { status: 401 }
    );
  }

  const body = await readJson(request);
  const password = String((body && body.password) || '');
  if (password.length < MIN_PASSWORD) {
    return json({ error: `Use a password of at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }

  const result = await gotrue(cfg, '/user', {
    method: 'PUT',
    token: recoveryToken,
    body: { password }
  });

  if (!result.ok) {
    return json(
      { error: gotrueMessage(result, 'Could not set that password. Request a new reset link.') },
      { status: result.status === 429 ? 429 : 400 }
    );
  }

  /* Sign every browser out, including this one. Somebody resetting a password
   * may be doing it because the old one was compromised, and the fix is worth
   * nothing if the existing sessions survive it. */
  return json({ ok: true }, { cookies: signedOutCookies() });
}
