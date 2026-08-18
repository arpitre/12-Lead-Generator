import { json, readJson, isEmail } from '../../lib/http.js';
import { config, configError, gotrue, gotrueMessage } from '../../lib/supabase.js';

/* Re-send the confirmation email for an address that signed up but never
 * clicked the link. Supabase applies its own per-address rate limit, which is
 * why a 429 is passed through with its real message. */
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
    `/resend?redirect_to=${encodeURIComponent(`${origin}/login?confirmed=1`)}`,
    { body: { type: 'signup', email } }
  );

  if (!result.ok && result.status === 429) {
    return json({ error: gotrueMessage(result, 'Too many emails requested. Wait a minute.') }, { status: 429 });
  }

  // Any other outcome reports success: whether an address is registered is not
  // something an unauthenticated caller gets to find out.
  return json({ ok: true });
}
