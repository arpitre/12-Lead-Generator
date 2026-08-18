import { json, readJson, isEmail } from '../../lib/http.js';
import { config, configError, gotrue, gotrueMessage, isUnconfirmed } from '../../lib/supabase.js';
import { sessionCookies } from '../../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cfg = config(env);

  const misconfigured = configError(cfg);
  if (misconfigured) return json({ error: misconfigured }, { status: 500 });

  const body = await readJson(request);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');

  if (!isEmail(email) || !password) {
    return json({ error: 'Enter your email address and password.' }, { status: 400 });
  }

  const result = await gotrue(cfg, '/token?grant_type=password', { body: { email, password } });

  if (!result.ok || !result.data || !result.data.access_token) {
    if (isUnconfirmed(result)) {
      return json(
        {
          error: 'That address has not been confirmed yet. Check your inbox for the confirmation link.',
          needsVerification: true
        },
        { status: 403 }
      );
    }
    /* Never distinguish "no such account" from "wrong password": the pair of
     * answers is a working list of who has signed up. */
    const status = result.status === 429 ? 429 : 401;
    const fallback = status === 429
      ? 'Too many attempts. Wait a minute and try again.'
      : 'That email address and password do not match.';
    return json({ error: status === 429 ? gotrueMessage(result, fallback) : fallback }, { status });
  }

  return json(
    { ok: true, email: (result.data.user && result.data.user.email) || email },
    { cookies: await sessionCookies(result.data, cfg.secret) }
  );
}
