/* The signed-in account strip in the header.
 *
 * Kept out of the standalone single-file build on purpose: that build is meant
 * to run from a USB stick with no server behind it, where there is no session
 * to report and nothing to sign out of. The markup ships hidden and only this
 * script reveals it, so the offline build simply never shows an account bar.
 */
(function () {
  'use strict';

  var strip = document.getElementById('account');
  var label = document.getElementById('accountEmail');
  var button = document.getElementById('btnSignOut');
  if (!strip || !label || !button) return;

  fetch('/api/me', { headers: { accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('not signed in');
      return response.json();
    })
    .then(function (data) {
      if (!data || !data.email) return;
      label.textContent = data.email;
      strip.hidden = false;
    })
    .catch(function () {
      /* No session, or no server at all. Either way the header stays as it is —
       * the gate decides who gets in, not this strip. */
    });

  button.addEventListener('click', function () {
    button.disabled = true;
    fetch('/api/logout', { method: 'POST' })
      .catch(function () {})
      .then(function () {
        location.href = '/login';
      });
  });
})();
