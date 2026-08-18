/* Where the links in Supabase's emails land.
 *
 * Both the confirmation email and the password-reset email point here with a
 * single-use token. Redeeming it server-side means the token is spent on this
 * hop and the browser is left holding an ordinary session cookie instead of
 * credentials in a URL — which would otherwise sit in history, in the address
 * bar, and in the Referer header of the next request.
 *
 * This requires the two email templates in the Supabase dashboard to point at
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`.
 * docs/AUTH-SETUP.md has the exact text.
 */

import { redirect, cookie } from '../../lib/http.js';
import { config, configError, gotrue } from '../../lib/supabase.js';
import { RECOVERY_COOKIE, RECOVERY_TTL, sessionCookies, signedOutCookies } from '../../lib/auth.js';

const RECOVERY_TYPES = new Set(['recovery']);
const KNOWN_TYPES = new Set(['signup', 'email', 'magiclink', 'recovery', 'invite', 'email_change']);

function bounce(message) {
  return redirect(`/login?error=${encodeURIComponent(message)}`, { status: 302, cookies: signedOutCookies() });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const cfg = config(env);

  if (configError(cfg)) return bounce('The server is not configured yet. Contact whoever runs this site.');

  const url = new URL(request.url);
  // `token_hash` is the current parameter; `token` covers a default template
  // that was never customised.
  const tokenHash = url.searchParams.get('token_hash') || url.searchParams.get('token');
  const requestedType = url.searchParams.get('type') || 'email';
  const type = KNOWN_TYPES.has(requestedType) ? requestedType : 'email';

  if (!tokenHash) {
    return bounce('That link is missing its confirmation token. Request a new email.');
  }

  const result = await gotrue(cfg, '/verify', { body: { type, token_hash: tokenHash } });

  if (!result.ok || !result.data || !result.data.access_token) {
    /* These tokens are single-use and short-lived, so the overwhelmingly
     * common cause is a link that was already clicked or has aged out. */
    return bounce('That link has expired or has already been used. Request a new one.');
  }

  if (RECOVERY_TYPES.has(type)) {
    /* A reset link proves control of the inbox, not knowledge of the password,
     * so it buys exactly one thing: fifteen minutes in which to set a new
     * password. It is deliberately not a full session. */
    return redirect('/reset', {
      status: 302,
      cookies: [cookie(RECOVERY_COOKIE, result.data.access_token, { maxAge: RECOVERY_TTL })]
    });
  }

  // A confirmed address signs straight in — no reason to make somebody who
  // just proved they own the inbox type their password again. Straight to the
  // simulator, not the landing page: they have just finished signing up, so
  // being sold to again would be an odd welcome.
  return redirect('/simulator/', { status: 302, cookies: await sessionCookies(result.data, cfg.secret) });
}
