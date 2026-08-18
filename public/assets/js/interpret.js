/* interpret.js — measurements taken off the rendered signal, plus the
 * machine-style interpretation block a monitor prints at the top of the page.
 *
 * The ST deviations here are measured from the tracing, not read back out of
 * the config. That matters: if the engine draws something different from what
 * the dropdowns claim, the numbers will disagree and we want to see that.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var CONTIGUOUS = {
    inferior: ['II', 'III', 'aVF'],
    lateral: ['I', 'aVL', 'V5', 'V6'],
    anterior: ['V3', 'V4'],
    septal: ['V1', 'V2'],
    high_lateral: ['I', 'aVL']
  };

  /* Pick a representative beat: the first supraventricular complex that has a
   * full beat's worth of room on either side. */
  /* Pick a beat of whichever type dominates the tracing, with room on either
   * side so the baseline and T wave are both fully on the page.
   *
   * The preceding R-R also has to be long enough that the previous beat's T
   * wave has finished before this beat's baseline window. In atrial
   * fibrillation with a rapid response the short cycles are shorter than the
   * QT, so the previous T runs straight into the next complex; measuring
   * against that produced widespread ST depression with aVR elevation on a
   * patient whose only problem was a fast, irregular rate. A human reader
   * does the same thing -- they pick a clean complex to measure. */
  function representativeBeat(result) {
    var cs = result.schedule.complexes;
    var tpl = result.dominantTemplate || result.template;
    var want = result.dominantKind || 'supraventricular';
    var matches = function (c) {
      if (want === 'ventricular') return c.kind === 'ventricular';
      if (want === 'paced') return c.kind === 'paced';
      return c.kind === 'supraventricular' && !c.ectopic;
    };
    var inWindow = function (c) { return c.t > 0.8 && c.t < result.duration - 1.0; };

    // Room needed before the QRS for the previous beat's T wave plus baseline.
    var clearance = (tpl.qrsDur + tpl.stSeg + tpl.tDur) / 1000 + 0.07;

    var best = null, bestGap = -1;
    for (var i = 1; i < cs.length - 1; i++) {
      if (!inWindow(cs[i])) continue;
      var gap = cs[i].t - cs[i - 1].t;
      if (matches(cs[i]) && gap >= clearance) return cs[i];
      if (matches(cs[i]) && gap > bestGap) { best = cs[i]; bestGap = gap; }
    }
    if (best) return best;                      // longest available cycle
    for (var j = 1; j < cs.length - 1; j++) {
      if (inWindow(cs[j])) return cs[j];
    }
    return cs.length > 1 ? cs[1] : cs[0];
  }

  function sampleMean(data, fs, t0, t1) {
    var i0 = Math.max(0, Math.round(t0 * fs)), i1 = Math.min(data.length - 1, Math.round(t1 * fs));
    if (i1 <= i0) return data[Math.max(0, Math.min(data.length - 1, i0))] || 0;
    var s = 0;
    for (var i = i0; i <= i1; i++) s += data[i];
    return s / (i1 - i0 + 1);
  }

  /* ST deviation in millimetres, measured 40 ms after the J point against the
   * TP baseline — the same place a human reader puts their eye. */
  function measure(result) {
    var beat = representativeBeat(result);
    if (!beat) return { st: {}, valid: false };

    var tpl = result.dominantTemplate || result.template, fs = result.fs;
    var qrsOnset = beat.t;
    var j = qrsOnset + tpl.qrsDur / 1000;
    var stAt = j + 0.04;

    /* Reference the PR segment -- the flat stretch between the end of the P
     * wave and the start of the QRS.
     *
     * The TP segment is the textbook zero, but it shrinks to nothing as the
     * rate climbs: at 130 bpm there is barely 10 ms of it, and sampling there
     * lands on the tail of the previous T wave. That manufactured 2-3 mm of
     * ST depression across every lead of a plain sinus tachycardia, with
     * matching elevation in aVR -- a textbook left-main pattern conjured out
     * of a normal fast heart. The PR segment stays put at any rate. */
    var baseEnd = qrsOnset - 0.008;
    var prSegLen = (tpl.pr - tpl.pDur) / 1000;
    var baseStart = (tpl.pr > 0 && prSegLen > 0.02)
      ? Math.max(qrsOnset - prSegLen + 0.004, baseEnd - 0.030)
      : baseEnd - 0.025;

    var st = {}, rAmp = {}, sAmp = {}, tAmp = {};
    result.leadNames.forEach(function (name) {
      var d = result.leads[name];
      var base = sampleMean(d, fs, baseStart, baseEnd);
      st[name] = Math.round((sampleMean(d, fs, stAt - 0.008, stAt + 0.008) - base) * 100) / 10; // mV -> mm

      // Peak positive and negative excursion within the QRS.
      var i0 = Math.round(qrsOnset * fs), i1 = Math.round(j * fs);
      var hi = -99, lo = 99;
      for (var i = i0; i <= i1 && i < d.length; i++) {
        if (d[i] - base > hi) hi = d[i] - base;
        if (d[i] - base < lo) lo = d[i] - base;
      }
      rAmp[name] = Math.round(hi * 100) / 10;
      sAmp[name] = Math.round(-lo * 100) / 10;

      var tPeakWin = j + tpl.stSeg / 1000 + (tpl.tDur / 1000) * 0.55;
      tAmp[name] = Math.round((sampleMean(d, fs, tPeakWin - 0.02, tPeakWin + 0.02) - base) * 100) / 10;
    });

    var sokolow = (sAmp.V1 || 0) + Math.max(rAmp.V5 || 0, rAmp.V6 || 0);

    return {
      valid: true, st: st, r: rAmp, s: sAmp, t: tAmp,
      sokolow: Math.round(sokolow * 10) / 10,
      beatTime: beat.t
    };
  }

  function elevatedLeads(m, threshold) {
    var out = [];
    Object.keys(m.st).forEach(function (k) { if (m.st[k] >= (threshold || 1.0)) out.push(k); });
    return out;
  }

  function depressedLeads(m, threshold) {
    var out = [];
    Object.keys(m.st).forEach(function (k) { if (m.st[k] <= -(threshold || 1.0)) out.push(k); });
    return out;
  }

  /* --------------------------------------------------- rhythm description */

  function rhythmName(cfg, meas) {
    var r = cfg.rhythm, hr = meas.hr;

    if (cfg.pacing && cfg.pacing !== 'none') {
      var names = {
        atrial: 'ATRIAL PACED RHYTHM',
        ventricular: 'VENTRICULAR PACED RHYTHM',
        av_sequential: 'AV SEQUENTIAL PACED RHYTHM',
        biventricular: 'BIVENTRICULAR PACED RHYTHM',
        demand: 'DEMAND PACED RHYTHM',
        failure_capture: 'PACED RHYTHM WITH FAILURE TO CAPTURE',
        failure_sense: 'PACED RHYTHM WITH UNDERSENSING'
      };
      return names[cfg.pacing] || 'PACED RHYTHM';
    }

    if (r === 'vfib') return 'VENTRICULAR FIBRILLATION';
    if (r === 'asystole') return 'ASYSTOLE';
    if (r === 'vtach') return 'VENTRICULAR TACHYCARDIA';
    if (r === 'polymorphic_vt') return 'POLYMORPHIC VENTRICULAR TACHYCARDIA';
    if (r === 'idioventricular') return 'IDIOVENTRICULAR RHYTHM';
    if (r === 'aivr') return 'ACCELERATED IDIOVENTRICULAR RHYTHM';
    if (r === 'afib' || r === 'afib_slow' || r === 'afib_rvr') {
      return hr > 100 ? 'ATRIAL FIBRILLATION WITH RAPID VENTRICULAR RESPONSE' : 'ATRIAL FIBRILLATION';
    }
    if (r === 'aflutter') {
      var ratio = cfg.flutterConduction;
      return 'ATRIAL FLUTTER WITH ' + (ratio == 0 ? 'VARIABLE' : ratio + ':1') + ' AV CONDUCTION';
    }
    if (r === 'svt') return 'SUPRAVENTRICULAR TACHYCARDIA';
    if (r === 'atach') return 'ATRIAL TACHYCARDIA';
    if (r === 'mat') return 'MULTIFOCAL ATRIAL TACHYCARDIA';
    if (r === 'wandering') return 'WANDERING ATRIAL PACEMAKER';
    if (r === 'junctional') return 'JUNCTIONAL ESCAPE RHYTHM';
    if (r === 'accel_junctional') return 'ACCELERATED JUNCTIONAL RHYTHM';
    if (r === 'junctional_tach') return 'JUNCTIONAL TACHYCARDIA';

    /* Severe hyperkalaemia paralyses atrial muscle: the sinus node is still
     * driving, but nothing depolarises the atria visibly, so there are no P
     * waves to call a sinus rhythm from. Calling this "sinus bradycardia"
     * because the config says sinus would describe a tracing nobody can see. */
    if (cfg.pattern === 'hyperk_severe') return 'WIDE COMPLEX RHYTHM, NO VISIBLE P WAVES';

    if (cfg.avblock === 'third') return 'COMPLETE HEART BLOCK';

    /* When beats are being dropped, the sinus node is not the thing that is
     * slow — the AV node is. Name the rhythm by the ATRIAL rate, or a
     * Wenckebach at a normal sinus rate gets mislabelled a bradycardia. */
    var blocked = cfg.avblock && cfg.avblock !== 'none';
    var refRate = blocked ? (meas.atrialRate || hr) : hr;

    if (refRate < 60) return 'SINUS BRADYCARDIA';
    if (refRate > 100) return 'SINUS TACHYCARDIA';
    if (r === 'sinus_arrhythmia') return 'SINUS ARRHYTHMIA';
    return blocked ? 'SINUS RHYTHM' : 'NORMAL SINUS RHYTHM';
  }

  /* ------------------------------------------------------ full statement */

  function interpret(result) {
    var cfg = result.config, meas = result.measurements;
    var m = measure(result);
    var lines = [];
    var alert = null;

    lines.push(rhythmName(cfg, meas));

    // --- AV block
    if (cfg.avblock === 'first') lines.push('WITH FIRST DEGREE AV BLOCK');
    if (cfg.avblock === 'mobitz1') lines.push('WITH SECOND DEGREE AV BLOCK, MOBITZ TYPE I');
    if (cfg.avblock === 'mobitz2') lines.push('WITH SECOND DEGREE AV BLOCK, MOBITZ TYPE II');
    if (cfg.avblock === 'twotoone') lines.push('WITH 2:1 AV BLOCK');
    if (cfg.avblock === 'third' && cfg.rhythm !== 'vfib') {
      lines.push('AV DISSOCIATION, ' + (cfg.escapeSite === 'ventricular' ? 'VENTRICULAR' : 'JUNCTIONAL') + ' ESCAPE');
    }

    // --- ectopy
    if (meas.pvcCount > 0) {
      var e = cfg.ectopy;
      if (e === 'bigeminy') lines.push('WITH VENTRICULAR BIGEMINY');
      else if (e === 'trigeminy') lines.push('WITH VENTRICULAR TRIGEMINY');
      else if (e === 'couplet') lines.push('WITH VENTRICULAR COUPLET');
      else if (e === 'nsvt') lines.push('WITH NONSUSTAINED VENTRICULAR TACHYCARDIA');
      else if (e === 'pvc_multi') lines.push('WITH MULTIFOCAL PREMATURE VENTRICULAR COMPLEXES');
      else lines.push('WITH PREMATURE VENTRICULAR COMPLEXES');
    }
    if (cfg.ectopy === 'pac') lines.push('WITH PREMATURE ATRIAL COMPLEX');
    if (cfg.ectopy === 'pjc') lines.push('WITH PREMATURE JUNCTIONAL COMPLEX');

    // --- conduction
    var ivcdNames = {
      rbbb: 'RIGHT BUNDLE BRANCH BLOCK',
      lbbb: 'LEFT BUNDLE BRANCH BLOCK',
      lafb: 'LEFT ANTERIOR FASCICULAR BLOCK',
      lpfb: 'LEFT POSTERIOR FASCICULAR BLOCK',
      bifascicular: 'BIFASCICULAR BLOCK (RBBB WITH LAFB)',
      ivcd: 'NONSPECIFIC INTRAVENTRICULAR CONDUCTION DELAY',
      wpw: 'VENTRICULAR PRE-EXCITATION (WPW PATTERN)'
    };
    if (ivcdNames[cfg.ivcd]) lines.push(ivcdNames[cfg.ivcd]);

    // --- axis
    var ax = meas.qrsAxis;
    if (ax !== null && cfg.rhythm !== 'vfib' && cfg.rhythm !== 'asystole') {
      if (ax >= -30 && ax <= 90) { /* normal, monitors usually stay quiet */ }
      else if (ax > -90 && ax < -30) lines.push('LEFT AXIS DEVIATION');
      else if (ax > 90 && ax <= 180) lines.push('RIGHT AXIS DEVIATION');
      else lines.push('EXTREME AXIS DEVIATION');
    }

    // --- chambers
    var chamberNames = {
      lvh: 'LEFT VENTRICULAR HYPERTROPHY BY VOLTAGE',
      lvh_strain: 'LEFT VENTRICULAR HYPERTROPHY WITH REPOLARIZATION ABNORMALITY',
      rvh: 'RIGHT VENTRICULAR HYPERTROPHY',
      lae: 'LEFT ATRIAL ENLARGEMENT',
      rae: 'RIGHT ATRIAL ENLARGEMENT',
      biatrial: 'BIATRIAL ENLARGEMENT'
    };
    if (chamberNames[cfg.chambers]) lines.push(chamberNames[cfg.chambers]);

    // --- ischemia
    var terr = EKG.morphology.TERRITORIES[cfg.ischemia];
    var elev = elevatedLeads(m, 1.0);
    var depr = depressedLeads(m, 1.0);

    /* Repolarisation cannot be read when depolarisation did not come down the
     * normal conduction system. A ventricular or paced complex generates its
     * own large discordant ST shift that has nothing to do with ischemia, so
     * no ST statement gets issued at all. */
    var wideComplex = (result.dominantKind || 'supraventricular') !== 'supraventricular';
    var stReadable = !wideComplex &&
      cfg.rhythm !== 'vfib' && cfg.rhythm !== 'asystole' &&
      cfg.pattern !== 'hyperk_severe';   // a sine wave has no ST segment at all

    if (!stReadable) {
      elev = []; depr = [];
      if (wideComplex) lines.push('ST-T ABNORMAL, SECONDARY TO WIDE COMPLEX RHYTHM');
    }

    if (stReadable && terr && cfg.stage !== 'old') {
      var word = cfg.stage === 'hyperacute' ? 'HYPERACUTE T WAVES' : 'ST ELEVATION';
      if (cfg.ischemia === 'subendocardial') {
        lines.push('WIDESPREAD ST DEPRESSION WITH ST ELEVATION IN aVR');
        lines.push('CONSIDER LEFT MAIN OR SEVERE MULTIVESSEL DISEASE');
      } else if (cfg.ischemia === 'posterior') {
        lines.push('ST DEPRESSION V1-V3 WITH TALL R WAVES');
        lines.push('CONSIDER ACUTE POSTERIOR INFARCT');
        alert = '***MEETS ST ELEVATION MI CRITERIA***';
      } else {
        lines.push(word + ' — ' + terr.label.toUpperCase() + ' INFARCT');
        if (cfg.ischemia === 'inferior_rv') lines.push('CONSIDER RIGHT VENTRICULAR INVOLVEMENT — OBTAIN V4R');
        if (depr.length >= 2) lines.push('WITH RECIPROCAL ST DEPRESSION');
        alert = '***MEETS ST ELEVATION MI CRITERIA***';
      }
      if (cfg.stage === 'evolving') lines.push('PATHOLOGIC Q WAVES, AGE INDETERMINATE');
    } else if (stReadable && terr && cfg.stage === 'old') {
      lines.push('PATHOLOGIC Q WAVES, ' + terr.label.toUpperCase() + ' — OLD INFARCT');
    }

    if (stReadable && cfg.ischemia === 'de_winter') {
      lines.push('UPSLOPING ST DEPRESSION WITH TALL SYMMETRIC T WAVES');
      lines.push('***ACUTE CORONARY OCCLUSION SUSPECTED***');
      alert = '***ACUTE CORONARY OCCLUSION SUSPECTED***';
    }
    if (stReadable && (cfg.ischemia === 'wellens_a' || cfg.ischemia === 'wellens_b')) {
      lines.push('ABNORMAL T WAVES, ANTERIOR LEADS');
      lines.push('CONSIDER CRITICAL PROXIMAL LAD STENOSIS');
    }

    // --- other patterns
    var patternNames = {
      hyperk_mild: 'TALL PEAKED T WAVES — CONSIDER HYPERKALEMIA',
      hyperk_moderate: 'WIDE QRS WITH PEAKED T WAVES — CONSIDER HYPERKALEMIA',
      hyperk_severe: 'MARKED QRS WIDENING — CONSIDER SEVERE HYPERKALEMIA',
      hypok: 'PROMINENT U WAVES — CONSIDER HYPOKALEMIA',
      hypocalcemia: 'PROLONGED QT INTERVAL',
      hypercalcemia: 'SHORT QT INTERVAL',
      digoxin: 'ST-T CHANGES CONSISTENT WITH DIGITALIS EFFECT',
      tca: 'WIDE QRS WITH TERMINAL R IN aVR — CONSIDER SODIUM CHANNEL BLOCKADE',
      hypothermia: 'J (OSBORN) WAVES PRESENT — CONSIDER HYPOTHERMIA',
      pericarditis: 'DIFFUSE ST ELEVATION WITH PR DEPRESSION — CONSIDER PERICARDITIS',
      early_repol: 'EARLY REPOLARIZATION PATTERN',
      alternans: 'ELECTRICAL ALTERNANS',
      low_voltage: 'LOW VOLTAGE, ALL LEADS',
      brugada: 'COVED ST ELEVATION V1-V2 — BRUGADA PATTERN',
      pe: 'S1Q3T3 WITH RIGHT PRECORDIAL T INVERSION — CONSIDER ACUTE COR PULMONALE',
      lqts: 'PROLONGED QT INTERVAL'
    };
    if (patternNames[cfg.pattern]) lines.push(patternNames[cfg.pattern]);

    /* QTc flag. Meaningless in a wide complex or chaotic rhythm — repolarisation
     * is abnormal by definition there — so it is only reported when the
     * measurement actually says something. */
    if (meas.qtc && meas.qtc > 480 && stReadable) lines.push('PROLONGED QTc INTERVAL');

    // --- artifact
    var artifactNames = {
      wander: 'BASELINE WANDER — DATA QUALITY MAY BE AFFECTED',
      tremor: 'MUSCLE ARTIFACT — DATA QUALITY MAY BE AFFECTED',
      ac60: 'AC INTERFERENCE DETECTED',
      loose_lead: 'LEAD FAULT DETECTED — CHECK ELECTRODES',
      la_ra_reversal: 'SUSPECT ARM LEAD REVERSAL — CHECK ELECTRODE PLACEMENT',
      dextrocardia: 'POOR R WAVE PROGRESSION WITH NEGATIVE LEAD I — CONSIDER DEXTROCARDIA OR LEAD REVERSAL'
    };
    if (artifactNames[cfg.artifact]) lines.push(artifactNames[cfg.artifact]);

    if (lines.length === 1 && lines[0] === 'NORMAL SINUS RHYTHM') lines.push('NORMAL ECG');

    return {
      alert: alert,
      lines: lines,
      measured: m,
      elevated: elev,
      depressed: depr,
      stReadable: stReadable,
      headline: lines.slice(0, 3).join(', ')
    };
  }

  EKG.interpret = {
    interpret: interpret,
    measure: measure,
    elevatedLeads: elevatedLeads,
    depressedLeads: depressedLeads,
    CONTIGUOUS: CONTIGUOUS,
    rhythmName: rhythmName
  };
})(window.EKG);
