/* app.js — UI wiring: controls, blind mode, explanation, sharing, printing. */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var C = EKG.catalog;
  var state = {
    cfg: null,
    result: null,
    interp: null,
    explanation: null,
    blind: false,
    revealed: false,
    calipers: false,
    highlight: []
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Minimal inline formatting for the explanation text: **bold** only.
  function fmt(s) {
    return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  /* ------------------------------------------------------- build panel */

  function buildControls() {
    var host = $('controls');
    host.innerHTML = '';
    C.CONTROLS.forEach(function (group) {
      var fs = document.createElement('fieldset');
      fs.className = 'ctl-group';
      var lg = document.createElement('legend');
      lg.textContent = group.group;
      fs.appendChild(lg);

      group.fields.forEach(function (f) {
        var wrap = document.createElement('div');
        wrap.className = 'ctl-field';
        wrap.dataset.field = f.id;

        var lab = document.createElement('label');
        lab.setAttribute('for', 'f_' + f.id);
        lab.textContent = f.label;
        var input;

        if (f.type === 'checkbox') {
          wrap.classList.add('ctl-check');
          input = document.createElement('input');
          input.type = 'checkbox';
          input.id = 'f_' + f.id;
          wrap.appendChild(input);
          wrap.appendChild(lab);
        } else if (f.type === 'number') {
          input = document.createElement('input');
          input.type = 'number';
          input.id = 'f_' + f.id;
          if (f.min !== undefined) input.min = f.min;
          if (f.max !== undefined) input.max = f.max;
          if (f.step !== undefined) input.step = f.step;
          wrap.appendChild(lab);
          wrap.appendChild(input);
        } else {
          input = document.createElement('select');
          input.id = 'f_' + f.id;
          (f.options || []).forEach(function (o) {
            if (o && o.g) {
              var og = document.createElement('optgroup');
              og.label = o.g;
              o.o.forEach(function (x) {
                var opt = document.createElement('option');
                opt.value = x[0]; opt.textContent = x[1];
                og.appendChild(opt);
              });
              input.appendChild(og);
            } else {
              var opt2 = document.createElement('option');
              opt2.value = o[0]; opt2.textContent = o[1];
              input.appendChild(opt2);
            }
          });
          wrap.appendChild(lab);
          wrap.appendChild(input);
        }

        if (f.hint) {
          var h = document.createElement('p');
          h.className = 'ctl-hint';
          h.textContent = f.hint;
          wrap.appendChild(h);
        }

        input.addEventListener('change', function () {
          onControlChange(f);
        });
        fs.appendChild(wrap);
      });
      host.appendChild(fs);
    });
  }

  function onControlChange(field) {
    var cfg = readControls();

    // Changing the rhythm should move the rate to something sensible for it,
    // unless the user has deliberately set one.
    if (field.id === 'rhythm') {
      var def = EKG.rhythm.DEFAULT_RATES[cfg.rhythm];
      if (def) { cfg.rate = def; $('f_rate').value = def; }
    }
    state.cfg = cfg;
    applyVisibility(cfg);
    $('presetSelect').value = '';
    generate();
  }

  /* Fields declare when they are relevant (showIf / showIfNot). Hiding the
   * irrelevant ones keeps the panel from presenting a student with, say, a
   * flutter conduction ratio on a sinus rhythm. */
  function applyVisibility(cfg) {
    C.CONTROLS.forEach(function (group) {
      group.fields.forEach(function (f) {
        var wrap = document.querySelector('.ctl-field[data-field="' + f.id + '"]');
        if (!wrap) return;
        var show = true;
        if (f.showIf) {
          Object.keys(f.showIf).forEach(function (k) {
            if (f.showIf[k].map(String).indexOf(String(cfg[k])) === -1) show = false;
          });
        }
        if (f.showIfNot) {
          Object.keys(f.showIfNot).forEach(function (k) {
            if (f.showIfNot[k].map(String).indexOf(String(cfg[k])) !== -1) show = false;
          });
        }
        wrap.hidden = !show;
      });
    });
  }

  function readControls() {
    var cfg = {};
    Object.keys(C.DEFAULTS).forEach(function (k) { cfg[k] = C.DEFAULTS[k]; });
    if (state.cfg) Object.keys(state.cfg).forEach(function (k) { cfg[k] = state.cfg[k]; });

    C.CONTROLS.forEach(function (group) {
      group.fields.forEach(function (f) {
        var input = $('f_' + f.id);
        if (!input) return;
        if (f.type === 'checkbox') cfg[f.id] = input.checked;
        else if (f.type === 'number') cfg[f.id] = Number(input.value);
        else if (f.type === 'number-select') cfg[f.id] = Number(input.value);
        else cfg[f.id] = input.value;
      });
    });
    return cfg;
  }

  function writeControls(cfg) {
    C.CONTROLS.forEach(function (group) {
      group.fields.forEach(function (f) {
        var input = $('f_' + f.id);
        if (!input) return;
        var v = cfg[f.id];
        if (v === undefined) v = C.DEFAULTS[f.id];
        if (f.type === 'checkbox') input.checked = !!v;
        else input.value = v;
      });
    });
    applyVisibility(cfg);
  }

  /* ---------------------------------------------------------- presets */

  function buildPresets() {
    var sel = $('presetSelect');
    sel.innerHTML = '<option value="">— Custom / build your own below —</option>';
    var byCat = {};
    C.PRESETS.forEach(function (p, i) {
      (byCat[p.category] = byCat[p.category] || []).push([i, p.label]);
    });
    Object.keys(byCat).forEach(function (cat) {
      var og = document.createElement('optgroup');
      og.label = cat;
      byCat[cat].forEach(function (row) {
        var o = document.createElement('option');
        o.value = row[0]; o.textContent = row[1];
        og.appendChild(o);
      });
      sel.appendChild(og);
    });

    var scope = $('randomScope');
    scope.innerHTML = '<option value="">Any topic</option>';
    Object.keys(byCat).forEach(function (cat) {
      var o = document.createElement('option');
      o.value = cat; o.textContent = cat;
      scope.appendChild(o);
    });

    sel.addEventListener('change', function () {
      if (sel.value === '') return;
      loadPreset(C.PRESETS[Number(sel.value)]);
    });
  }

  function loadPreset(preset) {
    state.cfg = C.fromPreset(preset);
    state.presetLabel = preset.label;
    state.teaching = preset.teaching;
    writeControls(state.cfg);
    var idx = C.PRESETS.indexOf(preset);
    if (idx >= 0) $('presetSelect').value = String(idx);
    generate();
  }

  function randomCase() {
    var scope = $('randomScope').value;
    var pool = C.PRESETS.filter(function (p) { return !scope || p.category === scope; });
    if (!pool.length) pool = C.PRESETS;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    $('presetSelect').value = String(C.PRESETS.indexOf(pick));
    loadPreset(pick);
    // A random case is most useful unseen.
    if (!state.blind) setBlind(true);
    else { state.revealed = false; applyBlindUi(); }
  }

  /* -------------------------------------------------------- generate */

  function generate() {
    var cfg = state.cfg || readControls();
    if (cfg.seed === undefined || cfg.seed === null) cfg.seed = Math.floor(Math.random() * 1e9);
    state.cfg = cfg;

    state.result = EKG.generator.generate(cfg);
    state.explanation = EKG.explain.build(state.result);
    state.interp = state.explanation.interp;
    state.highlight = [];

    drawTracing();
    drawExplanation();
    updateCaseLabel();
    updateHash();
  }

  function drawTracing() {
    var host = $('tracing');
    var hideAnswers = state.blind && !state.revealed;
    host.innerHTML = EKG.render.render(state.result, {
      blind: hideAnswers,
      interp: state.interp,
      highlight: state.highlight
    });
    var svg = host.querySelector('svg');
    EKG.calipers.attach(svg, $('caliperReadout'));
    EKG.calipers.setActive(state.calipers);
  }

  function updateCaseLabel() {
    var hideAnswers = state.blind && !state.revealed;
    var el = $('caseTitle');
    if (hideAnswers) {
      el.textContent = 'Unknown tracing — interpret it';
      el.className = 'case-title blind';
    } else {
      el.textContent = state.presetLabel || (state.interp ? state.interp.lines[0] : 'Custom case');
      el.className = 'case-title';
    }
  }

  /* ----------------------------------------------------- explanation */

  function drawExplanation() {
    var host = $('explanation');
    host.innerHTML = '';

    if (state.blind && !state.revealed) {
      host.innerHTML = '<div class="blind-hold">' +
        '<h2>Blind mode</h2>' +
        '<p>Everything that would give the answer away is hidden: the measurement block, ' +
        'the monitor\'s interpretation, the case name and all of the controls.</p>' +
        '<p>Work the tracing in order — rate, rhythm, axis, intervals, morphology, ST segments — ' +
        'then reveal.</p>' +
        '<button id="btnRevealInline" class="btn btn-primary btn-lg">Reveal interpretation</button>' +
        '</div>';
      $('btnRevealInline').addEventListener('click', function () { setRevealed(true); });
      return;
    }

    if (state.teaching) {
      var t = document.createElement('div');
      t.className = 'teaching-note';
      t.innerHTML = '<strong>Teaching point.</strong> ' + fmt(state.teaching);
      host.appendChild(t);
    }

    var summary = document.createElement('div');
    summary.className = 'exp-summary';
    summary.innerHTML = '<h2>Interpretation</h2><ul>' +
      state.interp.lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('') +
      '</ul>' + (state.interp.alert
        ? '<p class="exp-alert">' + escapeHtml(state.interp.alert) + '</p>' : '');
    host.appendChild(summary);

    var h = document.createElement('h2');
    h.textContent = 'Why — step by step';
    host.appendChild(h);

    state.explanation.sections.forEach(function (sec, i) {
      var d = document.createElement('details');
      d.className = 'exp-section';
      if (i < 2) d.open = true;

      var sum = document.createElement('summary');
      sum.innerHTML = '<span class="exp-step">' + (i + 1) + '</span>' +
        '<span class="exp-title">' + escapeHtml(sec.title) + '</span>' +
        '<span class="exp-headline">' + escapeHtml(sec.headline) + '</span>';
      d.appendChild(sum);

      var body = document.createElement('div');
      body.className = 'exp-body';
      sec.body.forEach(function (p) {
        var el = document.createElement('p');
        el.innerHTML = fmt(p);
        body.appendChild(el);
      });

      if (sec.leads && sec.leads.length) {
        var btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = 'Highlight ' + sec.leads.join(', ') + ' on the tracing';
        btn.addEventListener('click', function () {
          var same = state.highlight.join() === sec.leads.join();
          state.highlight = same ? [] : sec.leads;
          drawTracing();
          if (!same) $('tracing').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        body.appendChild(btn);
      }

      d.appendChild(body);
      host.appendChild(d);
    });

    var disc = document.createElement('p');
    disc.className = 'disclaimer';
    disc.textContent = 'Simulated waveform for education only. Generated tracings are physiologic ' +
      'approximations, not recordings from real patients, and must never be used for clinical decisions.';
    host.appendChild(disc);
  }

  /* -------------------------------------------------------- blind mode */

  function setBlind(on) {
    state.blind = on;
    state.revealed = false;
    applyBlindUi();
  }

  function setRevealed(on) {
    state.revealed = on;
    applyBlindUi();
  }

  function applyBlindUi() {
    var hide = state.blind && !state.revealed;
    document.body.classList.toggle('is-blind', hide);
    $('btnBlind').setAttribute('aria-pressed', String(state.blind));
    $('btnBlind').textContent = state.blind ? 'Blind mode: on' : 'Blind mode: off';
    $('btnReveal').hidden = !state.blind;
    $('btnReveal').textContent = state.revealed ? 'Hide the answer again' : 'Reveal interpretation';
    drawTracing();
    drawExplanation();
    updateCaseLabel();
    updateHash();
  }

  /* ------------------------------------------------------------ share */

  function encodeCfg(cfg) {
    var diff = {};
    Object.keys(cfg).forEach(function (k) {
      if (k === 'seed') { diff[k] = cfg[k]; return; }
      if (cfg[k] !== C.DEFAULTS[k]) diff[k] = cfg[k];
    });
    if (state.presetLabel) diff._p = state.presetLabel;
    var json = JSON.stringify(diff);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCfg(str) {
    try {
      var b = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var obj = JSON.parse(decodeURIComponent(escape(atob(b))));
      var cfg = {};
      Object.keys(C.DEFAULTS).forEach(function (k) { cfg[k] = C.DEFAULTS[k]; });
      Object.keys(obj).forEach(function (k) { if (k !== '_p') cfg[k] = obj[k]; });
      return { cfg: cfg, preset: obj._p };
    } catch (e) {
      return null;
    }
  }

  function updateHash() {
    if (!state.cfg) return;
    var h = 'c=' + encodeCfg(state.cfg);
    if (state.blind && !state.revealed) h += '&blind=1';
    state.hash = h;
    // Sandboxed frames (and file:// in some browsers) reject history writes.
    // Sharing still works from state.hash, so a failure here is not fatal.
    try {
      history.replaceState(null, '', '#' + h);
    } catch (e) { /* keep the case in memory instead */ }
  }

  function shareLink() {
    updateHash();
    // Build the URL from state rather than location.href, so the link is still
    // correct when the page could not write to history.
    var base = location.href.split('#')[0];
    var url = base + '#' + (state.hash || '');
    var box = $('shareBox');
    var input = $('shareUrl');
    input.value = url;
    box.hidden = false;
    input.select();
    try {
      navigator.clipboard.writeText(url).then(function () {
        $('shareNote').textContent = 'Link copied. It reproduces this exact tracing, artifact and all.';
      }, function () {
        $('shareNote').textContent = 'Copy the link above — it reproduces this exact tracing.';
      });
    } catch (e) {
      $('shareNote').textContent = 'Copy the link above — it reproduces this exact tracing.';
    }
  }

  function loadFromHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return false;
    var params = {};
    h.split('&').forEach(function (kv) {
      var p = kv.split('=');
      params[p[0]] = decodeURIComponent(p.slice(1).join('='));
    });
    if (!params.c) return false;
    var d = decodeCfg(params.c);
    if (!d) return false;
    state.cfg = d.cfg;
    state.presetLabel = d.preset || '';
    var match = C.PRESETS.filter(function (p) { return p.label === d.preset; })[0];
    state.teaching = match ? match.teaching : '';
    if (match) $('presetSelect').value = String(C.PRESETS.indexOf(match));
    writeControls(state.cfg);
    state.blind = params.blind === '1';
    state.revealed = false;
    return true;
  }

  /* ------------------------------------------------------------- init */

  function init() {
    buildPresets();
    buildControls();

    $('btnGenerate').addEventListener('click', function () {
      state.cfg = readControls();
      state.cfg.seed = Math.floor(Math.random() * 1e9);
      $('presetSelect').value = '';
      state.presetLabel = '';
      state.teaching = '';
      generate();
    });

    $('btnRandom').addEventListener('click', randomCase);

    $('btnBlind').addEventListener('click', function () { setBlind(!state.blind); });
    $('btnReveal').addEventListener('click', function () { setRevealed(!state.revealed); });

    $('btnCalipers').addEventListener('click', function () {
      state.calipers = !state.calipers;
      $('btnCalipers').setAttribute('aria-pressed', String(state.calipers));
      $('btnCalipers').textContent = state.calipers ? 'Calipers: on' : 'Calipers: off';
      $('caliperReadout').hidden = !state.calipers;
      EKG.calipers.setActive(state.calipers);
    });

    $('btnShare').addEventListener('click', shareLink);
    $('btnPrint').addEventListener('click', function () { window.print(); });
    $('btnCloseShare').addEventListener('click', function () { $('shareBox').hidden = true; });

    $('btnPanel').addEventListener('click', function () {
      document.body.classList.toggle('panel-open');
      $('btnPanel').setAttribute('aria-expanded',
        String(document.body.classList.contains('panel-open')));
    });

    var loaded = loadFromHash();
    if (!loaded) {
      loadPreset(C.PRESETS[0]);
    } else {
      generate();
    }
    applyBlindUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  EKG.app = { state: state, generate: generate, loadPreset: loadPreset };
})(window.EKG);
