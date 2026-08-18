import { json, readJson, isEmail } from '../../lib/http.js';
import { config, configError, gotrue, gotrueMessage } from '../../lib/supabase.js';

/* Start a password reset. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const cfg = config(env);

  const misconfigured = configError(cfg);
  if (misconfigured) return json({ error: misconfigured }, { status: 500 });

  const body = await readJson(request);
  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.' }, { status: 400 });

  const origin = cfg.siteUrl || new URL(request.url).origin;
  const result = await gotrue(
    cfg,
    `/recover?redirect_to=${encodeURIComponent(`${origin}/reset`)}`,
    { body: { email } }
  );

  if (!result.ok && result.status === 429) {
    return json({ error: gotrueMessage(result, 'Too many emails requested. Wait a minute.') }, { status: 429 });
  }

  // Same reasoning as resend: the answer is identical for a registered address
  // and an unregistered one.
  return json({ ok: true });
}
