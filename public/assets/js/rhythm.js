/* rhythm.js — decides WHEN things happen.
 *
 * Atrial activity and ventricular activity are scheduled separately. That is
 * the only honest way to draw AV block: in third-degree block the P waves and
 * the QRS complexes genuinely are two independent metronomes, and the tracing
 * has to show them marching through each other.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  function rnd(seedObj) {
    // Small deterministic PRNG so a shared link always reproduces the same
    // tracing, right down to the artifact.
    seedObj.s = (seedObj.s * 1664525 + 1013904223) >>> 0;
    return seedObj.s / 4294967296;
  }

  // Default rate for each mechanism, used when the user has not overridden it.
  var DEFAULT_RATES = {
    sinus: 75, sinus_brady: 48, sinus_tach: 120, sinus_arrhythmia: 72,
    afib: 110, afib_slow: 70, afib_rvr: 150, aflutter: 150, atach: 170,
    svt: 180, mat: 110, wandering: 70,
    junctional: 48, accel_junctional: 75, junctional_tach: 120,
    idioventricular: 32, aivr: 70, vtach: 170, polymorphic_vt: 220,
    vfib: 0, asystole: 0
  };

  var VENTRICULAR = { idioventricular: 1, aivr: 1, vtach: 1, polymorphic_vt: 1 };
  var JUNCTIONAL = { junctional: 1, accel_junctional: 1, junctional_tach: 1 };

  function isVentricular(r) { return !!VENTRICULAR[r]; }
  function isJunctional(r) { return !!JUNCTIONAL[r]; }

  /* Wenckebach PR ladder: the increment gets smaller each cycle, which is why
   * the R-R intervals actually shorten before the dropped beat. */
  var WENCKEBACH_PR = [140, 210, 255, 280, 295];

  function build(cfg, duration) {
    var seed = { s: (cfg.seed || 12345) >>> 0 };
    var rhythm = cfg.rhythm || 'sinus';
    var rate = cfg.rate || DEFAULT_RATES[rhythm] || 75;
    var out = {
      pWaves: [],      // { t: seconds at P onset, kind: 'sinus'|'retro'|'ectopic' }
      complexes: [],   // { t: seconds at QRS onset, kind, origin, ampScale, paced }
      flutter: null,
      fib: false,
      chaos: null,
      atrialRate: null,
      rhythm: rhythm,
      dropped: 0,
      pacerSpikes: []  // { t, chamber: 'A'|'V', captured: bool }
    };

    if (rhythm === 'vfib') {
      out.chaos = { kind: 'vfib', coarse: cfg.vfCoarse !== false };
      return out;
    }
    if (rhythm === 'asystole') {
      out.chaos = { kind: 'asystole' };
      return out;
    }

    /* ------------------------------------------------ ventricular rhythms */
    if (isVentricular(rhythm)) {
      var vrr = 60 / rate;
      var vt = 0.25;
      var n = 0;
      while (vt < duration) {
        var jitter = rhythm === 'polymorphic_vt' ? (rnd(seed) - 0.5) * 0.12 * vrr : (rnd(seed) - 0.5) * 0.01 * vrr;
        out.complexes.push({
          t: vt + jitter,
          kind: 'ventricular',
          origin: cfg.vtOrigin || 'rv',
          ampScale: rhythm === 'polymorphic_vt'
            ? 0.40 + 0.65 * Math.abs(Math.sin(Math.PI * n / 7))
            : 1,
          axisSpin: rhythm === 'polymorphic_vt' ? Math.sin(Math.PI * n / 7) * 130 : 0
        });
        vt += vrr; n++;
      }
      // Independent sinus P waves marching through the VT is the single most
      // useful clue that a wide tachycardia is ventricular.
      if (cfg.avDissociation) {
        var pp = 60 / (cfg.atrialRate || 85), pt = 0.1;
        out.atrialRate = cfg.atrialRate || 85;
        while (pt < duration) { out.pWaves.push({ t: pt, kind: 'sinus' }); pt += pp; }
      }
      return applyPacing(applyAlternans(out, cfg), cfg, duration, seed);
    }

    /* -------------------------------------------------------- atrial fib */
    if (rhythm === 'afib' || rhythm === 'afib_slow' || rhythm === 'afib_rvr') {
      out.fib = true;
      var mrr = 60 / rate, t = 0.3;
      while (t < duration) {
        out.complexes.push({ t: t, kind: 'supraventricular', ampScale: 1 });
        t += mrr * (0.62 + 1.0 * rnd(seed) * 0.78);
      }
      return applyPacing(applyEctopy(applyAlternans(out, cfg), cfg, duration, seed), cfg, duration, seed);
    }

    /* ----------------------------------------------------- atrial flutter */
    if (rhythm === 'aflutter') {
      var fRate = cfg.flutterRate || 300;
      out.flutter = { rate: fRate };
      out.atrialRate = fRate;
      var ratio = cfg.flutterConduction || 2;
      var fInt = 60 / fRate;
      var vt2 = 0.4, k = 0;
      while (vt2 < duration) {
        out.complexes.push({ t: vt2, kind: 'supraventricular', ampScale: 1 });
        var thisRatio = ratio === 0 ? [2, 3, 4, 2, 4, 3][k % 6] : ratio; // 0 = variable block
        vt2 += fInt * thisRatio;
        k++;
      }
      return applyPacing(applyEctopy(applyAlternans(out, cfg), cfg, duration, seed), cfg, duration, seed);
    }

    /* ------------------------------------- junctional / SVT / atrial tach */
    if (isJunctional(rhythm) || rhythm === 'svt' || rhythm === 'atach') {
      var rr = 60 / rate, t3 = 0.3;
      while (t3 < duration) {
        out.complexes.push({ t: t3, kind: 'supraventricular', ampScale: 1 });
        if (isJunctional(rhythm) && cfg.retrogradeP !== 'none') {
          // Retrograde P: inverted in II/III/aVF, sitting just before or just
          // after the QRS depending on where the focus is.
          var offset = cfg.retrogradeP === 'after' ? 0.055 : -0.075;
          out.pWaves.push({ t: t3 + offset, kind: 'retro' });
        }
        if (rhythm === 'atach') out.pWaves.push({ t: t3 - 0.11, kind: 'ectopic' });
        t3 += rr * (1 + (rnd(seed) - 0.5) * 0.01);
      }
      out.atrialRate = rhythm === 'atach' ? rate : null;
      return applyPacing(applyEctopy(applyAlternans(out, cfg), cfg, duration, seed), cfg, duration, seed);
    }

    /* --------------------------------------- sinus family, with AV block */
    var atrialRate = rate;
    var block = cfg.avblock || 'none';
    if (block === 'third') atrialRate = cfg.atrialRate || 82;

    var pp = 60 / atrialRate;
    out.atrialRate = atrialRate;

    var pt2 = 0.22, idx = 0, wIdx = 0;
    var mobitzRatio = cfg.blockRatio || 3;   // e.g. 3 means 3:2 conduction
    var pTimes = [];
    while (pt2 < duration + pp) {
      var variation = 0;
      if (rhythm === 'sinus_arrhythmia') variation = Math.sin(idx * 0.9) * pp * 0.16;
      else variation = (rnd(seed) - 0.5) * pp * 0.014;
      if (rhythm === 'wandering' || rhythm === 'mat') variation += (rnd(seed) - 0.5) * pp * 0.22;
      var tp = pt2 + variation;
      if (tp < duration) {
        pTimes.push(tp);
        out.pWaves.push({
          t: tp,
          kind: (rhythm === 'wandering' || rhythm === 'mat') ? 'wandering' : 'sinus',
          morph: (rhythm === 'wandering' || rhythm === 'mat') ? idx % 3 : 0
        });
      }
      pt2 += pp; idx++;
    }

    if (block === 'third') {
      // Complete block: the ventricles run their own escape rhythm, entirely
      // unrelated to the P waves.
      var escRate = cfg.escapeRate || (cfg.escapeSite === 'ventricular' ? 32 : 45);
      var err = 60 / escRate, et = 0.45;
      while (et < duration) {
        out.complexes.push({
          t: et,
          kind: cfg.escapeSite === 'ventricular' ? 'ventricular' : 'supraventricular',
          origin: 'rv',
          escape: true,
          ampScale: 1
        });
        et += err;
      }
      out.dropped = 0;
      return applyPacing(applyAlternans(out, cfg), cfg, duration, seed);
    }

    for (var i = 0; i < pTimes.length; i++) {
      var pr;
      if (block === 'first') {
        pr = (cfg.prInterval || 240) / 1000;
      } else if (block === 'mobitz1') {
        var step = wIdx % (mobitzRatio + 1);
        if (step === mobitzRatio) { out.dropped++; wIdx++; continue; }  // dropped QRS
        pr = WENCKEBACH_PR[Math.min(step, WENCKEBACH_PR.length - 1)] / 1000;
        wIdx++;
      } else if (block === 'mobitz2') {
        if ((i + 1) % mobitzRatio === 0) { out.dropped++; continue; }
        pr = 0.19;
      } else if (block === 'twotoone') {
        if (i % 2 === 1) { out.dropped++; continue; }
        pr = 0.18;
      } else {
        pr = (cfg.prInterval || 160) / 1000;
      }
      out.complexes.push({ t: pTimes[i] + pr, kind: 'supraventricular', pIndex: i, pr: pr, ampScale: 1 });
    }

    return applyPacing(applyEctopy(applyAlternans(out, cfg), cfg, duration, seed), cfg, duration, seed);
  }

  /* Electrical alternans: every other QRS is smaller. Classic for a big
   * pericardial effusion, where the heart is literally swinging in fluid. */
  function applyAlternans(out, cfg) {
    if (cfg.pattern !== 'alternans') return out;
    out.complexes.forEach(function (c, i) { c.ampScale = (i % 2 === 0) ? 1 : 0.55; });
    return out;
  }

  function applyEctopy(out, cfg, duration, seed) {
    var mode = cfg.ectopy || 'none';
    if (mode === 'none') return out;

    var base = out.complexes.slice().sort(function (a, b) { return a.t - b.t; });
    var result = [];
    var coupling = 0.44;
    var origins = ['rv', 'lv', 'rvot'];

    function pvcAt(t, originIdx) {
      return { t: t, kind: 'pvc', origin: origins[originIdx % origins.length], ampScale: 1 };
    }

    if (mode === 'bigeminy' || mode === 'trigeminy') {
      var every = mode === 'bigeminy' ? 1 : 2;   // sinus beats between PVCs
      var count = 0, skipNext = 0;
      for (var i = 0; i < base.length; i++) {
        if (skipNext > 0) { skipNext--; continue; }  // P blocked by PVC refractoriness
        result.push(base[i]);
        count++;
        if (count % every === 0) {
          result.push(pvcAt(base[i].t + coupling, 0));
          skipNext = 1;  // compensatory pause
        }
      }
      out.complexes = result;
      return out;
    }

    if (mode === 'pvc_uni' || mode === 'pvc_multi') {
      var nPvc = mode === 'pvc_multi' ? 3 : 2;
      var slots = [];
      for (var k = 0; k < nPvc; k++) slots.push(2 + Math.floor(rnd(seed) * Math.max(1, base.length - 4)));
      for (var j = 0; j < base.length; j++) {
        result.push(base[j]);
        var slotIdx = slots.indexOf(j);
        if (slotIdx >= 0) {
          result.push(pvcAt(base[j].t + coupling, mode === 'pvc_multi' ? slotIdx : 0));
          j++; // the next sinus beat falls in the refractory period
        }
      }
      out.complexes = result;
      return out;
    }

    if (mode === 'couplet' || mode === 'nsvt') {
      var runLen = mode === 'couplet' ? 2 : 5;
      var at = Math.floor(base.length / 2);
      for (var m = 0; m < base.length; m++) {
        result.push(base[m]);
        if (m === at) {
          var rt = base[m].t + coupling;
          for (var q = 0; q < runLen; q++) {
            result.push(pvcAt(rt, 0));
            rt += 0.36;
          }
          m += 2;
        }
      }
      out.complexes = result;
      return out;
    }

    if (mode === 'pac' || mode === 'pjc') {
      var at2 = Math.floor(base.length / 2) - 1;
      for (var n2 = 0; n2 < base.length; n2++) {
        if (n2 === at2) {
          var early = base[n2].t - 0.20;
          result.push({ t: early, kind: 'supraventricular', ectopic: true, ampScale: 1 });
          if (mode === 'pac') out.pWaves.push({ t: early - 0.14, kind: 'ectopic' });
          continue;
        }
        result.push(base[n2]);
      }
      out.complexes = result;
      return out;
    }

    return out;
  }

  function applyPacing(out, cfg, duration, seed) {
    var mode = cfg.pacing || 'none';
    if (mode === 'none') return out;

    var rate = cfg.pacerRate || 70;
    var interval = 60 / rate;
    var spikes = [];
    var complexes = [];
    var t = 0.35;
    var beatNo = 0;

    if (mode === 'demand') {
      // Underlying rhythm paces only when it drops below the set rate: keep
      // the native beats and fill the gaps.
      var native = out.complexes.slice().sort(function (a, b) { return a.t - b.t; });
      var last = -interval;
      var merged = [];
      var ni = 0;
      var cursor = 0.3;
      while (cursor < duration) {
        while (ni < native.length && native[ni].t < cursor) {
          merged.push(native[ni]); last = native[ni].t; ni++;
        }
        if (cursor - last >= interval) {
          spikes.push({ t: cursor, chamber: 'V', captured: true });
          merged.push({ t: cursor + 0.03, kind: 'paced', mode: 'v', ampScale: 1 });
          last = cursor;
        }
        cursor += 0.05;
      }
      while (ni < native.length) { merged.push(native[ni]); ni++; }
      out.complexes = merged.sort(function (a, b) { return a.t - b.t; });
      out.pacerSpikes = spikes;
      return out;
    }

    while (t < duration) {
      beatNo++;
      var captured = true;
      var sensed = true;

      if (mode === 'failure_capture' && beatNo % 3 === 0) captured = false;
      if (mode === 'failure_sense' && beatNo % 4 === 0) sensed = false;

      if (mode === 'atrial') {
        spikes.push({ t: t, chamber: 'A', captured: captured });
        if (captured) {
          out.pWaves.push({ t: t + 0.02, kind: 'paced' });
          complexes.push({ t: t + 0.02 + 0.16, kind: 'supraventricular', ampScale: 1 });
        }
      } else if (mode === 'av_sequential') {
        spikes.push({ t: t, chamber: 'A', captured: captured });
        if (captured) out.pWaves.push({ t: t + 0.02, kind: 'paced' });
        spikes.push({ t: t + 0.17, chamber: 'V', captured: captured });
        if (captured) complexes.push({ t: t + 0.20, kind: 'paced', mode: 'v', ampScale: 1 });
      } else {
        // ventricular or biventricular
        var st = sensed ? t : t - 0.12;   // undersensing: spike lands too early
        spikes.push({ t: st, chamber: 'V', captured: captured && sensed });
        if (captured && sensed) {
          complexes.push({
            t: st + 0.03,
            kind: 'paced',
            mode: mode === 'biventricular' ? 'biv' : 'v',
            ampScale: 1
          });
        }
      }
      t += interval;
    }

    // In a pure pacing mode the native rhythm is suppressed, except for the
    // escape beats you see when capture fails.
    if (mode === 'failure_capture') {
      out.complexes = complexes.concat(out.complexes.filter(function (c) {
        return !spikes.some(function (s) { return Math.abs(s.t - c.t) < 0.35; });
      })).sort(function (a, b) { return a.t - b.t; });
    } else {
      out.complexes = complexes.sort(function (a, b) { return a.t - b.t; });
    }
    out.pacerSpikes = spikes;
    return out;
  }

  EKG.rhythm = {
    build: build,
    DEFAULT_RATES: DEFAULT_RATES,
    isVentricular: isVentricular,
    isJunctional: isJunctional
  };
})(window.EKG);
