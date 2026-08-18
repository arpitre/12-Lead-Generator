# Putting the simulator behind a login

The app itself has not changed. What changed is where it is served from, and
which half of the site is public.

The landing page stays open to everybody — it has to, since it is what sells the
thing. The simulator at `/simulator/` does not, and neither does any file it
needs. A visitor with no account sees the landing page and a login form; that is
all.

This is a one-time setup of about half an hour. You need a Supabase account
(free) and a Cloudflare account (free).

---

## Why the hosting had to move

GitHub Pages serves static files and runs no code, so it cannot check anything
before serving a file. A login screen written in front-end JavaScript would be
decoration: a student who opened `assets/js/explain.js` directly would have the
entire teaching walkthrough without ever seeing it.

Cloudflare Pages serves the same static files but lets a small function run
first. That function — `functions/_middleware.js` — is the gate, and everything
under `public/` is private by default.

One thing to be clear-eyed about: anyone who is *legitimately signed in* can
still save the JavaScript out of their browser. No browser app can prevent
that. The gate stops non-customers from getting in; it is not copy protection.

---

## 1. Create the Supabase project

1. At [supabase.com](https://supabase.com), create a project. Any region near
   your students is fine.
2. **Project URL.** Supabase moved this out of the API screen; it is under
   **Project Settings → Data API**, or you can read it off the dashboard
   address bar — the project reference is in the URL, and the value you want is
   `https://<project-ref>.supabase.co`.

   That screen displays the **REST** endpoint, ending `/rest/v1/`. The value
   wanted here is the bare project URL with no path. Pasting the REST endpoint
   is handled — the trailing service prefix is trimmed off — but it is worth
   knowing which one you are looking at.
3. **Project key.** **Project Settings → API Keys**. Take the **publishable**
   key (`sb_publishable_...`) from the *Publishable and secret API keys* tab.
   The legacy `anon` key on the other tab also works and is what older setups
   use.

   Do **not** use a **secret** key (`sb_secret_...`) or the legacy
   `service_role` key. Those bypass row-level security and can administer the
   project; nothing here needs that, and a mistake with one is unrecoverable.

Both go into Cloudflare in step 4. The project key is only ever used
server-side here, so it never appears in the page.

## 2. Turn on email confirmation

**Authentication → Sign In / Providers → Email**:

- **Enable email provider** — on
- **Confirm email** — **on**. This is what makes people verify their address.
- **Secure email change** — on
- **Minimum password length** — 10, to match what the sign-up form enforces

**Authentication → URL Configuration**:

- **Site URL** — your real address, e.g. `https://ekg.yourdomain.com`
- **Redirect URLs** — add `https://ekg.yourdomain.com/**`

## 3. Point the email templates at the app

This step is **required**, particularly for the password reset. Supabase's
default templates hand the token to the browser in a URL fragment; these send it
to the server instead, where it is redeemed once and exchanged for a session
cookie. The token never lands in browser history or a Referer header.

**Authentication → Emails → Templates**.

**Confirm signup** — replace the link line with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm your email address</a>
```

**Reset password** — replace the link line with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a>
```

If you skip the reset template, the reset link will land on the page and then
report that it has expired, because no token ever reached the server.

Write the rest of the email in your own words — students trust a message that
names your programme more than a default one.

## 4. Deploy to Cloudflare Pages

1. At [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages →
   Create → Pages → Connect to Git**, and pick this repository.
2. Build settings:
   - **Framework preset** — None
   - **Build command** — leave empty
   - **Build output directory** — `public`
3. Add these environment variables (**Settings → Environment variables**), for
   both Production and Preview:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL from step 1 |
   | `SUPABASE_ANON_KEY` | the publishable (or legacy anon) key from step 1 |
   | `SESSION_SECRET` | a long random string — see below |
   | `SITE_URL` | `https://ekg.yourdomain.com` — optional; defaults to the origin the request arrived on, so it can be left out until a custom domain is attached |

   Generate the secret with:

   ```bash
   node -e "console.log(crypto.randomBytes(48).toString('base64url'))"
   ```

   Keep it secret and do not commit it. Anyone holding it can mint a session
   cookie for any account. Changing it signs everybody out, which is exactly
   what you want if it ever leaks.

4. Deploy, then attach your custom domain under **Custom domains**. Set
   `SITE_URL` and Supabase's Site URL to that domain, not the `.pages.dev` one,
   or the links in the emails will point at the wrong place.

Test on the `.pages.dev` URL first. The domain move below is the step that is
awkward to undo in a hurry.

## 4b. Move the domain, and turn GitHub Pages off

**Do not skip the second half of this.** The repository still contains a
`CNAME` file, and GitHub Pages will happily keep serving `12leadsimulator.com`
from `main` — the whole simulator, no gate, no account. Two live copies of the
site, one of them free, is not a login.

In order:

1. In **Cloudflare Pages → Custom domains**, add the domain. Cloudflare will
   walk you through moving the nameservers if the domain is not already on your
   account.
2. Once the Pages deployment answers on the domain, go to the GitHub repository
   → **Settings → Pages** and set **Source: None**. That unpublishes the old
   site.
3. Delete the `CNAME` file from `main`, so a future Pages build cannot silently
   reclaim the domain.
4. Only then make the repository private, if you want to. Cloudflare keeps
   building a private repo; GitHub Pages on the free plan does not, which is
   what took the site down the first time.

Until step 2 is done, assume anything you can reach at the domain might be the
ungated GitHub copy rather than the gated Cloudflare one. Check which you are
looking at by requesting `/assets/js/explain.js` — Cloudflare answers 401,
GitHub Pages hands over the file.

## 5. Check it end to end

In a private window:

1. Visit the site — the **landing page should load normally**, images and all.
   It is public on purpose.
2. Click **Open the simulator**. *Now* you should land on `/login`.
3. Ask for `https://your-site/assets/js/explain.js` directly. You should get a
   401, not the file. **This is the check that matters.** If that file comes
   back, the gate is not running — confirm the build output directory is
   `public` and that `functions/` sits at the repository root.
4. Create an account. You should be told to check your email, and *not* be
   signed in.
5. Try to sign in before clicking the link — it should refuse and offer to
   resend the email.
6. Click the confirmation link. You should land in the simulator, signed in.
7. Sign out — you should be returned to the landing page, not the login form.
8. Run through "Forgot your password?" and set a new one.

---

## Before you charge for it

**Send your own email.** Supabase's built-in email is rate-limited and meant for
development — a handful of messages an hour, from an address you do not control.
Once real students sign up, set up [Resend](https://resend.com) or
[Postmark](https://postmarkapp.com), verify your domain with SPF and DKIM, and
enter the SMTP details under **Project Settings → Authentication → SMTP
Settings**. A confirmation email in a spam folder is a support request.

**Make the repository private.** It is public today, so the whole app is a fork
away. Note that anything already published under MIT stays MIT for those
commits — you can change the licence going forward, but you cannot recall the
copies that already exist.

**Stop publishing the standalone file.** `12-lead-generator.html` is the entire
simulator in one file with no gate. Keep it for offline teaching, but do not put
it anywhere public.

**Then add billing.** The gate already answers "who is this?". Charging means
answering "have they paid?" as well: a Stripe Checkout flow, a webhook that
records the subscription against the user, and one extra condition in
`functions/_middleware.js`. The account layer is the prerequisite, and it is
worth running on its own first — you will learn more from watching who signs up
than from guessing at a price.

---

## How it fits together

```
functions/
  _middleware.js      the gate — runs before every request
  api/signup.js       create an account, trigger the confirmation email
  api/login.js        exchange email + password for a session cookie
  api/logout.js       clear the cookies, revoke the refresh token
  api/resend.js       re-send a confirmation email
  api/recover.js      start a password reset
  api/reset.js        finish a password reset
  api/me.js           who is signed in (used by the header)
  auth/confirm.js     where the links in the emails land
lib/
  session.js          HMAC-signed session tokens
  supabase.js         thin client over Supabase's auth API
  auth.js             cookie names and lifetimes
  http.js             response and cookie helpers
public/               private by default; the allowlist names the exceptions
  index.html            the landing page          — public
  login.html            sign in / sign up / reset — public
  reset.html            set a new password        — public
  simulator/index.html  the app                   — GATED
  assets/css/landing.css, assets/img/*            — public
  assets/css/app.css, assets/js/*                 — GATED
tests/                run with `npm test`
```

The split lives in one place: `PUBLIC_PATHS` and `PUBLIC_PREFIXES` at the top of
`functions/_middleware.js`. Anything not named there is gated, so a file added
to `public/` later is private until somebody decides otherwise. That default is
the right way round — the failure mode is a stylesheet that needs a login, not a
simulator that does not.

Three cookies, all `HttpOnly` and `Secure`:

- **`ekg_session`** (1 hour) — the signed proof of who you are. Verified
  locally, so the gate adds no network round trip to a page load.
- **`ekg_refresh`** (30 days) — Supabase's refresh token. When the session
  expires the gate swaps it silently, so nobody is thrown out mid-case. This is
  also where a deleted or revoked account stops working.
- **`ekg_recovery`** (15 minutes) — set only by a password-reset link, and good
  for exactly one thing: setting a new password.

### Running the tests

```bash
npm test
```

They cover the gate's behaviour with forged, expired and missing cookies, and
the account flows against a stubbed Supabase. No project or network needed.
