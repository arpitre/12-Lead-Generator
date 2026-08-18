/* The gate.
 *
 * This runs in front of every single request to the site. The split it enforces
 * is the whole design: the landing page is public, because a marketing page
 * nobody can read sells nothing, and the simulator is private, because that is
 * the thing worth paying for.
 *
 * Private means private. `/simulator/` is gated, and so is every file it needs
 * — `assets/js/explain.js` is the entire teaching walkthrough, and a login
 * screen that leaves it fetchable is decoration rather than a gate.
 *
 * Everything is private by default. The allowlist below is the complete set of
 * things an unauthenticated visitor can fetch: the landing page and its own
 * assets, and whatever somebody needs in order to sign in, confirm an address,
 * or reset a password. Anything added to `public/` in future is gated until
 * somebody deliberately lists it here.
 */

import { parseCookies, redirect, json } from '../lib/http.js';
import { verify } from '../lib/session.js';
import { config, gotrue } from '../lib/supabase.js';
import { SESSION_COOKIE, REFRESH_COOKIE, sessionCookies, signedOutCookies } from '../lib/auth.js';

const PUBLIC_PATHS = new Set([
  // The landing page and the sign-in surface.
  '/',
  '/login',
  '/reset',
  '/auth/confirm',
  '/api/signup',
  '/api/login',
  '/api/logout',
  '/api/resend',
  '/api/recover',
  '/api/reset',
  // Only the stylesheets those two pages use. `assets/css/app.css` is the
  // simulator's and is deliberately not here.
  '/assets/css/landing.css',
  '/assets/css/auth.css',
  '/favicon.ico',
  '/robots.txt'
]);

/* The landing page's illustrations, and the Open Graph card that link previews
 * fetch without any cookie at all. These are sample tracings rendered to flat
 * images — they give away nothing that the page itself does not already show.
 * Kept to a prefix because it is a whole directory of them; note that no
 * script or stylesheet is reachable this way. */
const PUBLIC_PREFIXES = ['/assets/img/'];

/* Pages serves `login.html` at both `/login` and `/login.html`, and a trailing
 * slash reaches the same asset again. All three spellings have to be treated
 * as one path or the allowlist can be walked around. */
function normalize(pathname) {
  let path = pathname.replace(/\/+$/, '') || '/';
  if (path.endsWith('.html')) path = path.slice(0, -'.html'.length) || '/';
  /* And it serves `public/index.html` at `/` as well as at `/index.html`, so a
   * directory index has to collapse onto its directory or the two spellings of
   * the landing page would land on opposite sides of the gate. */
  if (path.endsWith('/index')) path = path.slice(0, -'index'.length).replace(/\/+$/, '') || '/';
  return path;
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  const path = normalize(url.pathname);

  if (PUBLIC_PATHS.has(path)) return next();
  if (PUBLIC_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) return next();

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

  /* Always carry the destination. `/` is public now, so anything that reaches
   * here is a real page somebody was trying to open — most often a shared case
   * link, which is worth landing them back on after they sign in. */
  const target = encodeURIComponent(url.pathname + url.search);
  return redirect(`/login?next=${target}`, { status: 302, cookies });
}
