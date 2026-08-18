import { json, parseCookies } from '../../lib/http.js';
import { config, gotrue } from '../../lib/supabase.js';
import { REFRESH_COOKIE, signedOutCookies } from '../../lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cfg = config(env);
  const refreshToken = parseCookies(request)[REFRESH_COOKIE];

  /* Clearing the cookies is what signs this browser out. Revoking the refresh
   * token upstream matters for any session opened elsewhere, so it is worth
   * attempting — but a failure here must not leave someone stuck signed in. */
  if (refreshToken && cfg.url && cfg.anonKey) {
    const refreshed = await gotrue(cfg, '/token?grant_type=refresh_token', {
      body: { refresh_token: refreshToken }
    });
    if (refreshed.ok && refreshed.data && refreshed.data.access_token) {
      await gotrue(cfg, '/logout', { token: refreshed.data.access_token });
    }
  }

  return json({ ok: true }, { cookies: signedOutCookies() });
}
