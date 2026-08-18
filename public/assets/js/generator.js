/* generator.js — assembles the actual signal.
 *
 * Pipeline:
 *   1. schedule the beats (rhythm.js)
 *   2. build a morphology template for each beat type (morphology.js)
 *   3. paint the cardiac vector into vx/vy/vz over the whole strip
 *   4. project that vector onto every lead axis
 *   5. add per-lead extras, artifact and noise
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var L = EKG.leads, M = EKG.morphology;
  var FS = 500;              // samples per second
  var DURATION = 10.0;       // seconds — one standard 12-lead page

  var OVERLAY_SHAPES = {
    bump: M.SHAPES.bump,
    covedST: function (u) { return 1 - 1.9 * Math.pow(u, 0.7); }
  };

  function makeRng(seed) {
    var s = (seed || 1) >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function zeros(n) { return new Float32Array(n); }

  /* Paint one vector lobe into the buffers. t0/t1 are seconds. */
  function paint(vx, vy, vz, fs, t0, t1, amp, dir, shapeFn) {
    var i0 = Math.max(0, Math.round(t0 * fs));
    var i1 = Math.min(vx.length - 1, Math.round(t1 * fs));
    var span = i1 - i0;
    if (span <= 0) return;
    for (var i = i0; i <= i1; i++) {
      var v = shapeFn((i - i0) / span) * amp;
      vx[i] += v * dir[0];
      vy[i] += v * dir[1];
      vz[i] += v * dir[2];
    }
  }

  function renderP(tpl, tP, kind, morph, buf, fs) {
    if (tpl.pAmp <= 0 && kind !== 'paced') return;
    var dir = tpl.pDir.slice();
    var amp = tpl.pAmp;
    var dur = tpl.pDur / 1000;
    var shape = M.SHAPES[tpl.pShape] || M.SHAPES.p;

    if (kind === 'retro') {
      // Retrograde conduction lights up the atria from below: the P vector
      // flips, giving inverted P waves in II, III and aVF.
      dir = L.scale(dir, -1);
      amp = 0.11; dur = 0.07;
    } else if (kind === 'ectopic') {
      dir = L.unit([dir[0] * 0.4 + 0.3, dir[1] * 0.7, dir[2] - 0.3]);
    } else if (kind === 'paced') {
      dir = L.unit([0.35, 0.9, -0.1]);
      amp = 0.13; dur = 0.09;
    } else if (kind === 'wandering') {
      var spin = [0, -35, 40][morph || 0];
      dir = L.axisDir(60 + spin, -0.15 + (morph || 0) * 0.15);
    }
    paint(buf.vx, buf.vy, buf.vz, fs, tP, tP + dur, amp, dir, shape);
  }

  function renderComplex(tpl, tQRS, buf, fs, opts, overlayOut) {
    opts = opts || {};
    var gain = (tpl.globalGain || 1) * (opts.ampScale || 1);
    var qrsEnd = tQRS + tpl.qrsDur / 1000;
    var tStart = qrsEnd + tpl.stSeg / 1000;
    var tEnd = tStart + tpl.tDur / 1000;

    // PR-segment depression (pericarditis): a small shift between P and QRS.
    if (tpl.prSegmentShift && tpl.pr > 0) {
      var prSegStart = tQRS - (tpl.pr - tpl.pDur) / 1000;
      paint(buf.vx, buf.vy, buf.vz, fs, prSegStart, tQRS,
        tpl.prSegmentShift * gain, L.unit([0.3, 0.72, -0.62]),
        function () { return 1; });
    }

    // QRS lobes.
    for (var i = 0; i < tpl.lobes.length; i++) {
      var lo = tpl.lobes[i];
      var dir = lo.dir;
      if (opts.axisSpin) {
        // Torsades: the axis twists around the baseline beat to beat.
        dir = L.axisDir(L.frontalAxis(dir) + opts.axisSpin, dir[2]);
      }
      paint(buf.vx, buf.vy, buf.vz, fs,
        tQRS + lo.t0 / 1000, tQRS + lo.t1 / 1000,
        lo.amp * gain, dir, M.SHAPES[lo.shape] || M.SHAPES.bump);
    }

    /* Injury current. It begins before the QRS finishes, so the terminal limb
     * lands on an already-elevated J point (see M.stEnvelope). */
    var stMag = Math.sqrt(tpl.stVec[0] * tpl.stVec[0] + tpl.stVec[1] * tpl.stVec[1] + tpl.stVec[2] * tpl.stVec[2]);
    if (stMag > 1e-4) {
      var stDir = L.unit(tpl.stVec);
      // From QRS onset: the offset builds as depolarisation sweeps through.
      var sStart = Math.round((qrsEnd - tpl.qrsDur / 1000 - 0.005) * fs);
      var sEnd = Math.round(tEnd * fs);
      for (var s = Math.max(0, sStart); s <= sEnd && s < buf.vx.length; s++) {
        var v = M.stEnvelope(tpl, s / fs, qrsEnd, tStart, tEnd) * stMag * gain;
        if (v === 0) continue;
        buf.vx[s] += v * stDir[0];
        buf.vy[s] += v * stDir[1];
        buf.vz[s] += v * stDir[2];
      }
    }

    // T wave.
    if (tpl.tAmp > 0) {
      paint(buf.vx, buf.vy, buf.vz, fs, tStart, tEnd,
        tpl.tAmp * gain, tpl.tDir, M.SHAPES[tpl.tShape] || M.SHAPES.t);
    }

    /* An additional repolarisation vector over the same window, added to the
     * normal T rather than replacing it. Used for the Wellens patterns, where
     * a purely posterior vector confines the abnormality to the chest leads. */
    if (tpl.tExtra && tpl.tExtra.amp) {
      paint(buf.vx, buf.vy, buf.vz, fs, tStart, tEnd,
        tpl.tExtra.amp * gain, L.unit(tpl.tExtra.dir),
        M.SHAPES[tpl.tExtra.shape] || M.SHAPES.tSym);
    }

    // U wave (hypokalemia).
    if (tpl.uAmp > 0) {
      paint(buf.vx, buf.vy, buf.vz, fs, tEnd + 0.03, tEnd + 0.03 + tpl.uDur / 1000,
        tpl.uAmp * gain, tpl.tDir, M.SHAPES.u);
    }

    // Per-lead extras get queued for after projection.
    if (overlayOut && tpl.overlays) {
      tpl.overlays.forEach(function (ov) {
        var start = ov.t0 === 'j' ? qrsEnd : (ov.t0 === 'tStart' ? tStart : tQRS + (ov.t0 || 0) / 1000);
        overlayOut.push({
          leads: ov.leads, t0: start, t1: start + ov.dur / 1000,
          amp: ov.amp * gain, shape: ov.shape
        });
      });
    }
  }

  /* ---------------------------------------------------------- artifact */

  function addArtifact(leadData, leadNames, cfg, rng, fs) {
    var kind = cfg.artifact || 'none';
    var n = leadData[leadNames[0]].length;

    // Every real tracing has a little noise; a perfectly clean one looks fake.
    var baseNoise = cfg.noise === undefined ? 0.012 : cfg.noise;
    if (baseNoise > 0) {
      leadNames.forEach(function (name) {
        var d = leadData[name], prev = 0;
        for (var i = 0; i < n; i++) {
          var w = (rng() - 0.5) * baseNoise * 2;
          prev = prev * 0.6 + w * 0.4;          // low-pass: looks like real noise
          d[i] += prev;
        }
      });
    }

    if (kind === 'none') return;

    if (kind === 'wander') {
      leadNames.forEach(function (name, li) {
        var d = leadData[name];
        var f1 = 0.18 + li * 0.011, ph = rng() * 6.28, a = 0.16 + rng() * 0.10;
        for (var i = 0; i < n; i++) d[i] += Math.sin(2 * Math.PI * f1 * i / fs + ph) * a;
      });
    } else if (kind === 'tremor') {
      // Muscle tremor: fast, spiky, worst in the limb leads.
      leadNames.forEach(function (name) {
        var limb = name.length <= 3 && name[0] !== 'V';
        var a = limb ? 0.09 : 0.035;
        var d = leadData[name];
        for (var i = 0; i < n; i++) {
          d[i] += (rng() - 0.5) * a * (1 + Math.sin(2 * Math.PI * 8 * i / fs));
        }
      });
    } else if (kind === 'ac60') {
      leadNames.forEach(function (name) {
        var d = leadData[name], ph = rng() * 6.28;
        for (var i = 0; i < n; i++) d[i] += Math.sin(2 * Math.PI * 60 * i / fs + ph) * 0.055;
      });
    } else if (kind === 'loose_lead') {
      var target = cfg.looseLead || 'III';
      var d2 = leadData[target];
      if (d2) {
        var start = Math.round(n * 0.25), stop = Math.round(n * 0.62), v = 0;
        for (var i2 = start; i2 < stop; i2++) {
          v = v * 0.9 + (rng() - 0.5) * 0.9;
          d2[i2] += v + Math.sin(i2 / 7) * 0.4;
        }
      }
    }
  }

  /* --------------------------------------------------- lead mix-ups */

  function applyLeadSwaps(leadData, cfg) {
    var n = leadData.I.length, i;
    if (cfg.artifact === 'la_ra_reversal' || cfg.artifact === 'dextrocardia') {
      // Swapping the arm electrodes inverts lead I and trades II with III
      // (and aVR with aVL). aVF is untouched — that is the giveaway.
      for (i = 0; i < n; i++) leadData.I[i] = -leadData.I[i];
      var tmp = leadData.II; leadData.II = leadData.III; leadData.III = tmp;
      var tmp2 = leadData.aVR; leadData.aVR = leadData.aVL; leadData.aVL = tmp2;
    }
  }

  /* ------------------------------------------------------ measurements */

  function netQrsVector(tpl) {
    var v = [0, 0, 0];
    tpl.lobes.forEach(function (lo) {
      var area = lo.amp * (lo.t1 - lo.t0) * 0.5;
      v[0] += area * lo.dir[0]; v[1] += area * lo.dir[1]; v[2] += area * lo.dir[2];
    });
    return v;
  }

  function generate(cfg) {
    cfg = cfg || {};
    var fs = FS, duration = DURATION;
    var n = Math.round(fs * duration);
    var rng = makeRng(cfg.seed || 20250817);

    var sched = EKG.rhythm.build(cfg, duration);

    // The beat template needs the cycle length so repolarisation can be
    // scaled to the rate before anything is drawn.
    var schedTimes = sched.complexes.map(function (c) { return c.t; }).sort(function (a, b) { return a - b; });
    var preRR = schedTimes.length > 1
      ? (schedTimes[schedTimes.length - 1] - schedTimes[0]) / (schedTimes.length - 1)
      : 0.8;
    var tpl = M.build(cfg, preRR);

    /* Which beat is the tracing actually made of? Measurements, axis and ST
     * analysis all have to come from the dominant complex — reporting a 95 ms
     * QRS during ventricular tachycardia because that is what the sinus
     * template says would be worse than useless. */
    var dominantKind = 'supraventricular';
    var dominantTpl = tpl;
    var pacedV = ['ventricular', 'biventricular', 'av_sequential', 'failure_capture', 'failure_sense'];
    if (EKG.rhythm.isVentricular(cfg.rhythm)) {
      dominantKind = 'ventricular';
      dominantTpl = M.ventricularTemplate(cfg, cfg.vtOrigin || 'rv');
    } else if (cfg.avblock === 'third' && cfg.escapeSite === 'ventricular') {
      dominantKind = 'ventricular';
      dominantTpl = M.ventricularTemplate(cfg, 'rv');
    } else if (cfg.pacing && pacedV.indexOf(cfg.pacing) !== -1) {
      dominantKind = 'paced';
      dominantTpl = M.pacedTemplate(cfg, cfg.pacing === 'biventricular' ? 'biv' : 'v');
    }
    if (dominantTpl !== tpl) {
      M.adaptToRate(dominantTpl, preRR);
      dominantTpl.qt = Math.round(dominantTpl.qrsDur + dominantTpl.stSeg + dominantTpl.tDur);
    }

    var leadNames = L.STANDARD_12.slice();
    if (cfg.extraLeads === 'right') leadNames = leadNames.concat(['V4R', 'V5R', 'V6R']);
    if (cfg.extraLeads === 'posterior') leadNames = leadNames.concat(['V7', 'V8', 'V9']);

    /* Two source buffers: normally-conducted activity, and ventricular or
     * paced activity. They are projected with different per-lead gains
     * because a broad muscle-to-muscle wavefront couples to the chest
     * electrodes very differently from a compact His-Purkinje dipole. */
    var buf = { vx: zeros(n), vy: zeros(n), vz: zeros(n) };
    var bufV = { vx: zeros(n), vy: zeros(n), vz: zeros(n) };
    var overlays = [];

    if (sched.chaos && sched.chaos.kind === 'vfib') {
      var amp = sched.chaos.coarse ? 0.85 : 0.18;
      var ph1 = 0, ph2 = 0, ph3 = 0;
      for (var i = 0; i < n; i++) {
        ph1 += (4.5 + Math.sin(i / 900) * 1.6) * 2 * Math.PI / fs;
        ph2 += (7.3 + Math.cos(i / 640) * 2.1) * 2 * Math.PI / fs;
        ph3 += (2.7 + Math.sin(i / 1400) * 0.9) * 2 * Math.PI / fs;
        var v = (Math.sin(ph1) * 0.6 + Math.sin(ph2) * 0.3 + Math.sin(ph3) * 0.5) * amp;
        buf.vx[i] += v * 0.5; buf.vy[i] += v * 0.75; buf.vz[i] += v * 0.35;
      }
    } else if (sched.chaos && sched.chaos.kind === 'asystole') {
      // nothing but the noise added later
    } else {
      // Continuous atrial activity (flutter or fibrillation) runs underneath
      // everything else.
      if (sched.flutter) {
        var fDir = L.unit([-0.20, -0.90, -0.30]);
        var period = 60 / sched.flutter.rate;
        for (var f = 0; f < n; f++) {
          var u = ((f / fs) % period) / period;
          var sv = u < 0.78 ? (0.45 - (u / 0.78) * 1.35) : (-0.90 + ((u - 0.78) / 0.22) * 1.35);
          buf.vx[f] += sv * 0.20 * fDir[0];
          buf.vy[f] += sv * 0.20 * fDir[1];
          buf.vz[f] += sv * 0.20 * fDir[2];
        }
      }
      if (sched.fib) {
        var fibDir = L.unit([0.2, 0.8, -0.2]);
        var acc = 0;
        for (var g = 0; g < n; g++) {
          acc = acc * 0.72 + (rng() - 0.5) * 0.5;
          var famp = (cfg.rhythm === 'afib_slow' ? 0.05 : 0.085);
          buf.vx[g] += acc * famp * fibDir[0];
          buf.vy[g] += acc * famp * fibDir[1];
          buf.vz[g] += acc * famp * fibDir[2];
        }
      }

      sched.pWaves.forEach(function (p) {
        renderP(tpl, p.t, p.kind, p.morph, buf, fs);
      });

      sched.complexes.forEach(function (c) {
        var t = tpl, target = buf;
        if (c.kind === 'pvc' || c.kind === 'ventricular') {
          t = M.ventricularTemplate(cfg, c.origin || 'rv');
          M.adaptToRate(t, preRR);
          target = bufV;
        } else if (c.kind === 'paced') {
          t = M.pacedTemplate(cfg, c.mode);
          M.adaptToRate(t, preRR);
          target = bufV;
        }
        renderComplex(t, c.t, target, fs, { ampScale: c.ampScale, axisSpin: c.axisSpin }, overlays);
      });
    }

    /* In dextrocardia the heart is a mirror image, so the chest electrodes sit
     * on the wrong side of it: R waves get smaller across the precordium
     * instead of larger. Mirroring the left-right component of each chest
     * lead reproduces that exactly. */
    function leadVector(name) {
      var u = L.VECTORS[name];
      if (cfg.artifact === 'dextrocardia' && name.charAt(0) === 'V') return [-u[0], u[1], u[2]];
      return u;
    }

    // ----- project the vector onto every lead
    var leadData = {};
    leadNames.forEach(function (name) {
      var u = leadVector(name);
      var gain = L.QRS_GAIN[name] || 1;
      var vGain = L.VENT_GAIN[name] || 1;
      var d = zeros(n);
      for (var i = 0; i < n; i++) {
        d[i] = (buf.vx[i] * u[0] + buf.vy[i] * u[1] + buf.vz[i] * u[2]) * gain +
               (bufV.vx[i] * u[0] + bufV.vy[i] * u[1] + bufV.vz[i] * u[2]) * vGain;
      }
      leadData[name] = d;
    });

    /* The injury current was projected with the QRS gain, which over-states it
     * in the chest leads. Correct each precordial lead by the ratio of the two
     * gain tables, applied only to the slow ST component. */
    leadNames.forEach(function (name) {
      var qg = L.QRS_GAIN[name] || 1, sg = L.ST_GAIN[name] || 1;
      if (Math.abs(qg - sg) < 1e-6) return;
      var u = leadVector(name);
      var stMag = Math.sqrt(tpl.stVec[0] * tpl.stVec[0] + tpl.stVec[1] * tpl.stVec[1] + tpl.stVec[2] * tpl.stVec[2]);
      if (stMag < 1e-4) return;
      var stDir = L.unit(tpl.stVec);
      var proj = L.dot(stDir, u);
      var d = leadData[name];
      sched.complexes.forEach(function (c) {
        if (c.kind === 'pvc' || c.kind === 'ventricular' || c.kind === 'paced') return;
        var qrsEnd = c.t + tpl.qrsDur / 1000;
        var tStart = qrsEnd + tpl.stSeg / 1000;
        var tEnd = tStart + tpl.tDur / 1000;
        var sStart = Math.round((qrsEnd - tpl.qrsDur / 1000 - 0.005) * fs);
        var sEnd = Math.round(tEnd * fs);
        for (var s = Math.max(0, sStart); s <= sEnd && s < n; s++) {
          d[s] += M.stEnvelope(tpl, s / fs, qrsEnd, tStart, tEnd) * stMag * proj * (sg - qg);
        }
      });
    });

    // ----- per-lead overlays (Brugada coving, Wellens biphasic T, ...)
    overlays.forEach(function (ov) {
      var shape = OVERLAY_SHAPES[ov.shape] || OVERLAY_SHAPES.bump;
      ov.leads.forEach(function (name) {
        var d = leadData[name];
        if (!d) return;
        var i0 = Math.round(ov.t0 * fs), i1 = Math.round(ov.t1 * fs);
        var span = i1 - i0;
        if (span <= 0) return;
        for (var i = i0; i <= i1 && i < n; i++) {
          if (i < 0) continue;
          d[i] += shape((i - i0) / span) * ov.amp;
        }
      });
    });

    applyLeadSwaps(leadData, cfg);
    addArtifact(leadData, leadNames, cfg, rng, fs);

    // ----- measurements
    var qrsTimes = sched.complexes.map(function (c) { return c.t; }).sort(function (a, b) { return a - b; });
    var rrs = [];
    for (var q = 1; q < qrsTimes.length; q++) rrs.push(qrsTimes[q] - qrsTimes[q - 1]);
    var meanRR = rrs.length ? rrs.reduce(function (a, b) { return a + b; }, 0) / rrs.length : 0;
    var hr = meanRR > 0 ? Math.round(60 / meanRR) : 0;

    var rrMin = rrs.length ? Math.min.apply(null, rrs) : 0;
    var rrMax = rrs.length ? Math.max.apply(null, rrs) : 0;
    var rrSpread = meanRR ? (rrMax - rrMin) / meanRR : 0;

    var hasP = sched.pWaves.length > 0 && tpl.pAmp > 0;
    var conducted = sched.complexes.some(function (c) { return c.pr; });
    var qt = Math.round(dominantTpl.qt);
    var qtc = meanRR > 0 ? Math.round(qt / Math.sqrt(meanRR)) : qt;

    var netQrs = netQrsVector(dominantTpl);

    var measurements = {
      hr: hr,
      pr: null,
      qrs: Math.round(dominantTpl.qrsDur),
      qt: qt,
      qtc: qtc,
      pAxis: hasP ? L.frontalAxis(tpl.pDir) : null,
      qrsAxis: L.frontalAxis(netQrs),
      tAxis: L.frontalAxis(tpl.tDir),
      rrMean: meanRR,
      rrSpread: rrSpread,
      atrialRate: sched.atrialRate,
      beatCount: qrsTimes.length,
      droppedBeats: sched.dropped,
      pvcCount: sched.complexes.filter(function (c) { return c.kind === 'pvc'; }).length
    };

    /* A PR interval only exists when P waves are actually conducting to the
     * ventricles at a fixed delay. Wenckebach varies it on purpose and
     * complete block has no relationship at all, so both report nothing. */
    measurements.pr = (hasP && conducted && dominantKind === 'supraventricular')
      ? Math.round(tpl.pr) : null;
    if (cfg.avblock === 'first') measurements.pr = cfg.prInterval || 240;
    if (cfg.avblock === 'mobitz1' || cfg.avblock === 'third') measurements.pr = null;

    return {
      fs: fs,
      duration: duration,
      leads: leadData,
      leadNames: leadNames,
      schedule: sched,
      template: tpl,
      dominantTemplate: dominantTpl,
      dominantKind: dominantKind,
      measurements: measurements,
      config: cfg
    };
  }

  EKG.generator = { generate: generate, FS: FS, DURATION: DURATION };
})(window.EKG);
