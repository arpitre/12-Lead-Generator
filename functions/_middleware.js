/* The gate.
 *
 * This runs in front of every single request to the site — the page, every
 * stylesheet, every one of the ten simulator scripts. Nothing under public/
 * reaches the browser until it has passed through here, which is the whole
 * difference between requiring a login and merely displaying one. A login
 * screen written in front-end JavaScript can be skipped by requesting
 * assets/js/explain.js directly; this cannot.
 *
 * Everything is private by default. The allowlist below is the complete set of
 * things an unauthenticated visitor can fetch, and it exists only so that
 * somebody can sign in, confirm an address, or reset a password.
 */

import { parseCookies, redirect, json } from '../lib/http.js';
import { verify } from '../lib/session.js';
import { config, gotrue } from '../lib/supabase.js';
import { SESSION_COOKIE, REFRESH_COOKIE, sessionCookies, signedOutCookies } from '../lib/auth.js';

const PUBLIC_PATHS = new Set([
  '/login',
  '/reset',
  '/auth/confirm',
  '/api/signup',
  '/api/login',
  '/api/logout',
  '/api/resend',
  '/api/recover',
  '/api/reset',
  '/assets/css/auth.css',
  '/favicon.ico',
  '/robots.txt'
]);

/* Pages serves `login.html` at both `/login` and `/login.html`, and a trailing
 * slash reaches the same asset again. All three spellings have to be treated
 * as one path or the allowlist can be walked around. */
function normalize(pathname) {
  let path = pathname.replace(/\/+$/, '') || '/';
  if (path.endsWith('.html')) path = path.slice(0, -'.html'.length) || '/';
  return path;
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  const path = normalize(url.pathname);

  if (PUBLIC_PATHS.has(path)) return next();

  const cfg = config(env);
  const cookies = parseCookies(request);

  const session = await verify(cookies[SESSION_COOKIE], cfg.secret);
  if (session) {
    data.user = session;
    return next();
  }

  /* The session cookie lives an hour but the refresh token lives a month, so
   * most expiries should be invisible: swap it silently and carry on rather
   * than throwing somebody back to the login screen mid-case. This is also the
   * point where a revoked or deleted account stops working, since Supabase
   * refuses the refresh. */
  const refreshToken = cookies[REFRESH_COOKIE];
  if (refreshToken && cfg.url && cfg.anonKey && cfg.secret) {
    const refreshed = await gotrue(cfg, '/token?grant_type=refresh_token', {
      body: { refresh_token: refreshToken }
    });

    if (refreshed.ok && refreshed.data && refreshed.data.access_token) {
      const user = refreshed.data.user || {};
      data.user = { sub: user.id || null, email: user.email || null };

      const response = await next();
      const out = new Response(response.body, response);
      for (const c of await sessionCookies(refreshed.data, cfg.secret)) {
        out.headers.append('set-cookie', c);
      }
      return out;
    }
  }

  return denied(request, url);
}

function denied(request, url) {
  const cookies = signedOutCookies();
  const accept = request.headers.get('accept') || '';

  // A fetch from the app should get a status it can act on; only a browser
  // navigating to a page benefits from being sent somewhere.
  if (!accept.includes('text/html')) {
    return json({ error: 'Not signed in.' }, { status: 401, cookies });
  }

  const target = encodeURIComponent(url.pathname + url.search);
  const suffix = url.pathname === '/' ? '' : `?next=${target}`;
  return redirect(`/login${suffix}`, { status: 302, cookies });
}
