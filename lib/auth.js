/* Cookie names, lifetimes, and the one function that turns a Supabase session
 * into the cookies this app runs on. */

import { sign } from './session.js';
import { cookie, clearCookie } from './http.js';

export const SESSION_COOKIE = 'ekg_session';
export const REFRESH_COOKIE = 'ekg_refresh';
export const RECOVERY_COOKIE = 'ekg_recovery';

/* Short-lived, because it is verified offline: revoking someone takes effect
 * when this expires and the refresh below is refused. */
export const SESSION_TTL = 60 * 60;              // 1 hour
export const REFRESH_TTL = 60 * 60 * 24 * 30;    // 30 days
export const RECOVERY_TTL = 15 * 60;             // 15 minutes

export async function sessionCookies(supabaseSession, secret) {
  const user = (supabaseSession && supabaseSession.user) || {};
  const token = await sign(
    {
      sub: user.id || null,
      email: user.email || null,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL
    },
    secret
  );

  const cookies = [cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL })];
  if (supabaseSession && supabaseSession.refresh_token) {
    cookies.push(cookie(REFRESH_COOKIE, supabaseSession.refresh_token, { maxAge: REFRESH_TTL }));
  }
  return cookies;
}

export function signedOutCookies() {
  return [clearCookie(SESSION_COOKIE), clearCookie(REFRESH_COOKIE), clearCookie(RECOVERY_COOKIE)];
}
