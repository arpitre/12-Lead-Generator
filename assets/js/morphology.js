/* morphology.js — turns a case configuration into a "complex template".
 *
 * A template describes one heartbeat as a handful of vector lobes: the septal
 * lobe, the main free-wall lobe, the terminal basal lobe, the T wave, and an
 * injury (ST) vector. Pathology is expressed by adding, removing, rotating or
 * rescaling those lobes -- never by drawing a lead by hand. That is what makes
 * reciprocal change, R-wave progression and III>II fall out on their own.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var L = EKG.leads;
  var unit = L.unit, axisDir = L.axisDir, scale = L.scale, add = L.add;

  /* ---------------------------------------------------------------- shapes */

  function bump(u) { return 0.5 * (1 - Math.cos(2 * Math.PI * u)); }

  function asym(u, peak) {
    if (u <= peak) return 0.5 * (1 - Math.cos(Math.PI * u / peak));
    return 0.5 * (1 + Math.cos(Math.PI * (u - peak) / (1 - peak)));
  }

  /* A raised cosine blended toward a triangle, with the apex placed anywhere
   * in the lobe rather than fixed at the midpoint, and the blend adjustable:
   * more triangle gives a sharper apex and straighter limbs. */
  function sineBlend(u, peak, tri) {
    var w = tri === undefined ? 0.38 : tri;
    var ramp = u <= peak ? u / peak : (1 - u) / (1 - peak);
    return (1 - w) * asym(u, peak) + w * ramp;
  }

  var SHAPES = {
    bump: bump,
    p: function (u) { return asym(u, 0.45); },
    pNotched: function (u) { return 0.85 * asym(u, 0.3) + 0.85 * asym(u, 0.72); },
    t: function (u) { return asym(u, 0.62); },
    tSym: function (u) { return asym(u, 0.5); },
    tPeaked: function (u) { return Math.pow(asym(u, 0.5), 2.2); },
    /* Sine-wave lobes: a raised cosine blended toward a triangle. A pure
     * cosine reads as a drawn mathematical sine; real sine-wave hyperkalaemia
     * has noticeably sharper apices than that.
     *
     * The two skewed variants are what stop the tracing looking like a
     * function plot. On a real sine wave the limbs are not mirror images:
     * depolarisation rises quickly to its apex and then leans over into the
     * trough, and the trough itself is lazier still, dragging back toward the
     * next complex. */
    sineLobe:      function (u) { return sineBlend(u, 0.50); },
    sineLobeEarly: function (u) { return sineBlend(u, 0.34, 0.58); },
    sineLobeLate:  function (u) { return sineBlend(u, 0.56, 0.30); },
    /* Wellens Type A. Negative over the first ~60% (vector anterior, so the
     * chest leads go up into a broad rounded hump), then positive over the
     * remainder (vector posterior, giving the shallower terminal inversion).
     * The terminal limb is deliberately smaller than the hump. */
    wellensBiphasic: function (u) {
      return u < 0.60
        ? -Math.sin(Math.PI * u / 0.60)
        : 0.90 * Math.sin(Math.PI * (u - 0.60) / 0.40);
    },
    u: function (u) { return asym(u, 0.5); },
    // Slow, ramped upstroke -- the WPW delta wave.
    delta: function (u) { return u * u * (3 - 2 * u); },
    coved: function (u) { return 1 - 0.55 * u * u; }
  };

  /* ST-segment contours, evaluated across the ST segment (0..1).
   *
   * The shape is the single most useful discriminator between a real occlusion
   * and its mimics, so these are kept deliberately distinct:
   *   convex / oblique -> acute STEMI (domed or obliquely straight takeoff)
   *   concave          -> early repolarisation and pericarditis (saddle)
   *   upslope          -> de Winter
   *   downslope        -> LVH strain
   *   sagging          -> digitalis effect
   */
  var ST_SHAPES = {
    flat:      function (u) { return 1; },
    oblique:   function (u) { return 1 + 0.55 * u; },
    concave:   function (u) { return 1 - 0.20 * Math.sin(Math.PI * u); },
    // Domed, and monotonic all the way into the T: a real STEMI's ST segment
    // never dips back before the T wave starts.
    convex:    function (u) { return 1 + 0.30 * Math.sin(Math.PI * u * 0.5); },
    upslope:   function (u) { return 1 - 0.75 * u; },
    downslope: function (u) { return 0.45 + 0.75 * u; },
    sagging:   function (u) { return 0.35 + 1.15 * Math.sin(Math.PI * u * 0.85); }
  };

  function smoothstep(u) { return u * u * (3 - 2 * u); }

  /* The injury current is a standing DC offset, not something that switches on
   * when the QRS finishes. It is already flowing while the ventricle is still
   * depolarising, so the terminal limb of the QRS descends onto the elevated
   * level instead of returning to the isoelectric line -- which is why the J
   * point of a real STEMI is itself elevated, and why the ST segment and T
   * wave fuse into a single dome whose apex sits only a little above the J
   * point.
   *
   * Getting this wrong produces the classic tell-tale of a fake tracing: a
   * QRS that lands on the baseline followed by a detached rectangular
   * plateau. Both the main renderer and the precordial gain correction call
   * this one function so the two can never disagree.
   */
  function stEnvelope(tpl, t, qrsEnd, tStart, tEnd) {
    var shape = ST_SHAPES[tpl.stShape] || ST_SHAPES.flat;

    /* The offset builds across the WHOLE QRS, not just its tail. Muscle is
     * converted to the injured potential progressively as depolarisation
     * sweeps through it, so by the time the R wave is on its way down the
     * offset is most of the way in -- which is why the descending limb of the
     * R never reaches the isoelectric line and simply curves into the ST
     * segment. Ramping only over the last few milliseconds leaves the
     * terminal QRS forces free to drag the trace back to baseline first, and
     * that produces the give-away "flat J point with a plateau after it". */
    var ramp = tpl.qrsDur / 1000;
    var rampStart = qrsEnd - ramp;

    if (t < rampStart) return 0;
    if (t < qrsEnd) return shape(0) * smoothstep((t - rampStart) / ramp);

    // The ST segment proper.
    if (t <= tStart) {
      var d = tStart - qrsEnd;
      return shape(d > 0 ? (t - qrsEnd) / d : 0);
    }

    /* Across the T wave: hold the level through the ascent and apex, then
     * release over the terminal limb, so ST and T read as one dome that
     * returns to baseline rather than a T riding down a ramp. */
    var v = (t - tStart) / Math.max(1e-6, tEnd - tStart);
    if (v <= 0.5) return shape(1);
    return shape(1) * (1 - smoothstep((v - 0.5) / 0.5));
  }

  /* ----------------------------------------------------------- territories */

  /* Each territory is an injury-current direction. Leads whose axis points the
   * same way see ST elevation; leads pointing the opposite way see reciprocal
   * depression, automatically. */
  var TERRITORIES = {
    none: null,
    septal: {
      label: 'Septal', dir: [-0.25, 0.05, -1], artery: 'Proximal LAD (septal perforators)',
      wall: 'interventricular septum', leads: 'V1-V2'
    },
    anterior: {
      label: 'Anterior', dir: [0.05, 0.10, -1], artery: 'LAD',
      wall: 'anterior wall of the left ventricle', leads: 'V3-V4'
    },
    anteroseptal: {
      label: 'Anteroseptal', dir: [-0.10, 0.05, -1], artery: 'LAD',
      wall: 'septum and anterior wall', leads: 'V1-V4'
    },
    extensive_anterior: {
      label: 'Extensive anterior', dir: [0.35, 0.00, -1], artery: 'Proximal LAD, often before D1',
      wall: 'septum, anterior and lateral walls', leads: 'V1-V6, I, aVL'
    },
    anterolateral: {
      label: 'Anterolateral', dir: [0.60, -0.05, -0.85], artery: 'LAD / diagonal',
      wall: 'anterior and lateral walls', leads: 'V3-V6, I, aVL'
    },
    lateral: {
      label: 'Lateral', dir: [0.92, -0.15, -0.35], artery: 'Circumflex or diagonal',
      wall: 'lateral wall of the left ventricle', leads: 'I, aVL, V5-V6'
    },
    high_lateral: {
      label: 'High lateral', dir: [0.87, -0.50, 0.00], artery: 'First diagonal or high circumflex',
      wall: 'high lateral wall', leads: 'I, aVL'
    },
    inferior: {
      label: 'Inferior', dir: [0.00, 1.00, 0.10], artery: 'RCA (about 85%) or circumflex',
      wall: 'inferior/diaphragmatic wall', leads: 'II, III, aVF'
    },
    inferolateral: {
      label: 'Inferolateral', dir: [0.60, 0.80, 0.10], artery: 'Circumflex',
      wall: 'inferior and lateral walls', leads: 'II, III, aVF, V5-V6'
    },
    inferior_rv: {
      label: 'Inferior with RV extension', dir: [-0.35, 0.90, -0.25],
      artery: 'Proximal RCA, before the RV marginal branch',
      wall: 'inferior wall plus the right ventricle', leads: 'II, III, aVF and V4R'
    },
    posterior: {
      label: 'Posterior', dir: [0.10, 0.20, 1.00], artery: 'Circumflex or RCA (posterior descending)',
      wall: 'posterior (inferobasal) wall', leads: 'V7-V9; mirror change in V1-V3'
    },
    inferoposterior: {
      label: 'Inferoposterior', dir: [0.05, 0.88, 0.72], artery: 'Dominant RCA or circumflex',
      wall: 'inferior and posterior walls', leads: 'II, III, aVF + mirror in V1-V3'
    },
    subendocardial: {
      label: 'Diffuse subendocardial ischemia', dir: [-0.80, -0.45, 0.35],
      artery: 'Left main or severe three-vessel disease',
      wall: 'global subendocardium', leads: 'ST elevation in aVR with widespread depression'
    }
  };

  /* Calibrated so the ST deviation actually measured 40 ms past the J point
   * matches the label: ~1 mm subtle, ~2.5 mm moderate, ~4.5 mm marked. */
  var SEVERITY = { subtle: 0.085, moderate: 0.21, marked: 0.38, tombstone: 0.60 };

  /* ------------------------------------------------------------ base beat */

  function axisAngle(cfg) {
    if (cfg.axis === 'lad') return -45;
    if (cfg.axis === 'rad') return 115;
    if (cfg.axis === 'extreme') return -120;
    if (typeof cfg.axis === 'number') return cfg.axis;
    return 55; // normal
  }

  function baseTemplate(cfg) {
    var alpha = axisAngle(cfg);
    var main = axisDir(alpha, 0.22);

    return {
      alpha: alpha,
      pr: 160,
      pDur: 100,
      pAmp: 0.15,
      pDir: unit([0.5, 0.87, -0.18]),
      pShape: 'p',
      prSegmentShift: 0,       // PR-segment depression (pericarditis)
      qrsDur: 95,
      lobes: [
        { t0: 0,  t1: 22, amp: 0.20, dir: unit([-0.56, 0.10, -0.82]), shape: 'bump', tag: 'septal' },
        { t0: 6,  t1: 72, amp: 1.55, dir: main,                        shape: 'bump', tag: 'main' },
        { t0: 54, t1: 95, amp: 0.16, dir: unit([-0.51, -0.56, 0.66]),  shape: 'bump', tag: 'terminal' }
      ],
      stSeg: 90,               // J point to T onset, ms
      tDur: 180,
      tAmp: 0.32,
      tDir: axisDir(alpha - 12, -0.10),
      tShape: 't',
      tExtra: null,            // optional second repolarisation vector
      stVec: [0, 0, 0],
      stShape: 'flat',
      uAmp: 0,
      uDur: 140,
      globalGain: 1,
      overlays: [],            // per-lead extras, applied after projection
      pacerSpike: null
    };
  }

  function mainLobe(tpl) {
    for (var i = 0; i < tpl.lobes.length; i++) {
      if (tpl.lobes[i].tag === 'main') return tpl.lobes[i];
    }
    return tpl.lobes[0];
  }

  function dropLobe(tpl, tag) {
    tpl.lobes = tpl.lobes.filter(function (l) { return l.tag !== tag; });
  }

  function stretchQrs(tpl, newDur) {
    var old = tpl.qrsDur || 95;
    var k = newDur / old;
    tpl.lobes.forEach(function (l) { l.t0 *= k; l.t1 *= k; });
    tpl.qrsDur = newDur;
  }

  /* --------------------------------------------------- conduction defects */

  function applyConduction(tpl, cfg) {
    switch (cfg.ivcd) {
      case 'rbbb':
        // Right ventricle depolarises late, unopposed: a slow terminal vector
        // pointing right and anterior. rSR' in V1, wide slurred S in I and V6.
        tpl.lobes.push({
          t0: 62, t1: 138, amp: 0.62, dir: unit([-0.78, -0.08, -0.62]),
          shape: 'bump', tag: 'rbbbTerminal'
        });
        tpl.qrsDur = 138;
        // Appropriate discordance: ST/T opposite the terminal forces (V1-V3).
        tpl.stVec = add(tpl.stVec, scale(unit([-0.78, -0.08, -0.62]), -0.09));
        tpl.tDir = unit(add(scale(tpl.tDir, 0.75), scale(unit([-0.78, -0.08, -0.62]), -0.55)));
        break;

      case 'lbbb':
        // The left ventricle is activated late and from the right, so the
        // normal left-to-right septal vector disappears (no septal q in I/V6)
        // and everything is one broad, slurred leftward-posterior sweep.
        dropLobe(tpl, 'septal');
        dropLobe(tpl, 'terminal');
        var lb = mainLobe(tpl);
        lb.t0 = 0; lb.t1 = 150; lb.amp = 1.85;
        lb.dir = axisDir(Math.min(axisAngle(cfg), 10), 0.40);
        tpl.lobes.push({ t0: 30, t1: 120, amp: 0.45, dir: axisDir(-20, 0.55), shape: 'bump', tag: 'lbbbNotch' });
        tpl.qrsDur = 150;
        tpl.stVec = add(tpl.stVec, scale(lb.dir, -0.13));
        tpl.tDir = scale(lb.dir, -1);
        tpl.tAmp = 0.42;
        break;

      case 'lafb':
        // Anterior fascicle blocked: the impulse reaches the anterosuperior LV
        // late and from below, swinging the axis up and left. qR in I/aVL,
        // rS in II/III/aVF.
        mainLobe(tpl).dir = axisDir(-50, 0.20);
        tpl.lobes.unshift({ t0: 0, t1: 26, amp: 0.24, dir: unit([-0.15, 0.95, -0.25]), shape: 'bump', tag: 'lafbInitial' });
        tpl.qrsDur = 100;
        break;

      case 'lpfb':
        mainLobe(tpl).dir = axisDir(112, 0.20);
        tpl.lobes.unshift({ t0: 0, t1: 26, amp: 0.22, dir: unit([0.85, -0.45, -0.25]), shape: 'bump', tag: 'lpfbInitial' });
        tpl.qrsDur = 100;
        break;

      case 'bifascicular':
        mainLobe(tpl).dir = axisDir(-55, 0.20);
        tpl.lobes.unshift({ t0: 0, t1: 26, amp: 0.24, dir: unit([-0.15, 0.95, -0.25]), shape: 'bump', tag: 'lafbInitial' });
        tpl.lobes.push({ t0: 62, t1: 140, amp: 0.62, dir: unit([-0.78, -0.08, -0.62]), shape: 'bump', tag: 'rbbbTerminal' });
        tpl.qrsDur = 140;
        tpl.tDir = unit(add(scale(tpl.tDir, 0.75), scale(unit([-0.78, -0.08, -0.62]), -0.55)));
        break;

      case 'ivcd':
        stretchQrs(tpl, 125);
        mainLobe(tpl).amp *= 0.95;
        break;

      case 'wpw':
        // Accessory pathway pre-excites ventricular muscle directly: short PR,
        // slurred delta upstroke, and the QRS is a fusion of both routes.
        tpl.pr = 95;
        tpl.lobes.unshift({
          t0: 0, t1: 55, amp: 0.55,
          dir: cfg.wpwType === 'b' ? unit([-0.45, 0.55, -0.70]) : unit([0.60, 0.45, 0.65]),
          shape: 'delta', tag: 'delta'
        });
        tpl.qrsDur = 125;
        tpl.tDir = scale(mainLobe(tpl).dir, -0.6);
        tpl.tAmp = 0.30;
        break;
    }
    return tpl;
  }

  /* ------------------------------------------------------ chamber changes */

  function applyChambers(tpl, cfg) {
    switch (cfg.chambers) {
      case 'lvh':
        mainLobe(tpl).amp *= 1.55;
        mainLobe(tpl).dir = axisDir(axisAngle(cfg) - 10, 0.30);
        tpl.qrsDur = Math.max(tpl.qrsDur, 100);
        break;
      case 'lvh_strain':
        mainLobe(tpl).amp *= 1.60;
        mainLobe(tpl).dir = axisDir(axisAngle(cfg) - 12, 0.30);
        tpl.qrsDur = Math.max(tpl.qrsDur, 102);
        // Strain: downsloping ST depression with asymmetric T inversion in the
        // leads that face the thick muscle (I, aVL, V5, V6).
        tpl.stVec = add(tpl.stVec, scale(unit([0.92, -0.10, -0.15]), -0.13));
        tpl.tDir = unit([-0.90, 0.10, 0.30]);
        tpl.tAmp = 0.34;
        tpl.stShape = 'downslope';
        break;
      case 'rvh':
        mainLobe(tpl).dir = axisDir(115, -0.35); // right and anterior: tall R in V1
        mainLobe(tpl).amp *= 1.15;
        tpl.lobes.push({ t0: 50, t1: 100, amp: 0.30, dir: unit([-0.65, -0.30, -0.70]), shape: 'bump', tag: 'rvhTerminal' });
        tpl.tDir = unit([0.20, 0.30, 0.85]); // T inversion V1-V3
        tpl.tAmp = 0.30;
        break;
      case 'lae':
        tpl.pDur = 130;
        tpl.pShape = 'pNotched';
        tpl.pAmp = 0.14;
        tpl.pDir = unit([0.55, 0.62, 0.55]); // terminal posterior force: biphasic P in V1
        break;
      case 'rae':
        tpl.pAmp = 0.30;
        tpl.pDir = unit([0.35, 0.90, -0.35]);
        break;
      case 'biatrial':
        tpl.pDur = 130;
        tpl.pAmp = 0.28;
        tpl.pShape = 'pNotched';
        tpl.pDir = unit([0.45, 0.80, 0.15]);
        break;
    }
    return tpl;
  }

  /* --------------------------------------------------- ischemia / infarct */

  function applyIschemia(tpl, cfg) {
    var terr = TERRITORIES[cfg.ischemia];

    // Patterns that are not a simple injury vector get handled first.
    if (cfg.ischemia === 'wellens_a' || cfg.ischemia === 'wellens_b') {
      /* Critical proximal LAD stenosis, currently reperfused: R waves intact,
       * no significant ST elevation, but the anterior T waves are abnormal.
       *
       * Modelled as an extra repolarisation vector pointing straight
       * POSTERIOR, added on top of the normal T rather than replacing it.
       * That direction is the whole trick: a purely posterior vector has zero
       * projection onto all six limb leads, because they lie in the frontal
       * plane. So it inverts V1-V4 hardest, fades through V5, and leaves V6
       * and every limb lead untouched -- which is precisely the distribution
       * Wellens has. Replacing the T vector outright (the previous approach)
       * flattened the limb leads, which real Wellens does not do.
       *
       * The normal T is trimmed a little so the added vector can carry the
       * anterior leads negative without needing an implausible magnitude. */
      if (cfg.ischemia === 'wellens_b') {
        // Type B: deep, symmetric, rounded T inversion in V2-V4.
        tpl.tAmp = 0.22;
        tpl.tExtra = { amp: 0.26, dir: [0, 0, 1], shape: 'tSym' };
      } else {
        /* Type A: biphasic. The ST-T leaves the J point slightly elevated,
         * arcs up into a broad rounded positive hump, then descends through
         * the baseline into a shallower terminal negative trough.
         *
         * A negative shape value points the vector anterior (upright in the
         * chest leads) and a positive one points it posterior (inverted), so
         * one biphasic shape produces the whole up-then-down morphology. */
        tpl.tAmp = 0.18;
        tpl.tExtra = { amp: 0.105, dir: [0, 0, 1], shape: 'wellensBiphasic' };
        tpl.stVec = add(tpl.stVec, scale(unit([0.05, 0.0, -1]), 0.05));
        tpl.stShape = 'oblique';
      }
      return tpl;
    }

    if (cfg.ischemia === 'de_winter') {
      // Proximal LAD occlusion equivalent: upsloping ST depression at the J
      // point in the precordials, running into tall symmetric T waves.
      tpl.stVec = [0.05, 0.05, 0.30];
      tpl.stShape = 'upslope';
      tpl.tDir = unit([0.10, 0.10, -0.95]);
      tpl.tAmp = 0.75;
      tpl.tShape = 'tSym';
      return tpl;
    }

    if (!terr) return tpl;

    var mag = SEVERITY[cfg.severity] || SEVERITY.moderate;
    var dir = unit(terr.dir);

    if (cfg.stage === 'hyperacute') {
      // Earliest minutes: the T wave grows fat and broad-based over the
      // infarct before the ST segment properly lifts.
      tpl.stVec = add(tpl.stVec, scale(dir, mag * 0.55));
      tpl.stShape = 'oblique';
      tpl.tDir = unit(add(scale(tpl.tDir, 0.25), scale(dir, 1.0)));
      tpl.tAmp = 0.80;
      tpl.tShape = 'tSym';
      tpl.tDur = 210;
    } else if (cfg.stage === 'evolving') {
      // Hours to days: ST settles, Q waves appear, T waves invert.
      tpl.stVec = add(tpl.stVec, scale(dir, mag * 0.45));
      tpl.stShape = 'convex';
      tpl.tDir = unit(add(scale(tpl.tDir, 0.2), scale(dir, -1.0)));
      tpl.tAmp = 0.45;
      tpl.tShape = 'tSym';
      tpl.lobes.unshift({ t0: 0, t1: 40, amp: mag * 1.6, dir: scale(dir, -1), shape: 'bump', tag: 'qwave' });
    } else if (cfg.stage === 'old') {
      // Established scar: Q waves only, ST back to baseline.
      tpl.lobes.unshift({ t0: 0, t1: 42, amp: 0.62, dir: scale(dir, -1), shape: 'bump', tag: 'qwave' });
      tpl.tDir = unit(add(scale(tpl.tDir, 0.6), scale(dir, -0.5)));
    } else {
      /* Acute: the classic injury pattern. Real STEMI takes off convex
       * ("domed") or obliquely straight -- never the concave saddle of early
       * repolarisation or pericarditis. The T wave is deliberately modest
       * here because the injury offset carries most of the height: the apex
       * of a STEMI's ST-T dome sits only a little above its J point. */
      tpl.stVec = add(tpl.stVec, scale(dir, mag));
      tpl.stShape = (cfg.severity === 'marked' || cfg.severity === 'tombstone') ? 'convex' : 'oblique';
      tpl.tDir = unit(add(scale(tpl.tDir, 0.45), scale(dir, 0.85)));
      tpl.tAmp = 0.32;

      if (cfg.qWaves) {
        tpl.lobes.unshift({ t0: 0, t1: 40, amp: mag * 1.5, dir: scale(dir, -1), shape: 'bump', tag: 'qwave' });
      }
    }

    /* Injured muscle generates little late depolarisation force, which is why
     * the S wave shrinks or vanishes over an infarcting wall: on a real
     * inferior STEMI the R wave in II, III and aVF descends part way and
     * curves straight into the dome, with no S wave at all.
     *
     * This is mechanical, not cosmetic. The terminal lobe peaks about 20 ms
     * before the J point, so leaving it intact drags the trace back down
     * through the baseline exactly where the ST should be lifting -- which
     * reinstates the flat J point the ramp exists to prevent.
     *
     * Applied at every infarct stage and scaled by severity, so a tombstoning
     * STEMI loses its terminal forces almost entirely. Deliberately NOT
     * applied to pericarditis or early repolarisation (handled in
     * applyPattern): that muscle is alive and keeps its normal S waves. */
    if (mag > 0 && cfg.ischemia !== 'subendocardial') {
      tpl.lobes.forEach(function (lo) {
        if (lo.tag === 'terminal') lo.amp *= 1 / (1 + 12 * mag);
      });
    }
    return tpl;
  }

  /* ------------------------------------------- metabolic / other patterns */

  function applyPattern(tpl, cfg, meanRR) {
    switch (cfg.pattern) {
      case 'hyperk_mild':
        tpl.tAmp = 0.78; tpl.tDur = 120; tpl.tShape = 'tPeaked';
        break;
      case 'hyperk_moderate':
        tpl.tAmp = 0.95; tpl.tDur = 115; tpl.tShape = 'tPeaked';
        tpl.pAmp = 0.05; tpl.pDur = 130; tpl.pr = 220;
        stretchQrs(tpl, 125);
        break;
      case 'hyperk_severe':
        /* The pre-terminal sine wave. The defining feature is not simply that
         * the QRS is wide -- it is that depolarisation and repolarisation have
         * merged into one continuous undulation with NO isoelectric baseline
         * anywhere on the tracing. So the waveform is sized as a fraction of
         * the cardiac cycle rather than given fixed durations: a broad hump of
         * depolarisation running straight into an equally broad, fully
         * discordant repolarisation trough, filling essentially the whole R-R.
         *
         * Fixed durations were what made this look merely "wide": 355 ms of
         * complex inside a 1034 ms cycle left two thirds of every beat sitting
         * flat on the baseline.
         *
         * Amplitude is deliberately modest. A dying myocardium conducting
         * through depolarised, potassium-loaded muscle does not generate large
         * forces: published sine-wave tracings run around 5-10 mm in the limb
         * leads, with only the near-field chest leads getting much past that.
         * Drawing it at full QRS voltage produces a huge symmetrical
         * oscillation that reads as a signal generator rather than an ECG. */
        var cycle = (meanRR > 0 ? meanRR : 0.8) * 1000;
        var sineMain = mainLobe(tpl);
        dropLobe(tpl, 'septal');
        dropLobe(tpl, 'terminal');
        tpl.pAmp = 0; tpl.pr = 0;              // atrial muscle is paralysed
        sineMain.t0 = 0;
        sineMain.t1 = Math.min(420, cycle * 0.40);
        sineMain.amp = 0.72;
        sineMain.shape = 'sineLobeEarly';
        /* Strongly posterior, as a conduction-system-independent wavefront
         * crawling through muscle tends to be. With only a token posterior
         * component the vector sat almost perpendicular to V3/V4, which left
         * the mid-precordial leads flatter than the limb leads -- the reverse
         * of what these tracings show. */
        sineMain.dir = axisDir(axisAngle(cfg), 0.55);
        tpl.qrsDur = sineMain.t1;
        tpl.stSeg = 0;                          // no ST segment survives

        /* The vector has to rotate through the cycle. With repolarisation
         * exactly anti-parallel to depolarisation, any lead perpendicular to
         * that single axis records nothing at all for the whole complex, and
         * the tracing comes out with two dead-flat leads -- something a real
         * sine wave never shows. A late depolarisation lobe swung round to a
         * different direction, plus a T vector that is broadly opposed rather
         * than exactly mirrored, keeps every lead alive. */
        tpl.lobes.push({
          t0: sineMain.t1 * 0.35, t1: sineMain.t1, amp: 0.34,
          dir: axisDir(axisAngle(cfg) + 55, -0.35), shape: 'sineLobeLate', tag: 'sineLate'
        });

        /* Repolarisation takes longer than depolarisation even here, so the
         * trough is the broader half of the undulation: the complex reads as a
         * quicker deflection leaning into a long, lazy discordant wave rather
         * than two matched halves of a plotted sine. */
        tpl.tDur = Math.min(560, cycle * 0.58);
        tpl.tAmp = 0.62;
        tpl.tShape = 'sineLobeLate';
        /* Close to opposed, but not exactly: 20 degrees past the reciprocal of
         * the QRS axis. At the 40 degrees this used to use, the T came out
         * concordant in the lateral leads, so V4-V6 drew two positive humps
         * per beat and never crossed the baseline at all. A sine wave is
         * discordant everywhere. */
        tpl.tDir = unit([
          Math.cos((axisAngle(cfg) + 200) * Math.PI / 180),
          Math.sin((axisAngle(cfg) + 200) * Math.PI / 180),
          -0.55
        ]);
        /* A quadrature lobe, straddling the junction between the two halves of
         * the undulation and pointing off to one side of the main axis.
         *
         * Depolarisation and repolarisation here are nearly opposed, which
         * means they fall to nothing in the same place: any lead lying across
         * that axis records almost nothing for the whole cycle, and V4 came
         * out as a flat line between two undulating neighbours. A component
         * that peaks where the other two cross zero turns the vector's
         * back-and-forth into a rotation, so every lead keeps an undulation --
         * differing in size and in phase, which is what separates a real sine
         * wave from twelve copies of one drawn wave. */
        tpl.lobes.push({
          t0: sineMain.t1 * 0.55, t1: sineMain.t1 + tpl.tDur * 0.55, amp: 0.34,
          dir: axisDir(axisAngle(cfg) - 30, -0.72), shape: 'sineLobe', tag: 'sineMid'
        });
        tpl.sineWave = true;
        break;
      case 'hypok':
        tpl.tAmp = 0.10; tpl.uAmp = 0.22; tpl.uDur = 160;
        tpl.stVec = add(tpl.stVec, scale(unit(mainLobe(tpl).dir), -0.07));
        tpl.stShape = 'downslope';
        break;
      case 'hypercalcemia':
        tpl.stSeg = 35; tpl.tDur = 160;
        break;
      case 'hypocalcemia':
        tpl.stSeg = 210; tpl.tDur = 180;
        break;
      case 'digoxin':
        // "Salvador Dali moustache": sagging ST depression, short QT.
        tpl.stSeg = 50; tpl.tDur = 150; tpl.tAmp = 0.16;
        tpl.stVec = add(tpl.stVec, scale(unit(mainLobe(tpl).dir), -0.10));
        tpl.stShape = 'sagging';
        break;
      case 'hypothermia':
        // Osborn (J) wave: a positive hump right at the end of the QRS, in the
        // same direction as the main QRS forces.
        tpl.lobes.push({
          t0: tpl.qrsDur - 10, t1: tpl.qrsDur + 60, amp: 0.42,
          dir: unit(mainLobe(tpl).dir), shape: 'bump', tag: 'osborn'
        });
        tpl.stSeg = 120; tpl.tDur = 200; tpl.pr = 220;
        break;
      case 'pericarditis':
        // Diffuse epicardial injury: ST elevation almost everywhere, with PR
        // segment depression from atrial involvement.
        tpl.stVec = add(tpl.stVec, scale(unit([0.30, 0.72, -0.62]), 0.17));
        tpl.stShape = 'concave';
        tpl.prSegmentShift = -0.055;
        tpl.tAmp = 0.36;
        break;
      case 'early_repol':
        tpl.stVec = add(tpl.stVec, scale(unit([0.30, 0.45, -0.85]), 0.14));
        tpl.stShape = 'concave';
        tpl.tAmp = 0.55;
        tpl.lobes.push({
          t0: tpl.qrsDur - 12, t1: tpl.qrsDur + 26, amp: 0.16,
          dir: unit(mainLobe(tpl).dir), shape: 'bump', tag: 'jNotch'
        });
        break;
      case 'brugada':
        tpl.overlays.push({
          leads: ['V1', 'V2'], t0: 'j', dur: 260, amp: 0.32, shape: 'covedST', tag: 'brugada'
        });
        tpl.lobes.push({ t0: 60, t1: 120, amp: 0.30, dir: unit([-0.70, -0.25, -0.66]), shape: 'bump', tag: 'brugadaR' });
        tpl.qrsDur = Math.max(tpl.qrsDur, 120);
        break;
      case 'pe':
        // S1Q3T3 plus right heart strain: right axis, S in I, Q and inverted
        // T in III, T inversion across the right precordials.
        mainLobe(tpl).dir = axisDir(100, 0.20);
        tpl.lobes.push({ t0: 52, t1: 108, amp: 0.34, dir: unit([-0.85, -0.20, 0.48]), shape: 'bump', tag: 'sWaveI' });
        tpl.lobes.unshift({ t0: 0, t1: 34, amp: 0.26, dir: unit([0.30, -0.92, 0.24]), shape: 'bump', tag: 'qIII' });
        tpl.tDir = unit([0.15, -0.35, 0.92]);
        tpl.tAmp = 0.30;
        tpl.qrsDur = Math.max(tpl.qrsDur, 108);
        break;
      case 'low_voltage':
        tpl.globalGain = 0.40;
        break;
      case 'tca':
        stretchQrs(tpl, 140);
        tpl.lobes.push({ t0: 80, t1: 140, amp: 0.42, dir: unit([-0.86, -0.50, 0.10]), shape: 'bump', tag: 'terminalR_aVR' });
        tpl.stSeg = 140; tpl.tDur = 200;
        break;
      case 'lqts':
        tpl.stSeg = 230; tpl.tDur = 210; tpl.tAmp = 0.28;
        break;
    }
    return tpl;
  }

  /* ------------------------------------------------------ ectopic beats */

  // A ventricular beat: no P wave, wide and bizarre, T wave opposite the QRS.
  function ventricularTemplate(cfg, origin) {
    var tpl = baseTemplate(cfg);
    tpl.pAmp = 0; tpl.pr = 0;
    tpl.lobes = [];
    var dir;
    if (origin === 'lv') {
      // Left ventricular focus: depolarisation runs left-to-right, so V1 goes
      // positive — an RBBB-like morphology with a rightward axis.
      dir = unit([-0.35, 0.55, -0.75]);
    } else if (origin === 'rvot') {
      // Right ventricular outflow tract: LBBB-like, but heading downward,
      // giving the characteristic tall inferior complexes.
      dir = unit([0.35, 0.90, 0.25]);
    } else {
      // Right ventricular focus: LBBB-like with the classic left superior
      // ("northwest") axis — negative in II, III and aVF, negative in V1.
      dir = unit([0.34, -0.94, 0.35]);
    }
    tpl.lobes.push({ t0: 0, t1: 148, amp: 1.45, dir: dir, shape: 'bump', tag: 'main' });
    tpl.lobes.push({ t0: 40, t1: 130, amp: 0.38, dir: unit(add(dir, [0.2, 0.2, 0.1])), shape: 'bump', tag: 'slur' });
    tpl.qrsDur = 148;
    tpl.stSeg = 60;
    tpl.tDur = 210;
    tpl.tAmp = 0.55;
    tpl.tDir = scale(dir, -1);
    tpl.stVec = scale(dir, -0.12);
    tpl.stShape = 'flat';
    tpl.overlays = [];
    return tpl;
  }

  // A paced beat: RV apical lead gives an LBBB-like, left-axis complex.
  function pacedTemplate(cfg, mode) {
    var tpl = baseTemplate(cfg);
    tpl.lobes = [];
    /* Right ventricular apical pacing depolarises from the apex upward, so the
     * axis swings left and superior: negative in II, III and aVF, deeply
     * negative in V1 (LBBB-like), positive in I and V6. */
    var dir = unit([0.32, -0.88, 0.38]);
    if (mode === 'biv') dir = unit([-0.45, 0.40, -0.72]); // biventricular: often positive in V1
    tpl.lobes.push({ t0: 0, t1: 158, amp: 1.45, dir: dir, shape: 'bump', tag: 'main' });
    tpl.lobes.push({ t0: 45, t1: 140, amp: 0.35, dir: unit(add(dir, [0.15, 0.25, 0])), shape: 'bump', tag: 'slur' });
    tpl.qrsDur = 158;
    tpl.stSeg = 70;
    tpl.tDur = 210;
    tpl.tAmp = 0.5;
    tpl.tDir = scale(dir, -1);
    tpl.stVec = scale(dir, -0.14);
    tpl.pAmp = 0;
    tpl.pr = 0;
    tpl.overlays = [];
    return tpl;
  }

  /* --------------------------------------------------------------- build */

  /* Repolarisation is rate dependent: the QT shortens as the heart speeds up
   * and lengthens as it slows. Without this a bradycardia would render with a
   * falsely short QTc and a tachycardia with a falsely long one. */
  function adaptToRate(tpl, meanRR) {
    if (!meanRR || meanRR <= 0) return tpl;
    // A sine wave is already sized to the cycle; rescaling would undo that.
    if (tpl.sineWave) return tpl;
    var k = Math.sqrt(meanRR / 0.8);
    k = Math.max(0.72, Math.min(1.38, k));
    tpl.stSeg *= k;
    tpl.tDur *= k;
    tpl.uDur *= k;
    return tpl;
  }

  function build(cfg, meanRR) {
    var tpl = baseTemplate(cfg);
    applyConduction(tpl, cfg);
    applyChambers(tpl, cfg);
    applyIschemia(tpl, cfg);
    applyPattern(tpl, cfg, meanRR);
    adaptToRate(tpl, meanRR);

    if (cfg.prInterval) tpl.pr = cfg.prInterval;
    tpl.qt = Math.round(tpl.qrsDur + tpl.stSeg + tpl.tDur);
    return tpl;
  }

  EKG.morphology = {
    SHAPES: SHAPES,
    ST_SHAPES: ST_SHAPES,
    TERRITORIES: TERRITORIES,
    SEVERITY: SEVERITY,
    build: build,
    stEnvelope: stEnvelope,
    adaptToRate: adaptToRate,
    baseTemplate: baseTemplate,
    ventricularTemplate: ventricularTemplate,
    pacedTemplate: pacedTemplate,
    axisAngle: axisAngle,
    mainLobe: mainLobe
  };
})(window.EKG);
