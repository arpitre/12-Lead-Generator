/* explain.js — builds the step-by-step teaching walkthrough.
 *
 * The walkthrough follows the same order a student should read every 12-lead:
 * rate, rhythm, axis, intervals, morphology, ST/T, then anatomy and field
 * implications. Numbers quoted here are measured off the tracing that is
 * actually on screen, so the explanation can never drift from the picture.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  function list(arr, conj) {
    conj = conj || 'and';
    if (!arr || !arr.length) return 'none';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + ' ' + conj + ' ' + arr[1];
    return arr.slice(0, -1).join(', ') + ' ' + conj + ' ' + arr[arr.length - 1];
  }

  function mm(v) { return (v >= 0 ? '' : '-') + Math.abs(v).toFixed(1) + ' mm'; }

  function section(id, title, headline, body, leads) {
    return { id: id, title: title, headline: headline, body: body || [], leads: leads || [] };
  }

  /* -------------------------------------------------------------- rate */

  function rateSection(r, interp) {
    var m = r.measurements, cfg = r.config, body = [];
    var hr = m.hr;

    if (cfg.rhythm === 'asystole') {
      return section('rate', 'Rate', 'No ventricular activity',
        ['There are no QRS complexes to count. Confirm asystole in a second lead and check the patient, not the monitor.']);
    }
    if (cfg.rhythm === 'vfib') {
      return section('rate', 'Rate', 'No organised rate',
        ['Ventricular fibrillation has no countable rate — there is no organised depolarisation, just chaotic wavefronts. The only number that matters now is time to defibrillation.']);
    }

    body.push('There are ' + m.beatCount + ' QRS complexes across this 10-second page, which works out to about ' +
      hr + ' beats per minute. On a real strip you would get to the same place by counting the complexes in six seconds and multiplying by ten, or by the 300 / 150 / 100 / 75 / 60 / 50 rule counting large squares between two R waves.');

    if (m.rrSpread > 0.12) {
      body.push('The R-R intervals are not constant here (they vary by roughly ' + Math.round(m.rrSpread * 100) +
        '% across the strip), so the 300-rule gives a different answer depending on which pair of beats you pick. When the rhythm is irregular, count over the full six or ten seconds instead — that is the only rate that means anything.');
    }

    if (m.atrialRate && m.atrialRate !== hr) {
      body.push('The atrial rate and the ventricular rate are different. The P waves (or flutter waves) are coming at about ' +
        m.atrialRate + ' per minute while the ventricles are only going at ' + hr +
        '. Any time those two numbers disagree, something is happening at the AV node — either blocking, or complete dissociation.');
    }

    var headline = hr + ' bpm';
    if (hr < 50) headline += ' — marked bradycardia';
    else if (hr < 60) headline += ' — bradycardia';
    else if (hr > 150) headline += ' — marked tachycardia';
    else if (hr > 100) headline += ' — tachycardia';
    else headline += ' — normal rate';

    if (hr > 150) {
      body.push('At this rate, ask whether the heart is driving or being driven. A sinus tachycardia is the body responding to something (pain, hypovolaemia, hypoxia, fever, drugs); a re-entrant tachycardia like SVT or flutter is the problem itself. The distinction changes whether you treat the rhythm or the cause.');
    }

    return section('rate', 'Rate', headline, body);
  }

  /* ------------------------------------------------------------ rhythm */

  function rhythmSection(r, interp) {
    var cfg = r.config, m = r.measurements, body = [], headline = EKG.interpret.rhythmName(cfg, m);
    var sched = r.schedule;

    var regular = m.rrSpread < 0.06;
    var hasP = sched.pWaves.length > 0 && r.template.pAmp > 0;

    body.push('Work the rhythm in the same order every time: is it regular, is there a P wave for every QRS, is there a QRS for every P wave, and is the QRS narrow or wide?');

    // Regularity
    if (cfg.rhythm === 'afib' || cfg.rhythm === 'afib_slow' || cfg.rhythm === 'afib_rvr') {
      body.push('**Regularity:** irregularly irregular — there is no pattern to the irregularity at all. Walk a pair of calipers across the R waves and you will never get two intervals to match. That, combined with the absence of P waves and a fibrillating baseline, is atrial fibrillation. The AV node is being bombarded by 400-600 disorganised atrial impulses a minute and passes them through essentially at random.');
    } else if (cfg.avblock === 'mobitz1') {
      body.push('**Regularity:** regularly irregular, in a repeating group pattern. Look at the PR intervals in sequence — each one is longer than the last until a P wave arrives and nothing follows it. Then the cycle restarts with a short PR. That progressive fatigue of the AV node is Wenckebach. A subtle clue: because each PR increment is *smaller* than the one before, the R-R intervals actually get shorter as the group runs out.');
    } else if (cfg.avblock === 'mobitz2' || cfg.avblock === 'twotoone') {
      body.push('**Regularity:** regular except where beats drop out. The PR interval on the conducted beats is constant — it never stretches. Then a P wave appears on time and simply produces nothing. That is Mobitz II: the block is below the AV node in the His-Purkinje system, it is all-or-nothing, and it does not respond to atropine the way Wenckebach does.');
    } else if (cfg.avblock === 'third') {
      body.push('**Regularity:** the P waves are regular and the QRS complexes are regular, but they are regular *at different rates and with no relationship to each other*. March out the P waves with calipers and they keep perfect time straight through the QRS complexes. March out the R waves and they do the same. Nothing is getting from atria to ventricles; a lower pacemaker has taken over to keep the patient alive.');
    } else if (regular) {
      body.push('**Regularity:** regular. The R-R intervals march out evenly across the page.');
    } else {
      body.push('**Regularity:** irregular. Compare several R-R intervals with calipers before deciding whether the irregularity is random or patterned.');
    }

    // P waves
    if (cfg.rhythm === 'aflutter') {
      body.push('**Atrial activity:** there are no discrete P waves. Instead the baseline shows a continuous sawtooth at about 300 per minute, best seen in II, III, aVF and V1. Flutter waves never return to a flat baseline between beats — that is what separates the sawtooth from a run of ordinary P waves. The AV node protects the ventricles by only letting a fraction through, here ' +
        (cfg.flutterConduction == 0 ? 'in a varying ratio' : cfg.flutterConduction + ':1') + '.');
      body.push('The classic trap is 2:1 flutter, which produces a regular narrow tachycardia at almost exactly 150. Any time you see a regular narrow complex tachycardia near 150, assume flutter and go hunting for the second flutter wave hiding inside the T wave.');
    } else if (cfg.rhythm === 'afib' || cfg.rhythm === 'afib_slow' || cfg.rhythm === 'afib_rvr') {
      body.push('**Atrial activity:** no organised P waves — just a wavering, coarse baseline. Do not mistake the fibrillatory waves for P waves; they are irregular in both timing and shape.');
    } else if (EKG.rhythm.isJunctional(cfg.rhythm)) {
      body.push('**Atrial activity:** ' + (cfg.retrogradeP === 'none'
        ? 'no visible P waves at all — they are buried inside the QRS because the atria and ventricles are being depolarised at the same moment.'
        : 'inverted P waves ' + (cfg.retrogradeP === 'after' ? 'immediately after' : 'immediately before') +
          ' each QRS. The impulse is starting at the AV junction and travelling *backwards* into the atria, so the atrial depolarisation vector points up and to the right instead of down and to the left — which is exactly why the P wave is upside down in II, III and aVF.'));
    } else if (EKG.rhythm.isVentricular(cfg.rhythm)) {
      if (cfg.avDissociation) {
        body.push('**Atrial activity:** look carefully and there are sinus P waves marching through the tachycardia at their own independent rate, completely unrelated to the QRS complexes. That is AV dissociation, and it is the single most reliable sign that a wide complex tachycardia is ventricular in origin. The sinus node has not noticed the VT and is still doing its job.');
      } else {
        body.push('**Atrial activity:** no identifiable P waves. In a wide complex tachycardia, absence of P waves does not confirm VT on its own — but combined with the width and the axis it strongly favours it.');
      }
    } else if (hasP) {
      var pRel = (cfg.avblock === 'none' || cfg.avblock === 'first')
        ? 'Every P wave is followed by a QRS and every QRS is preceded by a P wave — 1:1 conduction.'
        : 'Not every P wave is followed by a QRS. Count the P waves and the QRS complexes separately; the mismatch is the block.';
      body.push('**Atrial activity:** upright P waves in II, III and aVF with a consistent shape, which tells you the impulse is starting high in the right atrium at the sinus node and travelling down and to the left. ' + pRel);
    }

    // Width
    var wide = m.qrs >= 120;
    body.push('**QRS width:** ' + m.qrs + ' ms — ' + (wide ? 'wide' : 'narrow') + '. ' +
      (wide
        ? 'Anything at or above 120 ms (three small squares) means the ventricles are not being depolarised through the normal His-Purkinje highway. Either the impulse started in the ventricle, or it started above and hit a blocked bundle branch on the way down, or the muscle itself is conducting badly (hyperkalaemia, sodium channel blockade, pacing).'
        : 'A narrow QRS is genuinely reassuring about origin: it means the impulse came down the normal conduction system, so the rhythm is coming from the atria or the AV junction, not the ventricles.'));

    if (EKG.rhythm.isVentricular(cfg.rhythm) && cfg.rhythm === 'vtach') {
      body.push('**On VT versus SVT with aberrancy:** in the prehospital setting, a wide complex tachycardia in an adult with cardiac risk factors is ventricular tachycardia until proven otherwise. Treating VT as SVT can kill the patient; treating SVT as VT usually does not. Features that push you toward VT: AV dissociation, capture or fusion beats, QRS wider than 140 ms, an extreme "northwest" axis, and concordance across the precordial leads.');
    }

    if (cfg.pacing && cfg.pacing !== 'none') {
      body.push('**Pacing:** the narrow vertical spikes are the pacemaker firing. Each spike should be immediately followed by the chamber it is meant to capture — a P wave for an atrial spike, a wide QRS for a ventricular spike. ' +
        (cfg.pacing === 'failure_capture'
          ? 'Here some spikes are followed by nothing at all. That is failure to capture: the pacemaker is delivering energy, but the myocardium is not responding to it. Causes include lead displacement, a dead battery, electrolyte derangement or ischaemia raising the capture threshold.'
          : cfg.pacing === 'failure_sense'
            ? 'Here some spikes land too early, on top of intrinsic activity the pacemaker should have seen and inhibited. That is undersensing, and a spike landing on a T wave can induce VT.'
            : cfg.pacing === 'av_sequential'
              ? 'Two spikes per beat: the first paces the atrium, the second paces the ventricle after a programmed AV delay. That is dual-chamber pacing.'
              : 'A right ventricular pacing lead depolarises the right ventricle first and the left ventricle late, so a paced beat looks like left bundle branch block: wide, with a broad negative complex in V1 and discordant ST/T changes.'));
    }

    return section('rhythm', 'Rhythm & regularity', headline, body);
  }

  /* -------------------------------------------------------------- axis */

  function axisSection(r) {
    var m = r.measurements, cfg = r.config, body = [];
    var ax = m.qrsAxis;
    if (ax === null || cfg.rhythm === 'vfib' || cfg.rhythm === 'asystole') return null;

    var quadrant;
    if (ax >= -30 && ax <= 90) quadrant = 'normal';
    else if (ax > -90 && ax < -30) quadrant = 'left axis deviation';
    else if (ax > 90 && ax <= 180) quadrant = 'right axis deviation';
    else quadrant = 'extreme axis deviation';

    body.push('The quickest bedside method is the quadrant check: look only at the net direction of the QRS in lead I and in aVF. Both up means the axis is normal. Lead I up and aVF down points left. Lead I down and aVF up points right. Both down is the extreme or "northwest" quadrant.');
    body.push('The reason this works is that lead I looks at the heart from the left side (0 degrees) and aVF looks at it from below (+90 degrees). If the average direction of ventricular depolarisation is heading down and to the left, both leads see it coming toward them and both are positive. Tilt that average vector and one of them turns negative.');
    body.push('Here the mean QRS axis is about **' + ax + ' degrees**, which is ' + quadrant + '.');

    if (quadrant === 'left axis deviation') {
      body.push('Left axis deviation means the depolarisation wave is being pulled up and to the left. The usual reasons are left anterior fascicular block (the anterosuperior part of the left ventricle is being activated late, and from below), left ventricular hypertrophy, a previous inferior infarct with scar that no longer conducts, or an inferiorly placed accessory pathway.');
    } else if (quadrant === 'right axis deviation') {
      body.push('Right axis deviation means the wave is being pulled down and to the right — usually because there is more right ventricle than there should be, or because the left ventricle has lost muscle. Think right ventricular hypertrophy, acute right heart strain from a large pulmonary embolism, chronic lung disease, left posterior fascicular block, a lateral wall infarct, or sodium channel blockade from a tricyclic overdose.');
    } else if (quadrant === 'extreme axis deviation') {
      body.push('The extreme quadrant is genuinely uncommon and is a red flag. In a wide complex tachycardia it strongly favours a ventricular origin. It is also seen in severe hyperkalaemia and in some paced rhythms.');
    } else {
      body.push('A normal axis does not rule anything out — plenty of serious pathology sits inside a normal axis — but it does make fascicular block, significant right heart strain and a ventricular focus less likely.');
    }

    if (cfg.ivcd === 'lafb' || cfg.ivcd === 'bifascicular') {
      body.push('The pattern to confirm left anterior fascicular block is a small q with a tall R in I and aVL, and a small r with a deep S in II, III and aVF — with the axis beyond -45 degrees and a QRS that is still essentially narrow.');
    }

    return section('axis', 'Axis', ax + ' degrees — ' + quadrant, body, ['I', 'aVF']);
  }

  /* --------------------------------------------------------- intervals */

  function intervalSection(r) {
    var m = r.measurements, cfg = r.config, body = [], flags = [];

    if (m.pr) {
      var prNote;
      if (m.pr < 120) prNote = 'short (under 120 ms)';
      else if (m.pr <= 200) prNote = 'normal (120-200 ms)';
      else prNote = 'prolonged (over 200 ms)';
      body.push('**PR interval: ' + m.pr + ' ms — ' + prNote + '.** Measure from the start of the P wave to the start of the QRS. That interval is almost entirely the deliberate delay the AV node imposes so the atria can finish emptying into the ventricles before they contract.');
      if (m.pr > 200) {
        flags.push('long PR');
        body.push('A PR over 200 ms with every P still conducting is first degree AV block. On its own it is rarely a problem, but it tells you the AV node is diseased or drugged, and it is worth knowing before you give anything else that slows AV conduction.');
      }
      if (m.pr < 120 && cfg.ivcd === 'wpw') {
        flags.push('short PR');
        body.push('A short PR with a slurred upstroke on the QRS is pre-excitation. An accessory pathway is bypassing the AV node and depolarising ventricular muscle directly, which starts the QRS early — that slur is the delta wave. The PR is short because the AV node delay was skipped.');
      }
    } else if (cfg.avblock === 'third') {
      body.push('**PR interval: not measurable.** In complete heart block there is no consistent relationship between P waves and QRS complexes, so a PR interval does not exist. If you find yourself measuring a "PR" that changes every beat, stop and ask whether the P waves are related to the QRS at all.');
    } else if (cfg.avblock === 'mobitz1') {
      body.push('**PR interval: variable by design.** In Wenckebach the PR lengthens progressively, so quote the range rather than one number, and describe the pattern.');
    }

    body.push('**QRS duration: ' + m.qrs + ' ms.** Normal is under 120 ms — three small squares. Measure it in the lead where the QRS looks widest, because a lead that is nearly perpendicular to the depolarisation vector can make a wide QRS look deceptively narrow.');
    if (m.qrs >= 120) flags.push('wide QRS');

    body.push('**QT / QTc: ' + m.qt + ' ms / ' + m.qtc + ' ms corrected.** The QT has to be corrected for rate because it shortens as the heart speeds up; the QTc here uses Bazett\'s formula (QT divided by the square root of the R-R interval in seconds). A rough field check is that the QT should be less than half the preceding R-R interval at normal rates.');

    if (m.hr > 110) {
      body.push('Be careful with that corrected value at this rate. Bazett\'s formula systematically over-corrects when the heart is fast, so a tachycardic patient will often show a QTc over 460 ms with a perfectly ordinary QT. Look at the raw QT and the shape of the T wave before treating it as real QT prolongation.');
    }

    var wideRhythm = (r.dominantKind || 'supraventricular') !== 'supraventricular';
    if (wideRhythm) {
      body.push('Treat that QTc as a number the machine printed rather than a finding. When the ventricles are depolarised abnormally, repolarisation is abnormal too, so the QT is prolonged as a consequence of the rhythm — it says nothing about drug effect, electrolytes or torsades risk.');
    } else if (m.qtc > 500) {
      flags.push('QTc > 500 ms');
      body.push('A QTc over 500 ms is the threshold where the risk of torsades de pointes climbs sharply. Repolarisation is taking so long that a premature beat can land on a partially recovered ventricle and set off polymorphic VT. Avoid further QT-prolonging drugs and be ready to defibrillate.');
    } else if (m.qtc > 460) {
      flags.push('QTc prolonged');
    } else if (m.qtc < 350) {
      flags.push('QTc short');
      body.push('A short QT is much less commonly significant than a long one, but it fits with hypercalcaemia and with digitalis effect.');
    }

    var headline = 'PR ' + (m.pr || '--') + ' / QRS ' + m.qrs + ' / QTc ' + m.qtc;
    if (flags.length) headline += '  (' + flags.join(', ') + ')';
    return section('intervals', 'Intervals', headline, body);
  }

  /* ------------------------------------------------------- morphology */

  function morphologySection(r) {
    var cfg = r.config, m = r.measurements, body = [], leads = [];
    var headline = [];
    var kind = r.dominantKind || 'supraventricular';

    if (kind === 'ventricular' && cfg.rhythm !== 'vfib' && cfg.rhythm !== 'asystole') {
      headline.push('wide ventricular complexes');
      body.push('**The QRS complexes are ventricular in origin.** At ' + m.qrs + ' ms they are wide and bizarre, with no relationship to any normal conduction pattern. When an impulse starts inside ventricular muscle instead of arriving through the His-Purkinje system, it has to spread slowly from myocyte to myocyte rather than being distributed along fast conducting fibres — and that slow, disorganised spread is exactly what a wide, notched, strange-looking QRS represents.');
      body.push('The T wave points in the opposite direction to the QRS. That is expected: an abnormal depolarisation sequence forces an abnormal repolarisation sequence, and the two end up discordant.');
      if (cfg.avblock === 'third') {
        body.push('Here the wide complexes are an escape rhythm, not an ectopic tachycardia. When the AV node stops conducting entirely, a pacemaker somewhere below it takes over to keep the patient alive. The lower the escape focus sits, the wider the QRS and the slower and less reliable the rate — a ventricular escape in the 20s or 30s is a fragile rhythm that can stop.');
      }
    }

    if (kind === 'paced') {
      headline.push('paced complexes');
      body.push('**The QRS complexes are paced.** A pacing lead in the right ventricular apex depolarises the right ventricle first and the left ventricle late, cell to cell — mechanically the same problem as a left bundle branch block, and it produces the same picture: a wide QRS, a broad negative complex in V1, and ST/T changes discordant to the QRS.');
      body.push('Do not read those discordant ST changes as ischaemia. As with LBBB, you need the Sgarbossa criteria to see through a paced rhythm.');
    }

    if (cfg.ivcd === 'rbbb' || cfg.ivcd === 'bifascicular') {
      headline.push('RBBB');
      leads = leads.concat(['V1', 'V6', 'I']);
      body.push('**Right bundle branch block.** The right bundle is blocked, so the right ventricle has to wait and then be depolarised slowly, cell to cell, from the left. Because that late activation is unopposed and travels rightward and anteriorly, V1 — which sits right over the right ventricle — records a second, late upward deflection: the R prime of the rSR\' pattern. At the same time leads I and V6, which look from the left, see that late force moving away from them and record a broad slurred S wave. QRS 120 ms or more, rSR\' in V1, wide S in I and V6: that is the whole diagnosis.');
      body.push('Expect T wave inversion in V1 to V3 with RBBB. That is *appropriate* discordance — repolarisation is abnormal because depolarisation was abnormal — and it does not mean ischaemia.');
    }

    if (cfg.ivcd === 'lbbb') {
      headline.push('LBBB');
      leads = leads.concat(['V1', 'V6', 'I']);
      body.push('**Left bundle branch block.** The left bundle is blocked, so the septum is depolarised from right to left instead of the normal left to right, and the whole left ventricle is activated late and slowly. Two consequences follow. First, the normal small septal q wave in I, aVL, V5 and V6 disappears — it cannot exist, because the septal vector has reversed. Second, everything becomes one broad, notched, monophasic R wave in the lateral leads with a deep QS or rS in V1.');
      body.push('LBBB also produces discordant ST segments and T waves: wherever the QRS is mostly negative the ST is elevated, and wherever the QRS is mostly positive the ST is depressed. This is expected and is the reason a new LBBB used to be treated as a STEMI equivalent. Use the Sgarbossa criteria to look through it: concordant ST elevation of 1 mm or more in a lead with a positive QRS, concordant ST depression of 1 mm or more in V1-V3, or excessively discordant ST elevation (more than 25% of the depth of the preceding S wave).');
    }

    if (cfg.ivcd === 'wpw') {
      headline.push('pre-excitation');
      body.push('**Wolff-Parkinson-White pattern.** Short PR, a delta wave slurring the start of the QRS, and a QRS that ends up wide because it is a fusion of two wavefronts — one down the accessory pathway starting early and slowly, one down the AV node arriving normally. The secondary ST-T changes that come with it are frequently mistaken for ischaemia.');
      body.push('Clinically what matters is that this patient can develop a re-entrant tachycardia, and if they go into atrial fibrillation with a fast accessory pathway, AV nodal blocking drugs can push conduction preferentially down the pathway and precipitate ventricular fibrillation.');
    }

    if (cfg.ivcd === 'lafb') { headline.push('LAFB'); }
    if (cfg.ivcd === 'ivcd') {
      headline.push('IVCD');
      body.push('**Nonspecific intraventricular conduction delay.** The QRS is wide but does not fit either bundle branch block pattern. Think about myocardial disease, hyperkalaemia, sodium channel blocking drugs, or a very sick ventricle.');
    }

    if (cfg.chambers === 'lvh' || cfg.chambers === 'lvh_strain') {
      headline.push('LVH');
      leads = leads.concat(['V1', 'V5', 'V6', 'aVL']);
      var interpM = EKG.interpret.measure(r);
      body.push('**Left ventricular hypertrophy.** More muscle generates a bigger electrical signal, so the voltages are large. The Sokolow-Lyon check adds the depth of the S wave in V1 to the height of the tallest R in V5 or V6; 35 mm or more suggests LVH. On this tracing that sum is about ' + interpM.sokolow.toFixed(0) + ' mm.');
      if (cfg.chambers === 'lvh_strain') {
        body.push('The added strain pattern is the important part for interpretation: downsloping ST depression with an asymmetric, inverted T wave in the leads that face the thickened muscle (I, aVL, V5, V6). It is asymmetric — a gentle downslope and a fast return — which is what distinguishes it from the symmetric, deeply inverted T waves of ischaemia. LVH with strain is one of the most common reasons a 12-lead gets over-called as a STEMI.');
      }
    }

    if (cfg.chambers === 'rvh') {
      headline.push('RVH');
      body.push('**Right ventricular hypertrophy.** A dominant R wave in V1 (R taller than S), right axis deviation, and T wave inversion in the right precordial leads. A tall R in V1 has a short differential worth memorising: RVH, posterior infarct, RBBB, WPW type A, and normal variant in children.');
    }

    if (cfg.chambers === 'lae' || cfg.chambers === 'biatrial') {
      body.push('**Left atrial enlargement.** The P wave in lead II is broad and notched (over 120 ms, the "P mitrale"), and in V1 the terminal negative portion of the P wave is deep and wide, because the enlarged left atrium is depolarising late and pointing posteriorly, away from V1.');
    }
    if (cfg.chambers === 'rae' || cfg.chambers === 'biatrial') {
      body.push('**Right atrial enlargement.** A tall, peaked P wave in II, III and aVF (over 2.5 mm, "P pulmonale"). The right atrium depolarises first, so it makes the *front* of the P wave taller rather than the P wave longer.');
    }

    var patternText = {
      hyperk_mild: '**Hyperkalaemia.** The earliest change is the T wave: tall, narrow, symmetric and peaked, as though someone pinched it. High extracellular potassium speeds up repolarisation, which is exactly what a narrow, pointed T wave represents.',
      hyperk_moderate: '**Hyperkalaemia, progressing.** The T waves are peaked, the P waves have flattened and widened, and the PR and QRS have both stretched. Atrial muscle is more sensitive than ventricular muscle, so the P wave fades before the QRS widens.',
      hyperk_severe: '**Severe hyperkalaemia.** The P waves are gone, the QRS is grossly wide, and the QRS is starting to merge with the T wave into a sine wave. This is the pattern immediately before cardiac arrest. Calcium stabilises the myocardium in minutes and buys the time to shift and remove potassium.',
      hypok: '**Hypokalaemia.** Flattened T waves, ST depression, and a prominent U wave after the T. The U wave can be big enough to be mistaken for a second T wave, which artificially lengthens the apparent QT.',
      hypocalcemia: '**Hypocalcaemia.** A long QT produced by a stretched ST segment, with the T wave itself a normal width. That is the distinguishing feature — the ST segment is long, not the T wave.',
      hypercalcemia: '**Hypercalcaemia.** A short QT, produced by an ST segment that is barely there — the T wave seems to come straight off the QRS.',
      digoxin: '**Digitalis effect.** The classic sagging, scooped ST depression (often described as a Salvador Dali moustache), a short QT, and flattened T waves. Note that this is the effect of a therapeutic level, not proof of toxicity. Digitalis *toxicity* shows up as arrhythmias — the near-pathognomonic one being atrial tachycardia with block.',
      tca: '**Sodium channel blockade.** A wide QRS, a tachycardia, right axis deviation, and a terminal R wave in aVR taller than 3 mm. In a tricyclic overdose the QRS width predicts risk: over 100 ms predicts seizures, over 160 ms predicts ventricular arrhythmia. Sodium bicarbonate is the treatment; antiarrhythmics that block sodium channels will make it worse.',
      hypothermia: '**Hypothermia.** The Osborn or J wave is that extra positive hump sitting right at the junction of the QRS and the ST segment, best seen in the inferior and lateral leads. It gets bigger as the temperature falls. Expect bradycardia, prolonged intervals everywhere, and shivering artifact. Handle these patients gently — a cold myocardium is irritable.',
      pericarditis: '**Acute pericarditis.** Diffuse, concave-upward ST elevation that crosses coronary territories, with PR segment depression in the limb leads and PR elevation in aVR. The absence of reciprocal ST depression is the key feature separating this from a STEMI: a blocked artery affects one wall, so some leads must go the other way. Inflammation of the whole pericardium affects everything at once.',
      early_repol: '**Benign early repolarisation.** Concave ST elevation with a notched or slurred J point, typically in the mid-precordial leads, with large upright T waves. It is common in young, healthy, often athletic people. The elevation is stable over time, the ST/T ratio is low, and there are no reciprocal changes.',
      alternans: '**Electrical alternans.** The QRS amplitude alternates from beat to beat because the heart is physically swinging back and forth inside a large pericardial effusion, changing its position relative to the electrodes with every beat. Combined with a tachycardia and low voltage, think tamponade.',
      low_voltage: '**Low voltage.** QRS amplitude under 5 mm in all limb leads or under 10 mm in all precordial leads. Something is attenuating the signal between the heart and the electrodes: pericardial effusion, obesity, COPD with hyperinflated lungs, or a failing myocardium.',
      brugada: '**Brugada Type 1 pattern.** A coved (downsloping) ST elevation of 2 mm or more in V1-V2, descending into an inverted T wave, with an appearance like a partial right bundle branch block. It is a sodium channelopathy associated with sudden cardiac death, and it can be unmasked by fever.',
      pe: '**Acute right heart strain.** The famous S1Q3T3 — an S wave in lead I, a Q wave and inverted T wave in lead III — is present in only a minority of pulmonary emboli and is not specific. The most common ECG finding in PE is simply sinus tachycardia. More useful supporting signs are T wave inversion across V1-V4 and a new right axis or incomplete RBBB.',
      lqts: '**Long QT.** Repolarisation is prolonged, widening the vulnerable window in which a premature beat can trigger torsades de pointes.'
    };
    if (patternText[cfg.pattern]) {
      body.push(patternText[cfg.pattern]);
      headline.push(cfg.pattern.replace(/_/g, ' '));
    }

    var artifactText = {
      la_ra_reversal: '**Arm lead reversal.** Lead I is completely inverted — negative P wave, negative QRS, negative T — while aVF looks entirely normal. That combination is nearly impossible physiologically: real pathology that inverts lead I (dextrocardia, extreme axis) does other things to the rest of the tracing too. Also notice that aVR now looks like a normal lead and aVL looks like aVR. The fix is to swap the electrodes and repeat the 12-lead, not to treat the tracing.',
      dextrocardia: '**Dextrocardia.** Inverted P, QRS and T in lead I, plus R waves that get *smaller* across the precordium instead of larger. Both findings come from the same cause — the heart is on the right, so the chest electrodes are progressively moving away from it. This looks identical to arm lead reversal in the limb leads; the reversed R wave progression is what tells them apart.',
      tremor: '**Muscle tremor artifact.** Fast, irregular, spiky noise that is worst in the limb leads and does not march out with the cardiac cycle. Warm the patient, support their arms, and repeat. Never treat a rhythm you can only see through artifact.',
      ac60: '**AC interference.** A perfectly regular 60 Hz fuzz on every lead. Look for a power cord running across the patient or the cable, unplug what you can, and check electrode contact.',
      loose_lead: '**Lead fault.** One lead shows wild excursions while every other lead stays clean. If a finding appears in exactly one lead and no other lead agrees with it, suspect the electrode before you suspect the patient.',
      wander: '**Baseline wander.** Slow undulation of the baseline from respiration or movement. It matters because it makes ST segments unreadable — and ST segments are the whole reason you acquired a 12-lead.'
    };
    if (artifactText[cfg.artifact]) body.push(artifactText[cfg.artifact]);

    if (!body.length) {
      body.push('QRS morphology is unremarkable: a narrow QRS with normal septal q waves in the lateral leads, and R waves that grow progressively across the precordium as the electrodes move over the left ventricle. The transition — the lead where the R and S are about equal — normally sits at V3 or V4.');
      headline.push('normal QRS morphology');
    }

    return section('morphology', 'Morphology & conduction', headline.join(', '), body, leads);
  }

  /* ------------------------------------------------------------ ST / T */

  function stSection(r, interp) {
    var cfg = r.config, body = [];
    var m = interp.measured;
    var elev = interp.elevated.filter(function (l) { return l !== 'aVR'; });
    var elevAll = interp.elevated;
    var depr = interp.depressed;
    var terr = EKG.morphology.TERRITORIES[cfg.ischemia];

    if (!interp.stReadable) {
      if (cfg.pattern === 'hyperk_severe') {
        return section('st', 'ST segments & T waves', 'No measurable ST segment — the complex is one continuous wave', [
          'There is no ST segment to measure here, and no isoelectric baseline to measure it against. Depolarisation and repolarisation have merged into a single continuous undulation — the QRS runs straight into the T wave with nothing flat in between, which is what the phrase "sine wave" is describing.',
          'That absence is itself the finding. If you cannot tell where the QRS ends and the T wave begins, stop looking for ST elevation and start treating hyperkalaemia. This pattern sits immediately before ventricular fibrillation or asystole.',
          'Calcium first — it stabilises the myocardial membrane within minutes and buys the time to shift and remove the potassium. It does not lower the potassium itself, so shifting agents and definitive removal still have to follow.'
        ]);
      }
      if (cfg.rhythm === 'vfib' || cfg.rhythm === 'asystole') {
        return section('st', 'ST segments & T waves', 'Not applicable',
          ['There is no organised depolarisation, so there is no ST segment to measure. This is a rhythm problem, not a 12-lead interpretation problem.']);
      }
      body.push('**ST segments cannot be interpreted for ischaemia on this tracing.** The ventricles are not being depolarised through the normal conduction system — the impulse is either starting in the ventricle or being delivered by a pacing lead.');
      body.push('When depolarisation takes an abnormal route, repolarisation must follow an abnormal route too. That produces large ST shifts and T wave changes that are *secondary* to the conduction abnormality, always pointing opposite to the main QRS deflection. They look dramatic and they mean nothing about coronary arteries.');
      body.push('This is exactly why a wide complex rhythm frustrates STEMI diagnosis, and why the Sgarbossa criteria exist: they look for the small number of findings — concordance, and excessive discordance — that a conduction abnormality alone cannot explain.');
      return section('st', 'ST segments & T waves', 'Secondary ST-T changes — not assessable for ischaemia', body);
    }

    body.push('Find the isoelectric baseline first. Use the TP segment — the flat stretch between the end of one T wave and the start of the next P wave — as your zero. Then measure the ST segment 40 to 60 ms after the J point, which is where the QRS stops and the ST segment begins.');

    if (!elevAll.length && !depr.length) {
      body.push('There is no significant ST deviation on this tracing: everything sits within a millimetre of the baseline.');
      if (cfg.ischemia === 'none' && cfg.pattern === 'none') {
        body.push('A normal ST segment does not exclude an acute coronary syndrome. Roughly a third of infarcts never produce ST elevation, and the earliest 12-lead in an evolving occlusion is often normal — which is exactly why serial 12-leads matter more than any single one.');
      }
    } else {
      var parts = [];
      elevAll.forEach(function (l) { parts.push(l + ' ' + mm(m.st[l])); });
      depr.forEach(function (l) { parts.push(l + ' ' + mm(m.st[l])); });
      body.push('Measured deviation on this tracing: ' + parts.join(', ') + '.');
    }

    if (terr && cfg.stage !== 'old' && cfg.ischemia !== 'subendocardial' && cfg.ischemia !== 'posterior') {
      body.push('**Why these leads and not others.** An acutely ischaemic wall stops repolarising normally and generates a steady "current of injury" that points outward through the damaged wall. Leads sitting over that wall see the current coming toward them and record ST elevation. Leads on the opposite side of the heart see the same current going away, and record its mirror image as ST depression. That is all a reciprocal change is — not a second problem, but the same problem viewed from behind.');
      body.push('Here the injury current points toward the ' + terr.wall + ', which is why ' + list(elev) + ' show elevation' +
        (depr.length ? ' and ' + list(depr) + ' show the reciprocal depression' : '') + '.');
      body.push('For the finding to count, the elevation has to be in at least two *contiguous* leads — two leads looking at the same wall. The inferior group is II, III and aVF; the lateral group is I, aVL, V5 and V6; the septal group is V1 and V2; the anterior group is V3 and V4. One lead alone is not a STEMI, it is a lead that needs re-checking.');
    }

    if (cfg.ischemia === 'inferior_rv') {
      body.push('**The III-versus-II clue.** Look at which inferior lead is elevated most. Lead III sits further to the right than lead II, so when the elevation in III exceeds the elevation in II, the injury current is pointing rightward as well as downward — which means the right coronary artery, and raises the question of right ventricular involvement. Here III measures ' +
        mm(m.st.III) + ' against ' + mm(m.st.II) + ' in lead II. Reciprocal ST depression in lead I and aVL points the same way.');
      if (m.st.V4R !== undefined) {
        body.push('The confirmation is V4R: ' + mm(m.st.V4R) + ' of ST elevation. Anything at or above 1 mm in V4R means right ventricular infarction.');
      } else {
        body.push('Confirm it with right-sided leads — switch the "Additional leads" dropdown to the right-sided set and regenerate to see V4R appear.');
      }
    }

    if (cfg.ischemia === 'posterior') {
      body.push('**Reading the mirror.** There is no standard lead that looks at the back of the heart, so an isolated posterior infarct produces no ST elevation anywhere on the standard 12-lead. What you get instead is the photographic negative in V1-V3: ST *depression* instead of elevation, a *tall R wave* instead of a deep Q, and an *upright, prominent T wave*. Turn the tracing upside down and hold it to the light and it looks like an ordinary anterior STEMI.');
      body.push('If you suspect it, move V4-V6 around to the back as V7, V8 and V9. Only 0.5 mm of elevation is needed in those leads to call it, because the electrodes are further from the heart with lung in between.');
    }

    if (cfg.ischemia === 'subendocardial') {
      body.push('**Why aVR matters here.** This is not a single occluded artery. Widespread ST depression across many territories with ST elevation in aVR means the whole subendocardium — the innermost, most pressure-starved layer of muscle — is ischaemic. The injury current points away from the left ventricle as a whole, and aVR is the one lead looking at the heart from the right shoulder, so it is the only lead that sees it coming toward it. Left main disease, severe triple vessel disease, or global supply-demand failure from shock, severe anaemia or a sustained tachyarrhythmia.');
      body.push('This patient is not a routine cath lab activation and not necessarily a thrombolytic candidate — but they are extremely sick, and the ischaemia is often secondary to something else you can fix.');
    }

    if (cfg.ischemia === 'de_winter') {
      body.push('**de Winter T waves.** Upsloping ST depression of 1-3 mm at the J point in the precordial leads, running straight up into tall, symmetric T waves, usually with slight elevation in aVR. It is a static pattern — it does not evolve into ST elevation — and it signifies acute proximal LAD occlusion in about 2% of anterior infarcts. Treat it exactly like a STEMI. A student who only knows "STEMI means ST elevation" will miss this one and the patient will lose their anterior wall.');
    }

    if (cfg.ischemia === 'wellens_a' || cfg.ischemia === 'wellens_b') {
      body.push('**Wellens syndrome.** ' + (cfg.ischemia === 'wellens_a'
        ? 'Type A, the less common of the two: the ST segment leaves the J point barely elevated, arcs up into a broad rounded positive hump, then descends through the baseline into a shallower terminal negative trough. That up-then-down shape is what "biphasic" means — and the order matters, because a T wave that goes negative first and then positive is a different animal entirely.'
        : 'Type B, about three quarters of cases: deep, symmetric, rounded T wave inversion in V2 to V4. Symmetric is the operative word — the downstroke and the upstroke mirror each other, unlike the asymmetric T inversion of LVH strain, which slopes down gently and snaps back.') +
        ' The defining context is as important as the tracing: the pattern appears when the patient is *pain free*, the R waves are preserved (no infarct yet), and there are no pathologic Q waves and little or no ST elevation.');
      body.push('Notice the distribution. The changes sit in the anterior chest leads and fade out by V5 and V6, and the limb leads are untouched. That is not a quirk of drawing — it tells you the abnormal repolarisation is pointing backwards, away from the front of the chest, which is exactly where the LAD territory sits.');
      body.push('It represents a critically stenosed proximal LAD that has spontaneously reperfused. The muscle is alive but the artery is about to close again. These patients look well and feel well and have a very high rate of anterior infarction within days. They need a cath lab, not a treadmill.');
    }

    if (cfg.stage === 'hyperacute') {
      body.push('**Hyperacute T waves.** In the first minutes of occlusion, before the ST segment lifts, the T waves over the affected wall become tall, broad-based and fat — bigger than the QRS in some leads. They are easy to dismiss as normal or as hyperkalaemia. The distinction is that hyperkalaemic T waves are narrow and pointed with a tight base, while hyperacute T waves are broad and bulky, and they are confined to a coronary territory rather than being global.');
    }
    if (cfg.stage === 'evolving' || cfg.stage === 'old') {
      body.push('**Q waves.** A pathologic Q wave is over 40 ms wide or deeper than a quarter of the following R wave. It means dead, electrically silent muscle: an electrode over infarcted tissue is effectively looking through a hole in the wall and recording the depolarisation of the opposite wall moving away from it. Q waves take hours to develop and usually persist for life, so they mark territory already lost.');
    }

    if (cfg.ivcd === 'lbbb' && terr) {
      body.push('**Reading ST changes through a left bundle branch block.** LBBB produces its own ST deviation, always *discordant* — opposite in direction to the main QRS deflection. So elevation in V1-V3, where the QRS is negative, is expected and means nothing. What is not expected is ST elevation in a lead where the QRS points *up*. That concordance is Sgarbossa\'s most specific criterion and it is what makes this tracing an infarct rather than just a block.');
    }

    var headline;
    if (elevAll.length && depr.length) headline = 'ST elevation in ' + list(elevAll) + ', reciprocal depression in ' + list(depr);
    else if (elevAll.length) headline = 'ST elevation in ' + list(elevAll);
    else if (depr.length) headline = 'ST depression in ' + list(depr);
    else headline = 'No significant ST deviation';

    return section('st', 'ST segments & T waves', headline, body, elevAll.concat(depr));
  }

  /* ---------------------------------------------------------- anatomy */

  var ARTERY_NOTES = {
    inferior: [
      'The right coronary artery supplies the inferior wall in about 85% of people (the rest are left-dominant, supplied by the circumflex). Critically, in most people the RCA also supplies the SA node and the AV node.',
      'That shared blood supply is why inferior infarcts come with bradycardia and AV block so often — you are not seeing two separate problems, you are seeing one artery starving both the muscle and the conduction system it feeds. Blocks from an inferior MI are usually at the AV node itself, tend to be transient, and often respond to atropine.',
      'Always get right-sided leads with an inferior STEMI. Up to 40% involve the right ventricle, and that changes your treatment.'
    ],
    inferior_rv: [
      'A proximal RCA occlusion — before the right ventricular marginal branch comes off — takes out the inferior wall and the right ventricle together.',
      'A stunned right ventricle cannot generate enough pressure to fill the left ventricle, so these patients become entirely preload dependent. Their blood pressure lives or dies on venous return.',
      'The practical consequence: nitroglycerin, morphine and any other venodilator can drop the pressure precipitously. If they are hypotensive, the treatment is fluid, not vasodilators. This is the single most important reason paramedics acquire V4R.'
    ],
    inferolateral: [
      'Usually a circumflex artery, or a dominant RCA reaching around to supply both walls.',
      'The circumflex is the "electrically quiet" artery — its territory is poorly represented on the standard 12-lead, so circumflex occlusions are the ones most often missed. If the clinical picture screams infarct and the 12-lead is unimpressive, think circumflex and get posterior leads.'
    ],
    inferoposterior: [
      'A dominant RCA or circumflex supplying both the inferior and posterior walls.',
      'Combining inferior elevation with the mirror pattern in V1-V3 makes this a larger infarct than the inferior changes alone suggest. Get posterior leads and right-sided leads both.'
    ],
    posterior: [
      'Usually the circumflex, sometimes the posterior descending branch of a dominant RCA.',
      'Isolated posterior infarction is the classic missed STEMI, because nothing is elevated on a standard 12-lead. It is the reason "ST depression in V1-V3" should always prompt you to think about the back of the heart rather than just labelling it anterior ischaemia.'
    ],
    anterior: [
      'The left anterior descending artery supplies the anterior wall and most of the septum — the largest single territory of any coronary artery.',
      'Anterior infarcts kill more muscle than inferior ones, so the complication you expect is pump failure: pulmonary oedema, cardiogenic shock, and a falling blood pressure. That is the opposite of the bradycardia pattern you expect inferiorly.',
      'Blocks arising from an anterior infarct are below the AV node, in the His-Purkinje system. They do not respond to atropine, they signal a very large infarct, and they carry a much worse prognosis. Have pacing pads on early.'
    ],
    lateral: [
      'The circumflex artery, or a diagonal branch of the LAD.',
      'Lateral involvement usually means a bigger infarct than an isolated territory suggests — look carefully at the inferior and anterior leads for extension.'
    ],
    high_lateral: [
      'The first diagonal branch of the LAD, or a high branch of the circumflex.',
      'This one is easy to miss because only I and aVL are involved, and the elevation is often small. The tell is frequently the reciprocal depression in lead III, which can be more visually striking than the elevation itself. If lead III shows unexplained depression, look hard at I and aVL.'
    ]
  };
  ARTERY_NOTES.septal = ARTERY_NOTES.anterior;
  ARTERY_NOTES.anteroseptal = ARTERY_NOTES.anterior;
  ARTERY_NOTES.extensive_anterior = ARTERY_NOTES.anterior.concat([
    'When the territory extends from V1 all the way to V6 plus I and aVL, the occlusion is very proximal in the LAD and an enormous amount of myocardium is at risk. Expect haemodynamic instability.'
  ]);
  ARTERY_NOTES.anterolateral = ARTERY_NOTES.anterior;

  function anatomySection(r) {
    var cfg = r.config;
    var terr = EKG.morphology.TERRITORIES[cfg.ischemia];
    if (!terr) return null;

    var body = [];
    body.push('**Wall involved:** the ' + terr.wall + '. **Leads that watch it:** ' + terr.leads + '. **Likely artery:** ' + terr.artery + '.');
    var notes = ARTERY_NOTES[cfg.ischemia];
    if (notes) notes.forEach(function (n) { body.push(n); });

    body.push('The mapping from leads to walls is just geometry. The inferior leads (II, III, aVF) point up from the feet, so they watch the bottom of the heart. The lateral leads (I, aVL, V5, V6) sit on the left, so they watch the left wall. V1 and V2 sit directly over the septum, V3 and V4 over the anterior wall. Nothing sits behind the heart, which is why the posterior wall has to be read as a mirror image or with extra electrodes.');

    return section('anatomy', 'Anatomy & vessel', terr.label + ' — ' + terr.artery, body);
  }

  /* ------------------------------------------------------ field notes */

  function fieldSection(r, interp) {
    var cfg = r.config, m = r.measurements, body = [];
    var terr = EKG.morphology.TERRITORIES[cfg.ischemia];

    if (interp.alert) {
      body.push('This tracing meets STEMI criteria. Transmit it, activate early, and keep scene time short — the clock that matters is first medical contact to balloon.');
      body.push('Repeat the 12-lead: serial tracings catch evolution, catch reperfusion, and catch the infarct that was not there on the first one.');
    }

    if (cfg.ischemia === 'inferior' || cfg.ischemia === 'inferior_rv' || cfg.ischemia === 'inferoposterior') {
      body.push('Acquire V4R before giving nitroglycerin. If the right ventricle is involved and the patient is preload dependent, nitro can drop them.');
      body.push('Expect bradycardia and AV block. Have pacing pads on the patient, not in the bag.');
    }
    if (cfg.ischemia === 'extensive_anterior' || cfg.ischemia === 'anteroseptal' || cfg.ischemia === 'anterior') {
      body.push('Watch for pump failure rather than bradycardia. Listen to the lungs, watch the pressure, and be cautious with fluid.');
    }
    if (cfg.ischemia === 'posterior' || cfg.ischemia === 'inferolateral') {
      body.push('Get posterior leads (V7-V9). A posterior infarct is a STEMI that qualifies for reperfusion — but only if somebody looks for it.');
    }

    if (m.hr < 50 && !cfg.pacing) {
      body.push('Symptomatic bradycardia: assess perfusion first. Atropine works at the AV node, so it is most likely to help a narrow-complex block in an inferior MI and least likely to help an infra-nodal block with a wide escape rhythm. If it is not working, move to pacing or chronotropic infusions rather than repeating atropine.');
    }
    if (cfg.avblock === 'mobitz2' || cfg.avblock === 'third') {
      body.push('This block is below the AV node or complete. Atropine is unlikely to help and can occasionally worsen it by speeding the atria without improving conduction. Prepare for transcutaneous pacing.');
    }
    if (cfg.rhythm === 'vtach' || cfg.rhythm === 'polymorphic_vt') {
      body.push('Assess perfusion immediately. Unstable wide complex tachycardia gets synchronised cardioversion (or unsynchronised defibrillation if polymorphic, because the monitor cannot reliably sync to it). Stable VT buys you time for antiarrhythmics.');
    }
    if (cfg.pattern === 'hyperk_severe' || cfg.pattern === 'hyperk_moderate') {
      body.push('Calcium first — it stabilises the myocardial membrane within minutes and does not lower the potassium. Then shift it (beta agonists, bicarbonate, insulin and glucose per your protocol). Ask about dialysis, crush injury, and renal failure.');
    }
    if (cfg.pattern === 'tca') {
      body.push('Sodium bicarbonate for a QRS over 100 ms. Avoid class I antiarrhythmics — they block the same channel the poison does.');
    }
    if (cfg.artifact && cfg.artifact !== 'none') {
      body.push('Before treating anything on this tracing, fix the acquisition. A 12-lead you cannot trust is worse than no 12-lead, because it invites a decision built on an artifact.');
    }
    if (cfg.ischemia === 'wellens_a' || cfg.ischemia === 'wellens_b') {
      body.push('The patient is pain-free and looks well. Resist the urge to downgrade them — this pattern predicts anterior infarction within days. Transport to a PCI-capable facility and hand over the pattern by name.');
    }

    body.push('Whatever the tracing shows, treat the patient in front of you. The 12-lead is one piece of information alongside the story, the vital signs and the way they look.');

    return section('field', 'What it means in the field', 'Prehospital implications', body);
  }

  /* --------------------------------------------------------- mimics */

  function mimicSection(r, interp) {
    var cfg = r.config, body = [];
    var mimics = [];

    if (interp.alert || cfg.ischemia !== 'none') {
      mimics.push('**Benign early repolarisation** — concave elevation, notched J point, young patient, no reciprocal change, stable over time.');
      mimics.push('**Pericarditis** — diffuse elevation crossing territories, PR depression, no reciprocal change.');
      mimics.push('**LVH with strain** — big voltages, and the ST/T changes follow the voltage rather than a coronary territory.');
      mimics.push('**Left bundle branch block** — discordant ST changes are expected; use Sgarbossa to look through them.');
      mimics.push('**Ventricular paced rhythm** — same discordance problem as LBBB.');
      mimics.push('**Brugada, hyperkalaemia and hypothermia** each produce ST elevation with a distinctive shape that is not injury.');
      body.push('Before you commit to acute coronary occlusion, run the mimics:');
      mimics.forEach(function (mm2) { body.push(mm2); });
      body.push('The two questions that resolve most of these: does the ST deviation respect a coronary territory, and is there reciprocal change somewhere? A blocked artery affects one wall and produces a mirror somewhere else. Most mimics do neither.');
    } else if (cfg.pattern === 'lvh_strain' || cfg.pattern === 'pericarditis' || cfg.pattern === 'early_repol') {
      body.push('This is a STEMI mimic. Be able to say out loud why it is not an infarct — that reasoning is what stops an unnecessary cath lab activation, and more importantly, what stops you from dismissing the real thing later.');
    } else {
      return null;
    }

    return section('mimics', 'Mimics & how to exclude them', 'Rule out the look-alikes', body);
  }

  /* ------------------------------------------------------------ build */

  function build(result) {
    var interp = EKG.interpret.interpret(result);
    var sections = [];

    sections.push(rateSection(result, interp));
    sections.push(rhythmSection(result, interp));
    var a = axisSection(result); if (a) sections.push(a);
    sections.push(intervalSection(result));
    sections.push(morphologySection(result));
    sections.push(stSection(result, interp));
    var an = anatomySection(result); if (an) sections.push(an);
    var mi = mimicSection(result, interp); if (mi) sections.push(mi);
    sections.push(fieldSection(result, interp));

    return { sections: sections, interp: interp };
  }

  EKG.explain = { build: build, list: list };
})(window.EKG);
