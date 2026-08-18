import { json, readJson, isEmail } from '../../lib/http.js';
import { config, configError, gotrue, gotrueMessage } from '../../lib/supabase.js';
import { sessionCookies } from '../../lib/auth.js';

/* Passwords are checked for length only. Composition rules ("one capital, one
 * symbol") push people toward Passw0rd! and are no longer recommended by NIST;
 * length is what actually costs an attacker anything. */
const MIN_PASSWORD = 10;

export async function onRequestPost(context) {
  const { request, env } = context;
  const cfg = config(env);

  const misconfigured = configError(cfg);
  if (misconfigured) return json({ error: misconfigured }, { status: 500 });

  const body = await readJson(request);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');

  if (!isEmail(email)) return json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (password.length < MIN_PASSWORD) {
    return json({ error: `Use a password of at least ${MIN_PASSWORD} characters.` }, { status: 400 });
  }

  const origin = cfg.siteUrl || new URL(request.url).origin;
  const result = await gotrue(
    cfg,
    `/signup?redirect_to=${encodeURIComponent(`${origin}/login?confirmed=1`)}`,
    { body: { email, password } }
  );

  if (!result.ok) {
    const status = result.status === 429 ? 429 : 400;
    return json({ error: gotrueMessage(result, 'Could not create that account.') }, { status });
  }

  /* With email confirmation switched on — which is the whole point — Supabase
   * returns a user and no session, and returns the same shape for an address
   * that already exists so the response cannot be used to enumerate accounts.
   * Saying "check your email" in both cases preserves that. */
  const session = result.data && result.data.access_token ? result.data : null;
  if (!session) {
    return json({ ok: true, verify: true, email });
  }

  // Confirmation is disabled on the project, so the account is already usable.
  return json(
    { ok: true, verify: false, email },
    { cookies: await sessionCookies(session, cfg.secret) }
  );
}
