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
    /* The WPW delta wave: a slow, nearly straight ramp for the first half
     * (muscle depolarising cell to cell from the pathway's insertion), which
     * then hands over to the normal activation and dies away beneath it. */
    delta: function (u) {
      if (u < 0.62) return Math.pow(u / 0.62, 1.15);
      return 0.5 * (1 + Math.cos(Math.PI * (u - 0.62) / 0.38));
    },
    // A pathological Q: drops promptly, then hands back to the surviving R.
    qwave: function (u) { return asym(u, 0.42); },
    // Strain T wave: a slow slide down and a quick snap back.
    tStrain: function (u) { return asym(u, 0.74); },
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
      label: 'Anterior', dir: [0.30, 0.10, -1], artery: 'LAD',
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
      label: 'High lateral', dir: [0.55, -0.75, -0.35], artery: 'First diagonal or high circumflex',
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
    if (cfg.axis === 'rad') return 110;
    if (cfg.axis === 'extreme') return -120;
    if (typeof cfg.axis === 'number') return cfg.axis;
    return 55; // normal
  }

  /* How far forward the early forces lean and how far back the late ones do.
   * Those two numbers are what turn the QRS from a line into a loop. */
  var EARLY_Z = -0.25, LATE_Z = 0.90;

  /* A rightward axis is not the whole loop swung round to the right. The
   * left ventricle still starts the QRS heading down and left; it is the
   * LATE forces that end up pointing right. So lead I gets a small r and
   * then a deep S, and V5-V6 keep an R wave with a deep S after it. Rotating
   * both halves together instead made V5-V6 entirely negative, which is what
   * dextrocardia looks like, not right axis deviation. */
  function axisSplit(angle) {
    return (angle > 90 && angle <= 180) ? [-35, 30] : [0, 0];
  }

  function baseTemplate(cfg) {
    var alpha = axisAngle(cfg);

    return {
      alpha: alpha,
      pr: 160,
      pDur: 100,
      pAmp: 0.15,
      pDir: unit([0.45, 0.85, -0.35]),
      pShape: 'p',
      pParts: null,            // optional two-component P wave (atrial enlargement)
      prSegmentShift: 0,       // PR-segment depression (pericarditis)
      prSegmentDir: null,
      qrsDur: 95,
      /* Ventricular depolarisation is a loop, not a line. The free wall is
       * activated apex-and-anterior first and base-and-posterior last, so the
       * vector swings from leftward-anterior round to leftward-posterior as
       * the QRS goes by.
       *
       * Modelling that as ONE main lobe gives every lead the same waveform
       * scaled by a cosine, and the lead lying across the vector gets nothing:
       * V3 came out as a tiny fragmented squiggle between a deep S in V2 and a
       * tall R in V4. With an early and a late lobe pointing different ways,
       * the transition lead sees the first one coming and the second one
       * going -- an honest RS complex -- and R-wave progression across the
       * chest falls out of the geometry. */
      lobes: [
        { t0: 0,  t1: 24, amp: 0.16, dir: unit([-0.56, 0.10, -0.82]),  shape: 'bump', tag: 'septal' },
        { t0: 8,  t1: 58, amp: 0.85, dir: axisDir(alpha + axisSplit(alpha)[0], EARLY_Z), shape: 'bump', tag: 'main' },
        { t0: 26, t1: 80, amp: 0.90, dir: axisDir(alpha + axisSplit(alpha)[1], LATE_Z),  shape: 'bump', tag: 'main2' },
        { t0: 58, t1: 95, amp: 0.14, dir: unit([-0.50, -0.50, 0.70]),  shape: 'bump', tag: 'terminal' }
      ],
      stSeg: 90,               // J point to T onset, ms
      tDur: 180,
      tAmp: 0.30,
      /* The normal T vector points left, down and FORWARD, which is why the
       * tallest T waves on a normal tracing are in V2-V4. */
      tDir: unit(add(axisDir(alpha - 15, 0), [0, 0, -0.50])),
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

  function lobeByTag(tpl, tag) {
    for (var i = 0; i < tpl.lobes.length; i++) {
      if (tpl.lobes[i].tag === tag) return tpl.lobes[i];
    }
    return null;
  }

  function mainLobe(tpl) { return lobeByTag(tpl, 'main') || tpl.lobes[0]; }

  // Both free-wall lobes, early then late (either may have been removed).
  function mainLobes(tpl) {
    return tpl.lobes.filter(function (l) { return l.tag === 'main' || l.tag === 'main2'; });
  }

  /* Net direction of the QRS: what "concordant" and "discordant" are measured
   * against, and where a J wave or an Osborn wave points. */
  function qrsDir(tpl) {
    var v = [0, 0, 0];
    tpl.lobes.forEach(function (l) {
      v = add(v, scale(l.dir, l.amp * (l.t1 - l.t0)));
    });
    return unit(v);
  }

  // Rotate the whole free-wall loop to a new frontal axis, keeping its depth.
  function setAxis(tpl, angle, earlyZ, lateZ) {
    var e = lobeByTag(tpl, 'main'), l = lobeByTag(tpl, 'main2');
    var split = axisSplit(angle);
    if (e) e.dir = axisDir(angle + split[0], earlyZ === undefined ? EARLY_Z : earlyZ);
    if (l) l.dir = axisDir(angle + split[1], lateZ === undefined ? LATE_Z : lateZ);
  }

  function scaleMain(tpl, kEarly, kLate) {
    var e = lobeByTag(tpl, 'main'), l = lobeByTag(tpl, 'main2');
    if (e) e.amp *= kEarly;
    if (l) l.amp *= (kLate === undefined ? kEarly : kLate);
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

  function shiftLobes(tpl, ms) {
    tpl.lobes.forEach(function (l) { l.t0 += ms; l.t1 += ms; });
    tpl.qrsDur += ms;
  }

  /* --------------------------------------------------- conduction defects */

  var RBBB_DIR = unit([-0.65, -0.05, -0.76]);

  function applyRbbbTerminal(tpl, endMs) {
    // Right ventricle depolarises late, unopposed: a slow terminal vector
    // pointing right and anterior. rSR' in V1, wide slurred S in I and V6.
    dropLobe(tpl, 'terminal');
    tpl.lobes.push({ t0: 60, t1: endMs, amp: 0.58, dir: RBBB_DIR, shape: 'bump', tag: 'rbbbTerminal' });
    tpl.qrsDur = endMs;
    // Appropriate discordance: ST/T opposite the terminal forces (V1-V3).
    tpl.stVec = add(tpl.stVec, scale(RBBB_DIR, -0.07));
    tpl.tDir = unit(add(scale(tpl.tDir, 0.70), scale(RBBB_DIR, -0.75)));
  }

  function applyConduction(tpl, cfg) {
    switch (cfg.ivcd) {
      case 'rbbb':
        applyRbbbTerminal(tpl, 138);
        break;

      case 'lbbb':
        /* The left ventricle is activated late, slowly, and from the right, so
         * the normal left-to-right septal vector disappears (no septal q in
         * I/V6) and the whole QRS is one broad leftward sweep that ends up
         * pointing well posterior.
         *
         * Two overlapping humps rather than one: the first heads left, the
         * second left-and-back. That gives the notched "M" in I, aVL and V6,
         * a slurred QS in V1-V2, and an rS rather than a dead-flat line in the
         * transition leads.
         *
         * The voltages are those of a slow muscle-to-muscle wavefront. Run
         * through the normal QRS amplitudes this pattern drove every lateral
         * lead off the top of the paper and V1-V2 off the bottom. */
        var lbAng = Math.max(-45, Math.min(axisAngle(cfg) - 45, 20));
        tpl.lobes = [
          { t0: 0,  t1: 96,  amp: 0.92, dir: axisDir(lbAng, 0.30),      shape: 'bump', tag: 'main' },
          { t0: 56, t1: 150, amp: 0.82, dir: axisDir(lbAng - 8, 1.00),  shape: 'bump', tag: 'main2' }
        ];
        tpl.qrsDur = 150;
        var lbDir = qrsDir(tpl);
        tpl.stVec = add(tpl.stVec, scale(lbDir, -0.19));
        tpl.stShape = 'oblique';
        tpl.tDir = scale(lbDir, -1);
        tpl.tAmp = 0.30;
        break;

      case 'lafb':
        // Anterior fascicle blocked: the impulse reaches the anterosuperior LV
        // late and from below, swinging the axis up and left. qR in I/aVL,
        // rS in II/III/aVF.
        setAxis(tpl, -55);
        tpl.lobes.unshift({ t0: 0, t1: 26, amp: 0.22, dir: unit([-0.15, 0.95, -0.25]), shape: 'bump', tag: 'lafbInitial' });
        tpl.qrsDur = 100;
        tpl.tDir = unit(add(axisDir(20, 0), [0, 0, -0.50]));
        break;

      case 'lpfb':
        setAxis(tpl, 112);
        tpl.lobes.unshift({ t0: 0, t1: 26, amp: 0.22, dir: unit([0.85, -0.45, -0.25]), shape: 'bump', tag: 'lpfbInitial' });
        tpl.qrsDur = 100;
        break;

      case 'bifascicular':
        setAxis(tpl, -58);
        tpl.lobes.unshift({ t0: 0, t1: 26, amp: 0.22, dir: unit([-0.15, 0.95, -0.25]), shape: 'bump', tag: 'lafbInitial' });
        tpl.tDir = unit(add(axisDir(20, 0), [0, 0, -0.50]));
        applyRbbbTerminal(tpl, 140);
        break;

      case 'ivcd':
        stretchQrs(tpl, 125);
        scaleMain(tpl, 0.95);
        break;

      case 'wpw':
        /* An accessory pathway pre-excites ventricular muscle directly. Three
         * things follow, and all three have to be on the page:
         *   - the PR is short, because the AV-node delay was bypassed;
         *   - the QRS starts with a slow slur (the delta wave), because that
         *     first muscle is depolarised cell to cell;
         *   - the QRS is wide, because the normal activation arrives on time
         *     and is simply added to the end of the pre-excited part.
         * So the normal lobes are pushed LATER and the delta wave fills the
         * gap in front of them. Starting them all together, as this used to,
         * hides the delta inside a normal upstroke. */
        var typeB = cfg.wpwType === 'b';
        var deltaDir = typeB
          ? unit([0.80, -0.20, 0.55])    // right-sided pathway: away from V1
          : unit([0.15, 0.55, -0.82]);   // left-sided pathway: toward V1
        dropLobe(tpl, 'septal');
        shiftLobes(tpl, 32);
        if (!typeB) {
          // The posterobasal LV has already been depolarised through the
          // pathway, so the late posterior forces that normally write the S
          // wave in V1 are largely missing: dominant R in V1.
          setAxis(tpl, axisAngle(cfg), -0.60, 0.05);
        }
        tpl.lobes.unshift({ t0: 0, t1: 74, amp: 0.46, dir: deltaDir, shape: 'delta', tag: 'delta' });
        tpl.pr = 100;
        tpl.tDir = unit(add(scale(tpl.tDir, 0.55), scale(deltaDir, -0.70)));
        tpl.tAmp = 0.24;
        tpl.stVec = add(tpl.stVec, scale(deltaDir, -0.05));
        break;
    }
    return tpl;
  }

  /* ------------------------------------------------------ chamber changes */

  function applyChambers(tpl, cfg) {
    switch (cfg.chambers) {
      case 'lvh':
        setAxis(tpl, axisAngle(cfg) - 20, -0.20, 1.05);
        scaleMain(tpl, 1.40, 1.45);
        tpl.qrsDur = Math.max(tpl.qrsDur, 100);
        break;
      case 'lvh_strain':
        setAxis(tpl, axisAngle(cfg) - 25, -0.20, 1.05);
        scaleMain(tpl, 1.45, 1.50);
        tpl.qrsDur = Math.max(tpl.qrsDur, 102);
        /* Strain: downsloping ST depression running into an asymmetric
         * inverted T in the leads that face the thick muscle (I, aVL, V5, V6),
         * with the mirror image -- ST elevation and a tall upright T -- in
         * V1-V3. The repolarisation vector therefore has to point right AND
         * forward; pointing it backward inverts the T in V2-V3 as well, which
         * turns strain into something that looks like anterior ischaemia. */
        tpl.stVec = add(tpl.stVec, scale(unit([-0.80, 0.10, -0.60]), 0.14));
        tpl.tDir = unit([-0.85, 0.40, -0.55]);
        tpl.tAmp = 0.24;
        tpl.tShape = 'tStrain';
        tpl.stShape = 'downslope';
        break;
      case 'rvh':
        /* A thick right ventricle drags the whole loop rightward and forward:
         * a dominant R in V1, an rS in V6, a deep S in lead I. */
        var rvE = lobeByTag(tpl, 'main'), rvL = lobeByTag(tpl, 'main2'), rvT = lobeByTag(tpl, 'terminal');
        if (rvE) { rvE.dir = unit([0.15, 0.75, -0.40]); rvE.amp = 0.85; }
        if (rvL) { rvL.dir = unit([-0.75, 0.45, -0.35]); rvL.amp = 0.90; }
        // The left ventricle still finishes last and behind: an S wave in
        // V2-V4 after the tall R, rather than pure R waves right across.
        if (rvT) { rvT.dir = unit([-0.60, -0.20, 0.75]); rvT.amp = 0.30; rvT.t1 = 100; }
        tpl.qrsDur = Math.max(tpl.qrsDur, 100);
        tpl.stVec = add(tpl.stVec, scale(unit([0.20, 0.10, 0.95]), 0.06));
        tpl.tDir = unit([0.50, 0.40, 0.75]); // T inversion V1-V3
        tpl.tAmp = 0.22;
        tpl.stShape = 'downslope';
        break;
      case 'lae':
        /* The left atrium depolarises second, and it sits at the back. An
         * enlarged one stretches the second half of the P wave and points it
         * posteriorly: a broad notched P in II, and in V1 a small upright
         * start followed by a deep, wide negative finish. */
        tpl.pDur = 130;
        tpl.pParts = [
          { u0: 0.00, u1: 0.58, amp: 0.11, dir: unit([0.40, 0.85, -0.40]) },
          { u0: 0.42, u1: 1.00, amp: 0.12, dir: unit([0.70, 0.40, 0.65]) }
        ];
        break;
      case 'rae':
        tpl.pAmp = 0.30;
        tpl.pDir = unit([0.30, 0.90, -0.40]);
        break;
      case 'biatrial':
        tpl.pDur = 130;
        tpl.pParts = [
          { u0: 0.00, u1: 0.55, amp: 0.28, dir: unit([0.30, 0.90, -0.40]) },
          { u0: 0.42, u1: 1.00, amp: 0.13, dir: unit([0.70, 0.40, 0.65]) }
        ];
        break;
    }
    return tpl;
  }

  /* --------------------------------------------------- ischemia / infarct */

  /* Dead muscle, drawn as what it actually is: missing forces.
   *
   * A pathological Q wave is not an extra deflection bolted onto the front of
   * a normal QRS. It is what is left when the wall under the electrode stops
   * contributing -- the lead looks through an electrical hole and records the
   * opposite wall depolarising away from it. Two things therefore happen
   * together, and the old model only did the first:
   *
   *   1. an early vector appears pointing AWAY from the scar (the Q wave);
   *   2. the forces that used to point TOWARD the scar shrink (the R wave
   *      over the infarct is small or gone).
   *
   * Without (2) the tracing shows a narrow little q in front of a full-height
   * R wave, which is a normal septal q, not an infarct. With it, an anterior
   * scar gives QS complexes in V1-V3 with the R wave only recovering by
   * V4-V5, and an inferior scar gives a wide Q with a stunted R in III and
   * aVF and a smaller q in II.
   *
   * kEarly / kLate are the fraction of toward-the-scar force removed from the
   * early and late parts of the QRS; qAmp is the size of the unopposed
   * opposite-wall vector. */
  function applyScar(tpl, n, kEarly, kLate, qAmp, qDur) {
    n = unit(n);
    tpl.lobes.forEach(function (lo) {
      var k = (lo.tag === 'main2' || lo.tag === 'terminal') ? kLate : kEarly;
      if (!k) return;
      var v = scale(lo.dir, lo.amp);
      var toward = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
      if (toward <= 0) return;
      v = add(v, scale(n, -k * toward));
      var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      lo.amp = m;
      if (m > 1e-6) lo.dir = scale(v, 1 / m);
    });
    if (qAmp > 0) {
      tpl.lobes.unshift({ t0: 0, t1: qDur || 46, amp: qAmp, dir: scale(n, -1), shape: 'qwave', tag: 'qwave' });
    }
  }

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
       * Wellens has. */
      if (cfg.ischemia === 'wellens_b') {
        // Type B: deep, symmetric, rounded T inversion in V2-V4.
        tpl.tAmp = 0.20;
        tpl.tShape = 'tSym';
        tpl.tExtra = { amp: 0.36, dir: [0, 0, 1], shape: 'tSym' };
      } else {
        /* Type A: biphasic. The ST-T leaves the J point slightly elevated,
         * arcs up into a rounded positive hump, then descends through the
         * baseline into a terminal negative trough.
         *
         * A negative shape value points the vector anterior (upright in the
         * chest leads) and a positive one points it posterior (inverted), so
         * one biphasic shape produces the whole up-then-down morphology. */
        tpl.tAmp = 0.10;
        tpl.tExtra = { amp: 0.15, dir: [0, 0, 1], shape: 'wellensBiphasic' };
        tpl.stVec = add(tpl.stVec, scale(unit([0.05, 0.0, -1]), 0.05));
        tpl.stShape = 'oblique';
      }
      return tpl;
    }

    if (cfg.ischemia === 'de_winter') {
      // Proximal LAD occlusion equivalent: upsloping ST depression at the J
      // point in the precordials, running into tall symmetric T waves, with a
      // little ST elevation in aVR.
      tpl.stVec = [-0.05, -0.02, 0.19];
      tpl.stShape = 'upslope';
      tpl.tDir = unit([0.15, 0.10, -0.95]);
      tpl.tAmp = 0.50;
      tpl.tShape = 'tSym';
      tpl.stSeg = 70;
      return tpl;
    }

    if (!terr) return tpl;

    var mag = SEVERITY[cfg.severity] || SEVERITY.moderate;
    var dir = unit(terr.dir);
    var posterior = cfg.ischemia === 'posterior' || cfg.ischemia === 'inferoposterior';

    if (cfg.ischemia === 'subendocardial') {
      /* Not an occlusion: the whole inner layer is short of oxygen, and the
       * injury current points away from the cavity -- toward aVR. Horizontal
       * or downsloping depression everywhere else, T waves flattened rather
       * than transformed, QRS untouched. */
      tpl.stVec = add(tpl.stVec, scale(dir, mag));
      tpl.stShape = 'flat';
      tpl.tAmp = 0.14;
      return tpl;
    }

    if (cfg.stage === 'hyperacute') {
      // Earliest minutes: the T wave grows fat and broad-based over the
      // infarct before the ST segment properly lifts.
      tpl.stVec = add(tpl.stVec, scale(dir, mag * 0.45));
      tpl.stShape = 'oblique';
      tpl.tDir = unit(add(scale(tpl.tDir, 0.25), scale(dir, 1.0)));
      tpl.tAmp = 0.52;
      tpl.tShape = 'tSym';
      tpl.tDur = 215;
      tpl.stSeg = 70;
    } else if (cfg.stage === 'evolving') {
      /* Hours to days: the ST segment is settling but still up and still
       * domed, Q waves have formed, and the T wave has turned over -- the
       * terminal T inversion of a completed infarct. */
      tpl.stVec = add(tpl.stVec, scale(dir, Math.max(0.10, mag * 0.55)));
      tpl.stShape = 'convex';
      tpl.tDir = unit(add(scale(tpl.tDir, 0.15), scale(dir, -1.0)));
      tpl.tAmp = 0.30;
      tpl.tShape = 'tSym';
      applyScar(tpl, dir, 0.75, posterior ? 0.70 : 0.30, 0.28, 46);
    } else if (cfg.stage === 'old') {
      // Established scar: Q waves and lost R waves; ST back on the baseline.
      applyScar(tpl, dir, 0.92, posterior ? 0.80 : 0.35, 0.36, 56);
      tpl.tDir = unit(add(scale(tpl.tDir, 0.75), scale(dir, -0.45)));
      tpl.tAmp = 0.22;
    } else {
      /* Acute: the classic injury pattern. Real STEMI takes off convex
       * ("domed") or obliquely straight -- never the concave saddle of early
       * repolarisation or pericarditis. The T wave is deliberately modest
       * here because the injury offset carries most of the height: the apex
       * of a STEMI's ST-T dome sits only a little above its J point. */
      tpl.stVec = add(tpl.stVec, scale(dir, mag));
      tpl.stShape = (cfg.severity === 'marked' || cfg.severity === 'tombstone') ? 'convex' : 'oblique';
      if (posterior) {
        /* The posterior wall is read in a mirror. Behind the heart the T is
         * part of the injury dome; from the front that same vector shows as
         * ST depression, and the classic V1-V3 picture -- a tall R, a
         * depressed ST and an UPRIGHT T -- is the mirror image of the Q wave,
         * ST elevation and T inversion of an infarct a few hours old. */
        tpl.tDir = unit(add(scale(tpl.tDir, 0.80), scale(dir, cfg.ischemia === 'posterior' ? -0.70 : 0.25)));
        tpl.tAmp = 0.30;
        // Horizontal, not deepening: the mirror of a flat-topped elevation.
        if (cfg.ischemia === 'posterior') tpl.stShape = 'flat';
        applyScar(tpl, [0.10, 0.10, 1.0], 0, 0.75, 0.22, 50);
      } else {
        tpl.tDir = unit(add(scale(tpl.tDir, 0.45), scale(dir, 0.85)));
        tpl.tAmp = 0.30;
      }

      if (cfg.qWaves) applyScar(tpl, dir, 0.60, 0.20, 0.24, 44);
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
    if (mag > 0 && cfg.stage !== 'old') {
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
        dropLobe(tpl, 'main2');
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
        tpl.stVec = add(tpl.stVec, scale(qrsDir(tpl), -0.07));
        tpl.stShape = 'downslope';
        break;
      case 'hypercalcemia':
        tpl.stSeg = 35; tpl.tDur = 160;
        break;
      case 'hypocalcemia':
        tpl.stSeg = 210; tpl.tDur = 180;
        break;
      case 'digoxin':
        /* The "reverse tick": the ST segment sags away from the QRS in a
         * smooth scoop and hooks back up into a small terminal T, with a
         * short QT. It follows the QRS -- deepest where the R wave is
         * tallest -- rather than any coronary territory. */
        tpl.stSeg = 110; tpl.tDur = 110; tpl.tAmp = 0.11;
        tpl.stVec = add(tpl.stVec, scale(qrsDir(tpl), -0.11));
        tpl.stShape = 'sagging';
        tpl.shortQT = true;
        break;
      case 'hypothermia':
        // Osborn (J) wave: a positive hump right at the end of the QRS, in the
        // same direction as the main QRS forces.
        tpl.lobes.push({
          t0: tpl.qrsDur - 10, t1: tpl.qrsDur + 60, amp: 0.42,
          dir: qrsDir(tpl), shape: 'bump', tag: 'osborn'
        });
        tpl.stSeg = 120; tpl.tDur = 200; tpl.pr = 220;
        break;
      case 'pericarditis':
        /* Diffuse epicardial injury: concave ST elevation in almost every
         * lead (I, II, aVF, V2-V6), depression only in aVR and sometimes V1,
         * and PR-segment depression from the inflamed atria -- with the PR
         * segment going UP in aVR. */
        tpl.stVec = add(tpl.stVec, scale(unit([0.55, 0.65, -0.50]), 0.20));
        tpl.stShape = 'concave';
        tpl.prSegmentShift = -0.08;
        tpl.prSegmentDir = unit([0.55, 0.65, -0.30]);
        tpl.tAmp = 0.34;
        break;
      case 'early_repol':
        tpl.stVec = add(tpl.stVec, scale(unit([0.30, 0.45, -0.85]), 0.14));
        tpl.stShape = 'concave';
        tpl.tAmp = 0.46;
        tpl.lobes.push({
          t0: tpl.qrsDur - 12, t1: tpl.qrsDur + 26, amp: 0.14,
          dir: unit([0.55, 0.45, -0.70]), shape: 'bump', tag: 'jNotch'
        });
        break;
      case 'brugada':
        /* Type 1: an rSR'-like complex in V1-V2 whose terminal R' never comes
         * back down -- it leaves at 2 mm or more and slides, coved, straight
         * into an inverted T wave. It is a strictly local right-ventricular
         * outflow phenomenon, so it is drawn on V1-V2 alone and the rest of
         * the tracing stays normal. */
        tpl.qrsDur = Math.max(tpl.qrsDur, 110);
        // Flatten the ordinary T in the right chest leads so the coved
        // descent, not a normal upright T, decides what V1-V2 look like.
        tpl.tDir = unit(add(axisDir(tpl.alpha - 15, 0), [0.15, 0, 0.05]));
        // The overlay starts inside the terminal QRS and climbs to its
        // take-off point, so the r' and the coved ST are one unbroken line.
        tpl.overlays.push({ leads: ['V1'], t0: 'j', lead: -42, dur: 340, amp: 0.27, shape: 'covedST', tag: 'brugada' });
        tpl.overlays.push({ leads: ['V2'], t0: 'j', lead: -42, dur: 340, amp: 0.38, shape: 'covedST', tag: 'brugada' });
        break;
      case 'pe':
        /* Acute right heart strain. The dilated right ventricle rotates the
         * heart clockwise and conducts late:
         *   S1  - a late rightward force (S wave in I, persisting to V6)
         *   Q3  - a small early force pointing up and left (q in III, r in I)
         *   T3  - T inversion in III, and across V1-V4
         * plus a rightward axis and an incomplete RBBB. The R waves in the
         * lateral chest leads are still there -- they just have an S after
         * them. */
        setAxis(tpl, 80, -0.20, 0.80);
        dropLobe(tpl, 'terminal');
        tpl.lobes.push({ t0: 54, t1: 108, amp: 0.36, dir: unit([-0.85, -0.15, -0.25]), shape: 'bump', tag: 'sWaveI' });
        tpl.lobes.unshift({ t0: 0, t1: 30, amp: 0.34, dir: unit([0.75, -0.60, 0.00]), shape: 'bump', tag: 'qIII' });
        tpl.tDir = unit([0.55, -0.15, 0.80]);
        tpl.tAmp = 0.22;
        tpl.tShape = 'tSym';
        tpl.qrsDur = Math.max(tpl.qrsDur, 108);
        break;
      case 'low_voltage':
        tpl.globalGain = 0.40;
        break;
      case 'tca':
        stretchQrs(tpl, 140);
        tpl.lobes.push({ t0: 80, t1: 140, amp: 0.50, dir: unit([-0.86, -0.50, 0.10]), shape: 'bump', tag: 'terminalR_aVR' });
        tpl.stSeg = 140; tpl.tDur = 200;
        break;
      case 'lqts':
        tpl.stSeg = 230; tpl.tDur = 210; tpl.tAmp = 0.28;
        break;
    }
    return tpl;
  }

  /* ------------------------------------------------------ ectopic beats */

  /* A beat that starts in ventricular muscle. No P wave, wide, and the T wave
   * opposite the QRS.
   *
   * Like the normal beat it is a loop, not a line: the wavefront leaves the
   * focus heading one way and finishes heading another. Drawn as a single
   * direction, whichever chest lead happened to lie across it recorded
   * nothing at all, and a ventricular tachycardia came out with a dead-flat
   * V4 between two rows of huge complexes. */
  function wideTemplate(cfg, dA, dB, dur, amp) {
    var tpl = baseTemplate(cfg);
    tpl.pAmp = 0; tpl.pr = 0;
    dA = unit(dA); dB = unit(dB);
    tpl.lobes = [
      { t0: 0,          t1: dur * 0.64, amp: amp * 0.92, dir: dA, shape: 'bump', tag: 'main' },
      { t0: dur * 0.30, t1: dur,        amp: amp * 1.10, dir: dB, shape: 'bump', tag: 'main2' }
    ];
    tpl.qrsDur = dur;
    var net = qrsDir(tpl);
    tpl.stSeg = 50;
    tpl.tDur = 210;
    tpl.tAmp = 0.42;
    tpl.tShape = 'tSym';
    tpl.tDir = scale(net, -1);
    tpl.stVec = scale(net, -0.20);
    tpl.stShape = 'oblique';
    tpl.overlays = [];
    return tpl;
  }

  function ventricularTemplate(cfg, origin) {
    if (origin === 'lv') {
      // Left ventricular focus: depolarisation runs left-to-right, so V1 goes
      // positive (RBBB-like) with a rightward axis and a deep S in V6.
      return wideTemplate(cfg, [-0.30, 0.40, -0.80], [-0.75, 0.55, -0.10], 150, 1.35);
    }
    if (origin === 'rvot') {
      // Right ventricular outflow tract: LBBB-like, but heading downward,
      // giving the characteristic tall inferior complexes.
      return wideTemplate(cfg, [0.20, 0.85, -0.10], [0.45, 0.80, 0.65], 142, 1.30);
    }
    // Right ventricular apex: LBBB-like with a left superior axis -- negative
    // in II, III and aVF, a deep QS in V1-V3, upright in I, aVL and V6.
    return wideTemplate(cfg, [0.55, -0.55, 0.10], [0.25, -0.80, 0.75], 150, 1.35);
  }

  // A paced beat: an RV apical lead gives an LBBB-like, left-axis complex.
  function pacedTemplate(cfg, mode) {
    var tpl;
    if (mode === 'biv') {
      // Biventricular: the LV lead fires from the lateral wall, so activation
      // runs rightward -- a dominant R in V1, negative in lead I, and a
      // narrower QRS than RV pacing alone.
      tpl = wideTemplate(cfg, [-0.50, 0.20, -0.75], [-0.60, -0.50, -0.20], 138, 1.05);
    } else {
      /* Right ventricular apical pacing depolarises from the apex upward, so
       * the axis swings left and superior: negative in II, III and aVF,
       * deeply negative in V1 (LBBB-like), positive in I and aVL. */
      tpl = wideTemplate(cfg, [0.60, -0.60, 0.20], [0.20, -0.80, 0.70], 158, 1.20);
    }
    tpl.stSeg = 60;
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
    /* The floor matters at SVT rates: holding the QT at 72% of its resting
     * length made every fast narrow tachycardia print a "prolonged QTc". */
    k = Math.max(0.58, Math.min(1.38, k));
    if (tpl.shortQT) k = Math.min(k, 1.0);
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
    mainLobe: mainLobe,
    qrsDir: qrsDir
  };
})(window.EKG);
