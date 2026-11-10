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
    /* Brugada type 1. Leaves the J point at full height, rolls over a convex
     * shoulder, crosses the baseline about half way and bottoms out in a
     * shallow inverted T before coming back -- one smooth curve, with no
     * step at either end. */
    covedST: function (u) {
      var rise = 0.12;                       // climbing out of the S wave
      if (u < rise) return 0.5 * (1 - Math.cos(Math.PI * u / rise));
      var v = (u - rise) / (1 - rise);
      if (v < 0.60) return 1 - 1.42 * 0.5 * (1 - Math.cos(Math.PI * v / 0.60));
      return -0.42 * 0.5 * (1 + Math.cos(Math.PI * (v - 0.60) / 0.40));
    }
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
    /* Atrial enlargement draws the two atria separately: right first, left
     * second and pointing backward. Only a normal sinus P is split this way;
     * ectopic, retrograde and paced P waves keep a single component. */
    if (tpl.pParts && (!kind || kind === 'sinus')) {
      tpl.pParts.forEach(function (part) {
        paint(buf.vx, buf.vy, buf.vz, fs, tP + part.u0 * dur, tP + part.u1 * dur,
          part.amp, part.dir, M.SHAPES.bump);
      });
      return;
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
        tpl.prSegmentShift * gain, tpl.prSegmentDir || L.unit([0.3, 0.72, -0.62]),
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
        start += (ov.lead || 0) / 1000;
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
      /* An electrode losing contact: bursts of wild, slow, high-amplitude
       * swings with fast hash on top, coming and going as the patient
       * moves. The bursts are spread over the whole ten seconds so that at
       * least one lands inside the 2.5-second window in which this lead is
       * actually printed -- confined to the middle of the strip, the fault
       * was invisible on any lead in the first or last column. */
      var target = cfg.looseLead || 'III';
      var d2 = leadData[target];
      if (d2) {
        var bursts = [[0.3, 1.5], [3.0, 4.3], [5.6, 6.9], [8.1, 9.4]];
        var v = 0, slow = 0;
        bursts.forEach(function (bw) {
          var i0 = Math.round(bw[0] * fs), i1 = Math.min(n, Math.round(bw[1] * fs));
          var phs = rng() * 6.28, f1 = 1.1 + rng() * 1.3;
          for (var i2 = i0; i2 < i1; i2++) {
            var u = (i2 - i0) / (i1 - i0);
            var edge = Math.min(1, u / 0.12, (1 - u) / 0.12);
            v = v * 0.86 + (rng() - 0.5) * 0.55;
            slow = Math.sin(2 * Math.PI * f1 * (i2 - i0) / fs + phs) * 0.75 +
                   Math.sin(2 * Math.PI * f1 * 2.7 * (i2 - i0) / fs) * 0.30;
            d2[i2] += (v + slow) * edge;
          }
        });
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
      /* Fibrillation has no fixed axis. Three oscillators that drift in
       * frequency and never stay in step, one per spatial direction, make
       * the vector wander through space -- so every lead shows the same
       * chaos at a different size and phase. Driving all three axes from one
       * waveform (the earlier version) gave twelve scaled copies of a single
       * squiggle, with whichever leads lay across that fixed direction
       * almost flat. The amplitude also waxes and wanes, as real coarse VF
       * does. */
      var amp = sched.chaos.coarse ? 0.62 : 0.14;
      var ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
      var fBase = [4.6, 5.3, 4.1, 7.4, 6.6, 8.1];
      var drift = [700, 930, 1180, 610, 840, 1010];
      var envPh = rng() * 6.28;
      for (var i = 0; i < n; i++) {
        for (var k = 0; k < 6; k++) {
          ph[k] += (fBase[k] + Math.sin(i / drift[k] + k) * 1.3) * 2 * Math.PI / fs;
        }
        var env = amp * (0.72 + 0.28 * Math.sin(i / 1150 + envPh) + 0.16 * Math.sin(i / 430 + 1.7));
        buf.vx[i] += env * (Math.sin(ph[0]) * 0.75 + Math.sin(ph[3]) * 0.30);
        buf.vy[i] += env * (Math.sin(ph[1]) * 0.80 + Math.sin(ph[4]) * 0.30);
        buf.vz[i] += env * (Math.sin(ph[2]) * 0.50 + Math.sin(ph[5]) * 0.22);
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
        /* Fibrillatory waves: continuous, irregular, 350-600 a minute, never
         * the same twice -- and biggest in V1, which sits right over the
         * atria. A handful of drifting oscillators in the 5-9 Hz band gives
         * that; filtered white noise (the earlier version) just looked like a
         * noisy baseline with no f waves in it. */
        var fibDir = L.unit([-0.30, 0.55, -0.75]);
        var fp = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
        var ff = [5.6, 7.1, 8.7];
        var famp = (cfg.rhythm === 'afib_slow' ? 0.035 : 0.05);
        for (var g = 0; g < n; g++) {
          fp[0] += (ff[0] + Math.sin(g / 520) * 1.1) * 2 * Math.PI / fs;
          fp[1] += (ff[1] + Math.sin(g / 370 + 1) * 1.4) * 2 * Math.PI / fs;
          fp[2] += (ff[2] + Math.sin(g / 290 + 2) * 1.2) * 2 * Math.PI / fs;
          var fv = (Math.sin(fp[0]) + 0.7 * Math.sin(fp[1]) + 0.45 * Math.sin(fp[2])) *
            famp * (0.75 + 0.35 * Math.sin(g / 640 + 0.5));
          buf.vx[g] += fv * fibDir[0];
          buf.vy[g] += fv * fibDir[1];
          buf.vz[g] += fv * fibDir[2];
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
