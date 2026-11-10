/* treatment.js — what to DO about the tracing.
 *
 * Every rhythm, block, infarct pattern and metabolic pattern the generator
 * can draw has its own management entry here: the prehospital steps a
 * paramedic takes, with adult drug doses, and a line on definitive hospital
 * care. explain.js stitches together the entries that apply to the case on
 * screen, most time-critical first.
 *
 * Basis: American Heart Association adult ACLS (2020 guidelines and the 2025
 * update) and the 2025 ACC/AHA/ACEP/NAEMSP/SCAI acute coronary syndromes
 * guideline. Adult doses only. This is teaching material -- the reader's own
 * medical direction and local protocol always win, and the text says so.
 *
 * An entry is { title, field: [steps], hospital: 'one line', priority }.
 * Lower priority numbers are listed first.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  /* ---- building blocks quoted in more than one entry ------------------ */

  var CARDIOVERT = 'Synchronized cardioversion, with sedation first if the patient is conscious and time allows (e.g. midazolam 1-2 mg IV or etomidate 0.1-0.15 mg/kg per protocol).';
  var BRADY_DRUGS = 'Atropine 1 mg IV push, repeated every 3-5 minutes to a maximum of 3 mg.';
  var BRADY_NEXT = 'If atropine fails: transcutaneous pacing (set the rate to 60-80/min, raise the current until every spike captures, then confirm a pulse with each paced beat; give analgesia or sedation) and/or an infusion of epinephrine 2-10 mcg/min or dopamine 5-20 mcg/kg/min.';
  var ARREST = 'High-quality CPR with minimal interruptions, epinephrine 1 mg IV/IO every 3-5 minutes, an advanced airway with waveform capnography, and a search for reversible causes (the Hs and Ts).';
  var SHOCK = 'Defibrillate immediately at the manufacturer\'s dose (biphasic 120-200 J; if unknown use the maximum), resume CPR at once for 2 minutes, then reassess. Shock every 2 minutes while the rhythm stays shockable.';
  var ACS_BASE = 'Aspirin 162-324 mg, non-enteric, chewed - unless truly allergic or actively bleeding.';
  var NITRO = 'Nitroglycerin 0.4 mg sublingual every 5 minutes, up to 3 doses, for ongoing ischaemic pain - only if systolic BP is at least 90 mmHg (and not more than 30 mmHg below baseline), there is no right ventricular infarct, and no phosphodiesterase inhibitor has been taken (sildenafil or vardenafil within 24 hours, tadalafil within 48 hours).';
  var OXYGEN = 'Oxygen only if SpO2 is below 90%, or the patient is short of breath or in heart failure; titrate, do not give it routinely.';
  var PAIN = 'Pain not relieved by nitroglycerin: fentanyl 25-50 mcg IV (or morphine 2-4 mg IV), repeated cautiously while watching the blood pressure.';

  function entry(title, field, hospital, priority) {
    return { title: title, field: field, hospital: hospital || '', priority: priority === undefined ? 50 : priority };
  }

  /* ----------------------------------------------------------- rhythms */

  function rhythmEntry(cfg, m) {
    var hr = m.hr;
    switch (cfg.rhythm) {
      case 'vfib':
        return entry('Ventricular fibrillation - cardiac arrest', [
          'Confirm unresponsive and pulseless, start compressions, and get the pads on. Nothing else matters until the first shock is delivered.',
          SHOCK,
          'After the 2nd shock: epinephrine 1 mg IV/IO, repeated every 3-5 minutes.',
          'After the 3rd shock: amiodarone 300 mg IV/IO bolus (a second dose of 150 mg may follow), OR lidocaine 1-1.5 mg/kg (then 0.5-0.75 mg/kg).',
          'Refractory VF: change the pad position (anterior-posterior), look for and treat reversible causes, and consider early transport for ECMO-capable or cath-lab care where your system supports it.',
          'After return of circulation: 12-lead ECG, keep SpO2 90-98% and systolic BP at least 90 mmHg (MAP 65 or more), avoid hyperventilation, and begin temperature control per protocol.'
        ], 'Coronary angiography if the post-arrest ECG shows STEMI or the cause is thought to be cardiac; targeted temperature management; ICD before discharge if no reversible cause is found.', 1);

      case 'asystole':
        return entry('Asystole - cardiac arrest', [
          'Check the patient, then check the monitor: confirm in a second lead, check the leads and gain, and make sure this is not fine VF.',
          'Asystole is NOT a shockable rhythm. ' + ARREST,
          'Work the reversible causes hard, because they are the only route to a pulse: hypoxia, hypovolaemia, hyperkalaemia, hydrogen ion (acidosis), hypothermia, tension pneumothorax, tamponade, toxins, thrombosis (coronary or pulmonary).',
          'Atropine and pacing are no longer recommended for asystole.',
          'Consider termination of resuscitation per your protocol when asystole persists despite good ALS and no reversible cause is found (a persistently low end-tidal CO2, below 10 mmHg after 20 minutes, supports that decision).'
        ], 'Post-arrest care if circulation returns. Outcome depends almost entirely on finding a reversible cause.', 1);

      case 'vtach':
        return entry('Monomorphic ventricular tachycardia', [
          'First question: is there a pulse? **No pulse** - treat exactly as VF: CPR, immediate unsynchronized defibrillation, epinephrine 1 mg every 3-5 minutes, amiodarone 300 mg (then 150 mg) or lidocaine 1-1.5 mg/kg.',
          '**Pulse but unstable** (hypotension, altered mental status, shock, ischaemic chest pain, acute heart failure): ' + CARDIOVERT + ' Use the manufacturer\'s recommended energy - traditionally 100 J biphasic to start, escalating - and the maximum setting if you do not know it.',
          '**Pulse and stable:** 12-lead ECG, IV access, and an antiarrhythmic - amiodarone 150 mg IV over 10 minutes (repeat as needed, then 1 mg/min for 6 hours), OR procainamide 20-50 mg/min until the rhythm breaks, hypotension develops, the QRS widens by more than 50%, or 17 mg/kg has been given (avoid in heart failure or a long QT), OR sotalol 1.5 mg/kg (about 100 mg) IV over 5 minutes (avoid in a long QT).',
          'Do not give verapamil or diltiazem for a wide-complex tachycardia of uncertain origin - it can cause collapse if the rhythm is VT. Adenosine 6 mg may be tried only when the rhythm is regular and monomorphic and the diagnosis is in doubt.',
          'Be ready to cardiovert the moment a stable patient stops being stable.'
        ], 'Treat ischaemia and correct potassium and magnesium; echocardiography; electrophysiology study, catheter ablation and/or an ICD.', 2);

      case 'polymorphic_vt':
        return entry('Polymorphic VT / torsades de pointes', [
          '**Pulseless or unstable:** unsynchronized defibrillation at the full defibrillation dose - the monitor cannot synchronize to a rhythm whose axis keeps changing. Follow with CPR and the cardiac arrest algorithm if there is no pulse.',
          '**Magnesium sulfate 1-2 g IV** - diluted and given over about 15 minutes if there is a pulse, as a push over 1-2 minutes in arrest. It is the first-line drug for torsades even when the serum magnesium is normal.',
          'Torsades usually comes in bursts that stop on their own and return. Between bursts, look at the QT in the sinus beats and stop every QT-prolonging drug (ondansetron, haloperidol, droperidol, methadone, macrolides, fluoroquinolones and others).',
          'Avoid amiodarone, procainamide and sotalol when the QT is long - they prolong it further.',
          'If the baseline QT is NOT prolonged, polymorphic VT is most often acute ischaemia: treat as an acute coronary syndrome, and amiodarone or a beta blocker is then appropriate.'
        ], 'Potassium replaced to 4.5-5.0 mEq/L, magnesium infusion, and overdrive pacing or an isoproterenol infusion to keep the rate above about 90-100/min, which shortens the QT and suppresses recurrence.', 2);

      case 'idioventricular':
        return entry('Idioventricular (ventricular escape) rhythm', [
          'This is the heart\'s last-ditch pacemaker. **Never suppress it** - lidocaine or amiodarone can abolish the only rhythm the patient has and leave asystole.',
          'Check for a pulse. No pulse is PEA: start CPR and work the Hs and Ts.',
          'With a pulse and poor perfusion, treat it as a symptomatic bradycardia: ' + BRADY_DRUGS + ' It often fails because the escape focus is below the reach of the vagus.',
          BRADY_NEXT,
          'Look for the cause: complete heart block, inferior or large anterior infarction, hyperkalaemia, drug toxicity (beta blockers, calcium channel blockers, digoxin), profound hypoxia.'
        ], 'Transvenous pacing, treatment of the cause, and usually a permanent pacemaker.', 4);

      case 'aivr':
        return entry('Accelerated idioventricular rhythm (AIVR)', [
          'Usually a benign, self-limiting rhythm - classically seen in the first minutes after a blocked coronary artery reopens (after fibrinolysis, during PCI, or spontaneously). It is often good news.',
          '**Do not treat it with antiarrhythmics.** It is not VT, it rarely degenerates, and suppressing a ventricular focus can leave the patient with a slower rhythm or none.',
          'Assess perfusion and observe. If the loss of atrial kick drops the blood pressure, atropine 1 mg IV to speed the sinus node above the ventricular focus is the usual answer.',
          'Record a 12-lead once sinus rhythm returns and treat the underlying infarct or cause (digoxin toxicity, electrolytes, cocaine).'
        ], 'Observation, and completion of reperfusion therapy for the infarct that produced it.', 20);

      case 'afib':
      case 'afib_slow':
      case 'afib_rvr':
        if (hr > 100) {
          return entry('Atrial fibrillation with rapid ventricular response', [
            '**Unstable because of the rate** (usually well above 150 with hypotension, shock, ischaemic pain or pulmonary oedema): ' + CARDIOVERT + ' The 2025 AHA guidelines call a first biphasic shock of at least 200 J reasonable for atrial fibrillation, escalating if it fails.',
            'Ask why the rate is fast before treating the number. Sepsis, hypovolaemia, bleeding, pulmonary embolism, hypoxia and pain all drive AF fast - treat those, and the rate follows. Slowing a compensatory tachycardia can make the patient worse.',
            '**Stable - rate control:** diltiazem 0.25 mg/kg IV (15-20 mg) over 2 minutes; if needed after 15 minutes, 0.35 mg/kg (20-25 mg); then 5-15 mg/hour. OR metoprolol 5 mg IV over 2 minutes, repeated every 5 minutes to a total of 15 mg.',
            'Avoid diltiazem and verapamil in decompensated heart failure or a known low ejection fraction; amiodarone 150 mg IV over 10 minutes is the usual alternative.',
            '**Wide, bizarre and irregular at 200 or more is pre-excited AF (WPW).** No adenosine, no calcium channel blocker, no beta blocker, no digoxin - they can drive conduction down the accessory pathway into VF. Use procainamide (20-50 mg/min, maximum 17 mg/kg) or cardiovert.',
            'Note when the AF started. Beyond 48 hours (or unknown) there may be clot in the left atrium, so elective cardioversion waits for anticoagulation or a transoesophageal echo - but never delay an emergency cardioversion for that reason.'
          ], 'Anticoagulation guided by the CHA2DS2-VASc score, a rate- or rhythm-control strategy, and in selected patients cardioversion or catheter ablation.', 10);
        }
        return entry('Atrial fibrillation, controlled rate', [
          'No emergency rhythm treatment is needed when the ventricular rate is under about 100-110 and the patient is perfusing. Treat whatever they actually called for.',
          'Ask about anticoagulants and rate-control drugs - missed doses explain a rate that climbs later, and an anticoagulated patient changes how you treat trauma and stroke.',
          'New neurological deficit in a patient with AF is a stroke until proven otherwise: note the last-known-well time and go to a stroke centre.',
          'A slow, REGULAR ventricular rhythm in a patient with AF is not controlled AF - it is complete heart block with an escape rhythm, and should make you think of digoxin toxicity.'
        ], 'Stroke-risk assessment and anticoagulation, and long-term rate or rhythm control.', 40);

      case 'aflutter':
        return entry('Atrial flutter', [
          'Managed like atrial fibrillation, with one useful difference: flutter is an organized circuit and converts very easily with electricity.',
          '**Unstable:** ' + CARDIOVERT + ' Flutter often converts at 50-100 J; the 2025 AHA guidelines also accept starting at 200 J to make the first shock count.',
          '**Stable with a fast rate:** diltiazem 0.25 mg/kg IV (15-20 mg) over 2 minutes, repeat 0.35 mg/kg after 15 minutes if needed; OR metoprolol 5 mg IV every 5 minutes up to 15 mg. Rate control is harder than in AF - the rate tends to step down (150 to 100 to 75) rather than slow smoothly.',
          'Adenosine will not terminate flutter. It briefly blocks the AV node and exposes the flutter waves, which is diagnostic, not therapeutic.',
          'The stroke risk is the same as in atrial fibrillation, so the same 48-hour and anticoagulation rules apply.'
        ], 'Anticoagulation as for AF; catheter ablation of the cavotricuspid isthmus cures typical flutter in more than 90% of patients.', 12);

      case 'svt':
        return entry('Supraventricular tachycardia (AVNRT / AVRT)', [
          '**Unstable:** ' + CARDIOVERT + ' Use your device\'s recommended energy; a regular narrow rhythm traditionally converts at 50-100 J biphasic.',
          '**Stable - vagal manoeuvres first.** The modified Valsalva works best: blow into a 10 mL syringe for 15 seconds sitting up, then immediately lie flat with the legs raised to 45 degrees. It converts roughly 40% of patients.',
          '**Adenosine 6 mg rapid IV push** into a large proximal vein, followed at once by a 20 mL saline flush. No conversion in 1-2 minutes: **12 mg** (some protocols allow that dose to be repeated once). Warn the patient about the few seconds of chest tightness and impending doom, and run a strip while you push.',
          'Halve the adenosine dose (3 mg) if given through a central line, or in patients taking dipyridamole or carbamazepine or with a transplanted heart. Avoid it in severe asthma.',
          'If adenosine fails or the rhythm keeps returning: diltiazem 0.25 mg/kg IV (15-20 mg) over 2 minutes, or metoprolol 5 mg IV every 5 minutes up to 15 mg.',
          'Record a 12-lead after conversion and look for a short PR and a delta wave (WPW).'
        ], 'Usually discharged after conversion; recurrent episodes are cured by catheter ablation.', 12);

      case 'atach':
        return entry('Atrial tachycardia', [
          'An ectopic atrial focus, so it behaves differently from re-entrant SVT: vagal manoeuvres and adenosine (6 mg, then 12 mg) may stop it, but more often only slow the ventricles for a few seconds and show the abnormal P waves marching on.',
          '**Unstable:** ' + CARDIOVERT,
          '**Stable:** rate control with diltiazem 0.25 mg/kg IV (15-20 mg) over 2 minutes or metoprolol 5 mg IV every 5 minutes up to 15 mg.',
          'Atrial tachycardia WITH AV block is the classic rhythm of digoxin toxicity. If the patient takes digoxin, do not cardiovert unless they are dying, check the potassium, and tell the hospital.',
          'Look for a driver: stimulants, theophylline, hypoxia, electrolyte disturbance, structural heart disease.'
        ], 'Treatment of the cause, a beta blocker or calcium channel blocker, and ablation for incessant tachycardia. Digoxin-specific antibody fragments if digoxin is responsible.', 14);

      case 'mat':
        return entry('Multifocal atrial tachycardia', [
          '**Treat the lungs, not the rhythm.** MAT is a marker of severe underlying illness - most often a COPD exacerbation or hypoxia - and it settles when that is treated.',
          'Titrated oxygen (88-92% in COPD), bronchodilators, CPAP or BiPAP if indicated, and treatment of the infection or heart failure behind it.',
          'Cardioversion does not work and adenosine does not work - there is no re-entry circuit to break. Do not mistake it for atrial fibrillation: there ARE P waves, at least three different shapes of them.',
          'Magnesium sulfate 2 g IV over 15-20 minutes is reasonable and safe. Correct a low potassium.',
          'Theophylline toxicity is a classic cause.'
        ], 'Correction of hypoxia, potassium and magnesium. If the rate itself needs slowing, verapamil or diltiazem is preferred; beta blockers are used cautiously in bronchospasm.', 30);

      case 'wandering':
        return entry('Wandering atrial pacemaker', [
          'A benign rhythm - the dominant pacemaker is shifting between the sinus node and other atrial sites, usually from high vagal tone. It is common in athletes, in the young, and during sleep.',
          'No treatment. It is the slow cousin of multifocal atrial tachycardia (same changing P waves, rate under 100) and needs attention only if it is a clue to lung disease or digoxin excess.'
        ], 'None needed.', 80);

      case 'junctional':
        return entry('Junctional escape rhythm', [
          'The AV junction has taken over because the sinus node is failing or its impulses are not getting through. The escape rhythm is protective - do not suppress it.',
          'Stable and perfusing: monitor, 12-lead, IV access, and look for the cause.',
          'Symptomatic (hypotension, altered mental status, chest pain, shock): ' + BRADY_DRUGS + ' A junctional focus usually responds.',
          BRADY_NEXT,
          'Causes to ask about: beta blockers, calcium channel blockers, digoxin, clonidine, inferior MI, hyperkalaemia, hypothermia, hypothyroidism, sick sinus syndrome.'
        ], 'Stop the offending drug, treat the cause; a permanent pacemaker if sinus node disease persists.', 30);

      case 'accel_junctional':
        return entry('Accelerated junctional rhythm', [
          'The rate is adequate, so the rhythm itself rarely needs treatment. What matters is why the junction is irritable.',
          'Classic causes: **digoxin toxicity**, inferior myocardial infarction, myocarditis, recent cardiac surgery, and excess catecholamines.',
          'Get a 12-lead, look for an infarct, and take a careful medication history. If digoxin toxicity is possible, avoid cardioversion and report it.'
        ], 'Treatment of the cause; digoxin-specific antibody fragments for digoxin toxicity.', 45);

      case 'junctional_tach':
        return entry('Junctional tachycardia', [
          'Enhanced automaticity in the AV junction - uncommon in adults, and it should make you think of digoxin toxicity, myocardial ischaemia, myocarditis, or stimulant use.',
          'Electrical cardioversion is usually ineffective (it is not a re-entry rhythm) and is dangerous in digoxin toxicity.',
          'If the rate is causing symptoms: a beta blocker (metoprolol 5 mg IV every 5 minutes up to 15 mg) or diltiazem 0.25 mg/kg IV, provided the blood pressure allows. Amiodarone 150 mg over 10 minutes is the alternative.',
          'Treat the cause above all.'
        ], 'Digoxin-specific antibody fragments where indicated; otherwise beta blockade and treatment of the underlying disease.', 20);

      case 'sinus_tach':
        return entry('Sinus tachycardia', [
          '**Sinus tachycardia is a vital sign, not a rhythm disorder. Find the reason and treat that.** Never slow it with a beta blocker or calcium channel blocker for its own sake - the rate may be the only thing maintaining cardiac output.',
          'Work through the causes: hypovolaemia or bleeding, sepsis and fever, hypoxia, pain and anxiety, pulmonary embolism, heart failure, anaemia, hypoglycaemia, hyperthyroidism, stimulants and anticholinergics, alcohol or benzodiazepine withdrawal.',
          'Treat accordingly: oxygen if hypoxic, fluid for hypovolaemia (20-30 mL/kg for septic shock per protocol), analgesia, antipyretics, glucose.',
          'At rates above about 150 in an adult, reconsider the diagnosis - look for flutter waves and consider SVT. The maximum sinus rate is roughly 220 minus age.'
        ], 'Diagnosis and treatment of the underlying cause.', 60);

      case 'sinus_brady':
        return entry('Sinus bradycardia', [
          'Treat the patient, not the number. A fit person at 45/min who is warm, alert and normotensive needs nothing.',
          'Treat only when the rate is causing poor perfusion: hypotension, altered mental status, signs of shock, ischaemic chest pain, or acute heart failure.',
          'Then: ' + BRADY_DRUGS,
          BRADY_NEXT,
          'Look for the cause: beta blockers, calcium channel blockers, digoxin, clonidine, opioids; inferior MI; hypoxia; hypothermia; raised intracranial pressure (Cushing\'s response); hypothyroidism; hyperkalaemia.',
          'Beta blocker or calcium channel blocker overdose needs more than atropine - calcium, glucagon (beta blocker) and high-dose insulin are hospital therapies worth an early alert.'
        ], 'Treatment of the cause; permanent pacing for symptomatic sinus node dysfunction.', 40);

      case 'sinus_arrhythmia':
        return entry('Sinus arrhythmia', [
          'Normal. The rate speeds up on inspiration and slows on expiration because breathing changes vagal tone. It is most marked in the young and fit and is a sign of a healthy autonomic system.',
          'No treatment. The only task is not to mistake it for atrial fibrillation - every beat has the same P wave in front of it.'
        ], 'None needed.', 90);

      default:
        return entry('Normal sinus rhythm', [
          'The rhythm needs no treatment. Manage whatever brought you to the patient.',
          'A normal rhythm - and a normal 12-lead - does not exclude an acute coronary syndrome, pulmonary embolism or aortic dissection. If the story is worrying, repeat the 12-lead every 5-10 minutes and whenever symptoms change.'
        ], '', 95);
    }
  }

  /* ---------------------------------------------------------- AV block */

  function blockEntry(cfg) {
    switch (cfg.avblock) {
      case 'first':
        return entry('First-degree AV block', [
          'No treatment - every impulse still reaches the ventricles.',
          'Note it, because it changes what you give next: be cautious with anything else that slows the AV node (beta blockers, diltiazem, verapamil, digoxin, amiodarone, adenosine).',
          'A new long PR with chest pain suggests inferior ischaemia; with fever and a new murmur it suggests an aortic root abscess.'
        ], 'Review of AV-nodal drugs. No pacing unless it progresses.', 70);
      case 'mobitz1':
        return entry('Second-degree AV block, Mobitz I (Wenckebach)', [
          'The block is inside the AV node and is usually benign and transient. Most patients need monitoring only.',
          'If the dropped beats are causing symptoms: ' + BRADY_DRUGS + ' Because the block is nodal, atropine usually works.',
          'Common causes: inferior MI (RCA territory), high vagal tone in athletes and during sleep, and AV-nodal drugs.',
          'It rarely progresses to complete block and rarely needs pacing - the opposite of Mobitz II.'
        ], 'Observation and treatment of the cause. Pacemaker only for persistent symptoms.', 45);
      case 'mobitz2':
      case 'twotoone':
        return entry(cfg.avblock === 'twotoone' ? '2:1 AV block' : 'Second-degree AV block, Mobitz II', [
          '**Put the pacing pads on now, before the patient needs them.** The block is below the AV node, in the His-Purkinje system, and it can become complete heart block or asystole without warning.',
          'Symptomatic: go to transcutaneous pacing early - set 60-80/min, increase the current until every spike captures, confirm a femoral pulse with each paced beat, and give analgesia or sedation (fentanyl 25-50 mcg and/or midazolam 1-2 mg IV).',
          'Atropine 1 mg IV may be tried but is often ineffective and can worsen the conduction ratio by speeding the atria. Do not delay pacing for it.',
          'If pacing fails to capture or is not tolerated: epinephrine 2-10 mcg/min or dopamine 5-20 mcg/kg/min.',
          cfg.avblock === 'twotoone'
            ? '2:1 block cannot be labelled Mobitz I or II from the pattern alone, because you never see two conducted beats in a row. A wide QRS means assume it is infranodal (Mobitz II) and treat it that way.'
            : 'A new Mobitz II with chest pain points to a large anterior infarct - treat as an acute coronary syndrome and expect deterioration.'
        ], 'Transvenous pacing, then a permanent pacemaker in almost every case.', 6);
      case 'third':
        return entry('Third-degree (complete) AV block', [
          '**Pads on, and pace if there is any sign of poor perfusion.** Transcutaneous pacing at 60-80/min; raise the current until every spike is followed by a wide QRS, then confirm mechanical capture with a pulse. Sedate and treat pain.',
          cfg.escapeSite === 'ventricular'
            ? 'A wide ventricular escape rhythm is slow and unreliable and will not respond to atropine. Do not waste time on it - pace, or start epinephrine 2-10 mcg/min or dopamine 5-20 mcg/kg/min.'
            : 'With a narrow junctional escape the block is at the AV node: atropine 1 mg IV (every 3-5 minutes to 3 mg) is reasonable while the pacer is prepared, and sometimes works.',
          'Never give lidocaine or amiodarone to "treat the wide beats" - they are the escape rhythm keeping the patient alive.',
          'Acquire a 12-lead looking for an infarct (inferior MI gives nodal block that often recovers; anterior MI gives infranodal block with a poor prognosis). Consider hyperkalaemia and AV-nodal drug toxicity.'
        ], 'Transvenous pacing and a permanent dual-chamber pacemaker, unless a reversible cause (inferior MI, drugs, hyperkalaemia, Lyme disease) is corrected.', 5);
    }
    return null;
  }

  /* ------------------------------------------------------------ ectopy */

  function ectopyEntry(cfg) {
    switch (cfg.ectopy) {
      case 'pac':
      case 'pjc':
        return entry(cfg.ectopy === 'pac' ? 'Premature atrial complexes' : 'Premature junctional complexes', [
          'Benign and common. No treatment.',
          'Frequent ones are driven by caffeine, nicotine, alcohol, stimulants, stress, sleep loss, hypoxia or low potassium - address those. In a patient with lung disease or heart failure they can herald atrial fibrillation.'
        ], 'None needed.', 85);
      case 'pvc_uni':
      case 'pvc_multi':
      case 'bigeminy':
      case 'trigeminy':
      case 'couplet':
        return entry('Premature ventricular complexes', [
          '**Do not suppress PVCs with antiarrhythmics.** Treating ectopy for its own sake does not prevent arrest, and suppressing it after an infarct has been shown to increase mortality.',
          'Treat what is irritating the ventricle: hypoxia (oxygen if SpO2 is under 90%), ischaemia (12-lead, treat as ACS if it fits), pain, low potassium or magnesium, and stimulants (cocaine, amphetamines, caffeine) or digoxin toxicity.',
          cfg.ectopy === 'bigeminy'
            ? 'In bigeminy, check a pulse against the monitor: PVCs often do not generate a pulse, so the effective heart rate may be HALF what the monitor counts - a functional bradycardia.'
            : 'Multifocal PVCs, couplets, and PVCs landing on the preceding T wave (R-on-T) mean a more irritable ventricle: keep the pads within reach and look harder for a cause.',
          'Healthy people have isolated unifocal PVCs. In the absence of symptoms or heart disease they need nothing.'
        ], 'Electrolyte correction; an echocardiogram if frequent; beta blockers or ablation for a very high PVC burden.', 50);
      case 'nsvt':
        return entry('Non-sustained ventricular tachycardia', [
          'A run of three or more ventricular beats lasting under 30 seconds. It needs no shock and no bolus if it stops on its own - but it is a warning.',
          'Apply the pads, get a 12-lead, establish IV access, and look for ischaemia, low potassium, low magnesium, a long QT, and stimulant or drug toxicity.',
          'Recurrent runs with symptoms: amiodarone 150 mg IV over 10 minutes per protocol. Magnesium sulfate 2 g IV if the QT is long or the runs are polymorphic.',
          'If it sustains, manage it as ventricular tachycardia.'
        ], 'Potassium kept above 4.0 mEq/L and magnesium above 2.0 mg/dL, evaluation for coronary and structural heart disease, and consideration of a beta blocker or ICD.', 15);
    }
    return null;
  }

  /* -------------------------------------------------------- conduction */

  function conductionEntry(cfg) {
    switch (cfg.ivcd) {
      case 'rbbb':
        return entry('Right bundle branch block', [
          'No treatment for the block itself; it is found in many healthy hearts.',
          'ST elevation is still readable in RBBB - it does not hide a STEMI the way LBBB does.',
          'A NEW RBBB matters in two settings: with chest pain it suggests a proximal LAD occlusion, and with sudden breathlessness it suggests a large pulmonary embolism.'
        ], 'None for an isolated chronic RBBB.', 75);
      case 'lbbb':
        return entry('Left bundle branch block', [
          'No treatment for the block itself, but it always signals underlying heart disease.',
          '**LBBB alone - even new or presumed new - is no longer a reason to activate the cath lab.** Apply the modified Sgarbossa criteria: concordant ST elevation of 1 mm or more, concordant ST depression of 1 mm or more in V1-V3, or discordant ST elevation exceeding 25% of the preceding S wave. Any one, with ischaemic symptoms, is treated as a STEMI.',
          'A patient with LBBB who is unstable from a suspected infarct (shock, acute heart failure) should go for emergency angiography regardless.',
          'Compare with an old ECG whenever one exists.'
        ], 'Echocardiography; cardiac resynchronization therapy if the ejection fraction is low.', 55);
      case 'lafb':
      case 'lpfb':
        return entry(cfg.ivcd === 'lafb' ? 'Left anterior fascicular block' : 'Left posterior fascicular block', [
          'No treatment. An isolated fascicular block does not cause symptoms.',
          cfg.ivcd === 'lpfb'
            ? 'LPFB is a diagnosis of exclusion - rule out right ventricular strain (pulmonary embolism), lateral infarction and a vertical heart first.'
            : 'It matters mainly as a building block: combined with RBBB it is bifascicular block.'
        ], 'None needed.', 80);
      case 'bifascicular':
        return entry('Bifascicular block (RBBB + LAFB)', [
          'Two of the three fascicles are blocked; the ventricles depend on the one that is left.',
          'Asymptomatic: no treatment, but record it and avoid stacking AV-nodal blocking drugs.',
          '**Syncope or near-syncope with bifascicular block is intermittent complete heart block until proven otherwise.** Apply pacing pads, monitor continuously, and transport.',
          'A long PR interval added to this ("trifascicular block") means the last fascicle is also diseased.'
        ], 'Pacemaker for syncope, alternating bundle branch block, or documented high-grade AV block.', 35);
      case 'ivcd':
        return entry('Nonspecific intraventricular conduction delay', [
          'A wide QRS that is not a bundle branch block has a short list of dangerous causes. **Think hyperkalaemia first** (renal failure, missed dialysis, crush injury) and sodium-channel blocker poisoning second (tricyclics, diphenhydramine, cocaine, flecainide).',
          'If either fits: calcium for hyperkalaemia, sodium bicarbonate 1-2 mEq/kg IV for sodium-channel blockade - see the specific entries.',
          'Otherwise it reflects diseased ventricular muscle and needs no acute treatment.'
        ], 'Electrolytes, toxicology and echocardiography.', 40);
      case 'wpw':
        return entry('Wolff-Parkinson-White pattern', [
          'In sinus rhythm with no symptoms, the pattern needs no treatment. Record it clearly - it changes how every future tachycardia in this patient is managed.',
          '**Regular narrow tachycardia** (orthodromic AVRT, the commonest): treat like any SVT - vagal manoeuvres, then adenosine 6 mg and 12 mg. Have the defibrillator ready, since adenosine can occasionally trigger AF.',
          '**Fast, irregular, wide and bizarre (pre-excited atrial fibrillation): avoid every AV-nodal blocker** - adenosine, diltiazem, verapamil, beta blockers and digoxin. Blocking the node sends more impulses down the accessory pathway and can cause VF. Amiodarone IV is also best avoided.',
          'For pre-excited AF: unstable - synchronized cardioversion; stable - procainamide 20-50 mg/min IV (maximum 17 mg/kg), or cardiovert.'
        ], 'Electrophysiology study and catheter ablation of the accessory pathway, which is curative.', 30);
    }
    return null;
  }

  /* ------------------------------------------------------------ pacing */

  function pacingEntry(cfg) {
    switch (cfg.pacing) {
      case 'failure_capture':
        return entry('Pacemaker failure to capture', [
          '**Treat the patient\'s own rhythm, not the spikes.** If the underlying rhythm is perfusing, monitor and transport. If it is a symptomatic bradycardia, treat it as one.',
          'Transcutaneous pacing: place the pads anterior-posterior and at least 8 cm (3 inches) away from the pulse generator; expect to need a higher current than usual. Atropine 1 mg IV and epinephrine 2-10 mcg/min are the bridges.',
          'Reversible causes that raise the capture threshold: **hyperkalaemia**, acute infarction at the lead tip, acidosis, hypoxia, and drugs such as flecainide. Mechanical causes: lead displacement or fracture (recent implant, trauma, "twiddling"), and battery depletion.',
          'A magnet will not help - it only switches the device to fixed-rate pacing, and the pulses still will not capture.'
        ], 'Device interrogation, chest X-ray for lead position, electrolytes; lead revision or generator replacement.', 8);
      case 'failure_sense':
        return entry('Pacemaker failure to sense (undersensing)', [
          'The device cannot see the patient\'s own beats, so it fires regardless - and a spike landing on a T wave can trigger VT or VF. Keep the defibrillator pads on.',
          'If the patient is stable, monitor continuously and transport for interrogation.',
          'Look for causes: lead displacement or fracture, a new bundle branch block or infarct changing the signal the lead sees, electrolyte disturbance, and battery depletion.',
          'If R-on-T induces VT or VF, treat it by the standard algorithm; pads go anterior-posterior, away from the generator.'
        ], 'Device interrogation and reprogramming of sensitivity, or lead revision.', 18);
      case 'none':
      case undefined:
        return null;
      default:
        return entry('Paced rhythm, functioning normally', [
          'A normally functioning pacemaker needs no treatment. Confirm that every spike captures and that each captured beat produces a pulse.',
          '**A paced rhythm hides a STEMI the same way LBBB does.** With ischaemic symptoms, apply the modified Sgarbossa criteria and treat the story, not just the tracing.',
          'If defibrillation, cardioversion or external pacing is ever needed, keep the pads at least 8 cm (3 inches) from the generator - anterior-posterior is best.',
          'Record the device type and, if the patient has it, the device identification card.'
        ], 'Routine device follow-up.', 70);
    }
  }

  /* ---------------------------------------------------------- ischaemia */

  function ischemiaEntry(cfg) {
    var t = cfg.ischemia;
    if (!t || t === 'none') return null;

    if (t === 'wellens_a' || t === 'wellens_b') {
      return entry('Wellens syndrome - critical proximal LAD stenosis', [
        'Treat as a high-risk acute coronary syndrome even though the patient is pain free and the troponin may be normal: this pattern precedes a large anterior infarct, often within days.',
        ACS_BASE,
        'Continuous monitoring with the pads within reach, IV access, and a repeat 12-lead with any return of pain - the T waves "pseudo-normalize" and then the ST segments rise when the artery re-occludes. That is now a STEMI.',
        NITRO,
        'Transport to a PCI-capable hospital and name the pattern at handover. **No stress testing** - it can provoke the infarct.'
      ], 'Anticoagulation, dual antiplatelet therapy, and early coronary angiography with PCI (or bypass surgery) to the LAD.', 7);
    }

    if (t === 'de_winter') {
      return entry('de Winter pattern - treat as an anterior STEMI', [
        '**This is an acute proximal LAD occlusion without ST elevation. Activate the cath lab exactly as you would for a STEMI**, and say "STEMI equivalent - de Winter" when you call it in.',
        ACS_BASE,
        NITRO,
        OXYGEN,
        PAIN,
        'Pads on, repeat the 12-lead every 5-10 minutes (it may evolve into frank ST elevation), and keep scene time short. Expect VF and pump failure.'
      ], 'Immediate coronary angiography and primary PCI, with a P2Y12 inhibitor and heparin.', 3);
    }

    if (t === 'subendocardial') {
      return entry('Diffuse subendocardial ischaemia (ST elevation in aVR)', [
        'This is global supply-demand failure, not one blocked artery. **Find and fix the cause first:** a tachyarrhythmia, haemorrhage or severe anaemia, hypoxia, sepsis, severe hypertension, or aortic stenosis - correcting it may make the ECG normal again.',
        'If no such cause is found and the story is ischaemic, treat as left main or severe three-vessel disease: ' + ACS_BASE,
        'Nitroglycerin and opioids with great care - these patients are often preload dependent and hypotensive. Avoid them if the blood pressure is soft.',
        OXYGEN,
        'Persistent pain or instability despite treatment warrants urgent transport to a PCI and cardiac surgery centre with early notification.'
      ], 'Urgent angiography. Many centres hold the P2Y12 inhibitor until the anatomy is known, because these patients often need bypass surgery.', 6);
    }

    if (cfg.stage === 'old') {
      return entry('Old (established) myocardial infarction', [
        'Q waves without ST elevation mark scar from a previous infarct. They are not an emergency and need no acute treatment.',
        'Compare with a previous ECG if at all possible. Persistent ST elevation over old Q waves, months later, suggests a left ventricular aneurysm rather than a new infarct.',
        'This is a patient with proven coronary disease: take new chest pain, breathlessness or syncope seriously, and treat as an acute coronary syndrome if the story fits, whatever this tracing shows.',
        'Scarred ventricles generate ventricular arrhythmias and heart failure - ask about both.'
      ], 'Secondary prevention: antiplatelet therapy, a high-intensity statin, a beta blocker, an ACE inhibitor or ARB, and an ICD if the ejection fraction is 35% or less.', 60);
    }

    var rv = t === 'inferior_rv';
    var inferior = t === 'inferior' || rv || t === 'inferoposterior' || t === 'inferolateral';
    var posterior = t === 'posterior' || t === 'inferoposterior' || t === 'inferolateral';
    var anterior = t === 'anterior' || t === 'anteroseptal' || t === 'extensive_anterior' || t === 'septal' || t === 'anterolateral';

    var steps = [
      '**Time is muscle.** 12-lead within 10 minutes of first contact, transmit it, and activate the cath lab from the field. Targets: first medical contact to device 90 minutes or less (120 if a transfer is needed). Keep scene time short - many systems aim for 15 minutes or less.',
      ACS_BASE
    ];

    if (rv) {
      steps.push('**No nitroglycerin.** A right ventricular infarct makes the patient preload dependent; a venodilator can collapse the blood pressure. Be equally cautious with morphine.');
      steps.push('Hypotension with clear lungs: normal saline 250-500 mL boluses, reassessed after each, up to 1-2 L. If the pressure does not respond, a vasopressor or inotrope (norepinephrine, dobutamine) is next, not more fluid.');
    } else if (inferior) {
      steps.push('Acquire V4R **before** nitroglycerin. If V4R shows 1 mm or more of ST elevation, treat as a right ventricular infarct: no nitrates, and fluid for hypotension.');
      steps.push(NITRO);
    } else {
      steps.push(NITRO);
    }

    steps.push(OXYGEN);
    steps.push(PAIN);

    if (inferior) {
      steps.push('Expect bradycardia and AV block (the RCA feeds the SA and AV nodes). If symptomatic: atropine 1 mg IV every 3-5 minutes to 3 mg, then pacing. Have the pads on.');
    }
    if (posterior) {
      steps.push('Record posterior leads V7-V9: 0.5 mm of ST elevation there confirms it. ST depression in V1-V3 in a patient with ischaemic pain is a posterior STEMI until proven otherwise, and qualifies for reperfusion.');
    }
    if (anterior) {
      steps.push('Watch for pump failure: crackles, falling blood pressure, cool skin. For pulmonary oedema with adequate pressure, CPAP and nitroglycerin; for cardiogenic shock, small fluid challenges only if the lungs are clear, then norepinephrine 0.1-0.5 mcg/kg/min titrated to a systolic BP of 90 mmHg. Avoid beta blockers in the field.');
      steps.push('A new bundle branch block or Mobitz II block with an anterior infarct means a very large infarct - pace early, atropine will not help.');
    }
    if (cfg.stage === 'hyperacute') {
      steps.push('Hyperacute T waves are the earliest sign and may not yet meet millimetre criteria. Repeat the 12-lead every 5-10 minutes; treat and transport as a STEMI and call it in as an early occlusion.');
    }
    if (cfg.stage === 'evolving') {
      steps.push('Q waves and inverting T waves mean hours have passed, but reperfusion is still indicated up to 12 hours from symptom onset - and beyond that if pain, ST elevation or instability persists. Establish the time of onset carefully.');
    }
    if (cfg.ivcd === 'lbbb') {
      steps.push('The concordant ST elevation here is a positive Sgarbossa criterion: this is a STEMI seen through a bundle branch block, and gets the same activation.');
    }
    steps.push('Pads on and repeat the 12-lead with every change in symptoms. Ventricular fibrillation is commonest in the first hour: defibrillate immediately. Reperfusion arrhythmias such as AIVR need no treatment.');
    steps.push('If PCI cannot be reached within 120 minutes, fibrinolysis is the alternative (door- or contact-to-needle 30 minutes or less) - begin the contraindication checklist early.');

    return entry('ST-elevation myocardial infarction' + (rv ? ' with right ventricular involvement' : ''), steps,
      'Primary PCI. A P2Y12 inhibitor (ticagrelor 180 mg or prasugrel 60 mg; clopidogrel 600 mg as the alternative), anticoagulation with heparin or bivalirudin, then a high-intensity statin, a beta blocker and an ACE inhibitor once stable.', 3);
  }

  /* ------------------------------------------------- chambers / patterns */

  function chamberEntry(cfg) {
    switch (cfg.chambers) {
      case 'lvh':
      case 'lvh_strain':
        return entry('Left ventricular hypertrophy', [
          'No emergency treatment for the ECG finding. It reflects long-standing pressure load - hypertension or aortic stenosis.',
          cfg.chambers === 'lvh_strain'
            ? 'The strain pattern is a STEMI mimic: the ST elevation in V1-V3 is discordant and proportional to the deep S waves. But these patients have real coronary disease too - if the story is ischaemic, treat as an acute coronary syndrome and repeat the 12-lead to look for change.'
            : 'Voltage criteria alone are common in young, thin, healthy people; interpret them with the patient in front of you.',
          'Be cautious with nitrates and other vasodilators if severe aortic stenosis is possible (systolic murmur, exertional syncope) - the ventricle depends on its preload.',
          'Treat a hypertensive emergency only when there is acute organ damage, per protocol.'
        ], 'Blood pressure control and echocardiography.', 70);
      case 'rvh':
        return entry('Right ventricular hypertrophy', [
          'No treatment for the ECG finding. It reflects chronic pressure load on the right heart: COPD, pulmonary hypertension, chronic thromboembolic disease, mitral stenosis, or congenital heart disease.',
          'Treat the underlying problem. Give oxygen for hypoxaemia (target 88-92% in a chronic CO2 retainer).',
          'These patients tolerate hypotension, hypoxia and positive-pressure ventilation badly. Avoid large fluid boluses and intubate only if unavoidable.'
        ], 'Echocardiography and treatment of the lung or valve disease.', 70);
      case 'lae':
      case 'rae':
      case 'biatrial':
        return entry('Atrial enlargement', [
          'No treatment. A wide notched P wave points to mitral valve disease or hypertensive heart disease and predicts atrial fibrillation; a tall peaked P wave points to lung disease and pulmonary hypertension.',
          'Use it as a clue to the underlying condition.'
        ], 'Echocardiography.', 85);
    }
    return null;
  }

  function patternEntry(cfg) {
    switch (cfg.pattern) {
      case 'hyperk_mild':
      case 'hyperk_moderate':
      case 'hyperk_severe':
        var severe = cfg.pattern !== 'hyperk_mild';
        return entry('Hyperkalaemia', [
          severe
            ? '**Calcium first, now.** Calcium chloride 10% 0.5-1 g (5-10 mL) IV over 2-5 minutes through a large, reliable vein, OR calcium gluconate 10% 1.5-3 g (15-30 mL) IV over 2-5 minutes. Watch the monitor: the QRS should narrow within minutes. Repeat after 5 minutes if it does not. The effect lasts only 30-60 minutes and does not lower the potassium.'
            : 'Peaked T waves alone, with a normal QRS and P wave, do not yet need calcium - but they can progress within minutes. Continuous monitoring, IV access, and a low threshold to treat if the P waves flatten or the QRS widens.',
          '**Shift potassium into cells:** albuterol 10-20 mg nebulized (four to eight standard 2.5 mg doses, continuously); sodium bicarbonate 50 mEq IV over 5 minutes, most useful when the patient is acidotic. Regular insulin 10 units IV with dextrose 25 g (50 mL of D50) where it is within scope - check glucose hourly afterwards.',
          'Never mix calcium and bicarbonate in the same line - they precipitate. Flush between them.',
          cfg.pattern === 'hyperk_severe'
            ? 'A sine wave is minutes from arrest. If the patient arrests: standard CPR and defibrillation, plus calcium chloride 1 g and sodium bicarbonate 50 mEq IV push, and tell the hospital to prepare for dialysis.'
            : 'Avoid succinylcholine if intubation is needed, and stop any potassium-containing fluid.',
          'Ask the three questions: dialysis (when was the last session?), crush injury or prolonged immobility, and drugs (ACE inhibitors, ARBs, spironolactone, potassium supplements, trimethoprim).'
        ], 'Insulin and dextrose, a loop diuretic if the kidneys work, a potassium binder, and emergency haemodialysis for severe or refractory cases.', severe ? 2 : 15);

      case 'hypok':
        return entry('Hypokalaemia', [
          'Monitor continuously - a low potassium lengthens repolarization and sets up torsades de pointes and VF, especially in a patient on digoxin or with an acute coronary syndrome.',
          'Prehospital treatment is supportive. Avoid making it worse: large doses of albuterol, insulin, and bicarbonate all drive potassium lower.',
          'If torsades occurs: magnesium sulfate 2 g IV, and defibrillate if it sustains.',
          'Causes to report: diuretics, vomiting and diarrhoea, DKA under treatment, alcohol use, eating disorders.'
        ], 'Potassium chloride 10-20 mEq/hour IV with cardiac monitoring (or oral replacement if mild), and magnesium replaced first or alongside - potassium will not correct while magnesium is low.', 30);

      case 'hypocalcemia':
        return entry('Hypocalcaemia (long QT)', [
          'Monitor for torsades de pointes and for the clinical signs: tingling round the mouth and in the fingers, muscle cramps, carpopedal spasm, laryngospasm, seizures.',
          'Symptomatic hypocalcaemia (tetany, seizures, arrhythmia): calcium gluconate 10% 1-2 g (10-20 mL) IV over 10-20 minutes, or calcium chloride 10% 0.5-1 g by slow IV push through a large vein, per protocol.',
          'Avoid QT-prolonging drugs (ondansetron, haloperidol, droperidol).',
          'Typical settings: renal failure, recent thyroid or parathyroid surgery, pancreatitis, massive transfusion (citrate), hydrofluoric acid exposure.'
        ], 'Calcium infusion, magnesium correction, and treatment of the cause.', 30);

      case 'hypercalcemia':
        return entry('Hypercalcaemia (short QT)', [
          'The treatment is volume: these patients are profoundly dehydrated. Normal saline 500-1000 mL IV bolus, then continue per protocol, watching for fluid overload.',
          'Symptoms are "stones, bones, groans and psychiatric overtones" - confusion, vomiting, abdominal pain, weakness, polyuria.',
          'The commonest causes are malignancy and hyperparathyroidism. Avoid thiazide diuretics and digoxin.'
        ], 'Aggressive saline hydration, calcitonin, an IV bisphosphonate (zoledronic acid), and dialysis if severe.', 40);

      case 'digoxin':
        return entry('Digoxin effect', [
          'The scooped ST segments show that the patient takes digoxin, not that they are poisoned. No treatment is needed for the pattern.',
          '**Suspect toxicity** if there is nausea and vomiting, confusion, yellow-green visual halos, or a new arrhythmia - frequent PVCs, bigeminy, atrial tachycardia with block, a slow regular rhythm in a patient with AF, or bidirectional VT.',
          'In suspected toxicity: avoid cardioversion unless the patient is dying (use the lowest energy if you must), treat bradycardia with atropine 1 mg, and report it early so the antidote can be prepared.',
          'Hyperkalaemia in acute digoxin poisoning reflects the severity of the poisoning and is treated with the antidote.'
        ], 'Digoxin-specific antibody fragments (DigiFab): about 10 vials empirically for a life-threatening acute overdose, 3-6 vials for chronic toxicity. Potassium and magnesium corrected.', 45);

      case 'tca':
        return entry('Tricyclic / sodium-channel blocker toxicity', [
          '**Sodium bicarbonate 1-2 mEq/kg IV push** (roughly 50-100 mEq, one to two ampoules of 8.4%) for a QRS over 100 ms, ventricular arrhythmia, or hypotension. Repeat every few minutes until the QRS narrows. Watch the complex shrink on the monitor.',
          'Airway early: these patients lose consciousness and seize quickly. If intubated, ventilate to avoid acidosis, which worsens the toxicity.',
          'Seizures: a benzodiazepine (midazolam 5-10 mg IM or 2.5-5 mg IV). Do not use phenytoin.',
          'Hypotension: normal saline 10-20 mL/kg, then bicarbonate, then norepinephrine.',
          '**Avoid** class IA and IC antiarrhythmics (procainamide, flecainide), amiodarone, beta blockers, physostigmine and flumazenil. For ventricular arrhythmia that persists after bicarbonate, lidocaine 1-1.5 mg/kg is the drug.',
          'The same picture and the same treatment apply to diphenhydramine, cocaine, flecainide and some antimalarial overdoses.'
        ], 'Bicarbonate infusion to a serum pH of 7.50-7.55, intensive care monitoring, and IV lipid emulsion or ECMO for refractory cardiovascular collapse.', 3);

      case 'hypothermia':
        return entry('Hypothermia', [
          '**Handle gently and keep the patient horizontal.** A cold heart is irritable, and rough movement can precipitate VF.',
          'Stop further heat loss: remove wet clothing, insulate, warm the vehicle, and apply heat packs to the trunk. Warmed IV fluid (38-42 C) in 250-500 mL boluses.',
          'The bradycardia is physiological at this temperature. Do not treat it with atropine or pacing - it resolves as the patient warms.',
          'Check breathing and pulse for longer than usual (up to 30-60 seconds) before starting CPR; an organized rhythm with any sign of life should not be compressed.',
          'In cardiac arrest: CPR and defibrillation as normal. Many protocols limit shocks and withhold drugs until the core temperature is above 30 C (86 F), then give drugs at longer intervals until 35 C.',
          'Do not stop resuscitation because of cold: "not dead until warm and dead". Transport an arrested hypothermic patient to an ECMO-capable centre where one is in reach.'
        ], 'Active core rewarming; extracorporeal rewarming (ECMO or bypass) for arrest or instability.', 10);

      case 'pericarditis':
        return entry('Acute pericarditis', [
          'This is not a cath-lab activation - but be sure. Reciprocal ST depression (other than in aVR and V1), ST elevation in III greater than in II, or convex ST segments mean STEMI until proven otherwise. When in doubt, treat as an acute coronary syndrome and transmit the ECG.',
          'Comfort: let the patient sit forward. Analgesia per protocol - ketorolac 15 mg IV or ibuprofen where available; fentanyl 25-50 mcg IV for severe pain.',
          'Avoid fibrinolytics and anticoagulants if pericarditis is the working diagnosis - they risk bleeding into the pericardium.',
          'Watch for tamponade: falling blood pressure, distended neck veins, muffled heart sounds, pulsus paradoxus, and a tracing that loses voltage.'
        ], 'An NSAID (ibuprofen 600-800 mg three times daily or aspirin 650-1000 mg three times daily) with colchicine 0.5-0.6 mg once or twice daily for 3 months; echocardiography to look for an effusion.', 40);

      case 'early_repol':
        return entry('Benign early repolarization', [
          'A normal variant. No treatment.',
          'It is a diagnosis you make only when the story is not ischaemic. With chest pain, repeat the 12-lead every 5-10 minutes: early repolarization does not change, and an evolving STEMI does.',
          'Features against benign: ST elevation over 5 mm, reciprocal depression, a T wave tall relative to the R wave, new Q waves, or loss of R-wave height in V2-V4.'
        ], 'None; comparison with old ECGs.', 80);

      case 'alternans':
        return entry('Electrical alternans - suspect cardiac tamponade', [
          'Alternans with tachycardia and hypotension is tamponade until proven otherwise. Look for Beck\'s triad: hypotension, distended neck veins, muffled heart sounds.',
          '**Support preload:** normal saline 250-500 mL boluses, repeated, to keep the right heart filling against the pressure around it.',
          'Avoid everything that lowers preload: nitroglycerin, morphine, diuretics. Avoid positive-pressure ventilation and intubation if at all possible - they can cause arrest.',
          'If the patient arrests (usually PEA), CPR is relatively ineffective; the fix is drainage. Rapid transport with pre-alert. Traumatic tamponade goes to a trauma centre for thoracotomy.'
        ], 'Urgent echocardiography and pericardiocentesis or a surgical pericardial window.', 4);

      case 'low_voltage':
        return entry('Low voltage', [
          'A finding to explain, not to treat. Check the gain setting and electrode contact first.',
          'Then think of what lies between the heart and the electrodes or what has replaced the muscle: pericardial effusion (look for tachycardia and alternans), obesity, COPD with hyperinflation, pleural effusion, severe hypothyroidism, infiltrative cardiomyopathy such as amyloid, and extensive old infarction.',
          'Low voltage with hypotension and distended neck veins is tamponade - fluid bolus and rapid transport.'
        ], 'Echocardiography.', 60);

      case 'brugada':
        return entry('Brugada pattern', [
          'A sodium channel disorder that causes VF and sudden death, typically at rest or in sleep. Keep the patient monitored with the pads within reach.',
          '**Treat a fever aggressively** - acetaminophen 1 g and cooling. Fever unmasks the pattern and triggers the arrhythmia.',
          '**Avoid sodium-channel blockers:** procainamide, flecainide, propafenone, tricyclic antidepressants, lithium, and cocaine. Use propofol and bupivacaine with caution.',
          'VF or polymorphic VT: defibrillate by the standard algorithm.',
          'A patient with this pattern and syncope, a seizure-like episode, or nocturnal gasping needs admission, however well they look.'
        ], 'For electrical storm, isoproterenol infusion and quinidine. An ICD for survivors of arrest or arrhythmic syncope; family screening.', 15);

      case 'pe':
        return entry('Acute pulmonary embolism (right heart strain)', [
          'Oxygen to keep SpO2 at 90% or above. Sit the patient up if the blood pressure allows.',
          'Hypotension: a cautious fluid bolus of 250-500 mL only - a strained right ventricle fails further if overfilled. If still hypotensive, norepinephrine 0.1-0.5 mcg/kg/min.',
          'Avoid intubation and positive-pressure ventilation unless unavoidable; they can precipitate arrest in a failing right ventricle.',
          'Sudden PEA arrest in a patient with risk factors (recent surgery, immobility, cancer, pregnancy, a swollen leg) is PE until proven otherwise - high-quality CPR and early notification, since thrombolysis during CPR is an option.',
          'A normal ECG does not rule PE out; the commonest finding is sinus tachycardia alone.'
        ], 'Anticoagulation (heparin 80 units/kg IV bolus, or a low-molecular-weight heparin or direct oral anticoagulant). For shock or arrest: systemic thrombolysis - alteplase 100 mg over 2 hours, or a 50 mg bolus in cardiac arrest - or catheter or surgical embolectomy.', 5);

      case 'lqts':
        return entry('Long QT', [
          'Monitor continuously with the pads within reach - the risk is torsades de pointes.',
          '**Do not give QT-prolonging drugs:** ondansetron, haloperidol, droperidol, amiodarone, procainamide, sotalol, macrolide and fluoroquinolone antibiotics, methadone.',
          'If torsades occurs: magnesium sulfate 2 g IV, and defibrillate (unsynchronized) if sustained or pulseless.',
          'Ask about syncope, a family history of sudden death, current medications, and vomiting or diarrhoea (low potassium and magnesium).'
        ], 'Potassium and magnesium correction, withdrawal of the culprit drug; for congenital long QT, a beta blocker (nadolol or propranolol) and an ICD in high-risk patients.', 25);
    }
    return null;
  }

  function artifactEntry(cfg) {
    switch (cfg.artifact) {
      case 'la_ra_reversal':
        return entry('Limb lead reversal', [
          'Treat nothing. Check the electrodes against their labels, correct them, and record the 12-lead again.',
          'Keep both tracings and label the first one as a lead reversal.'
        ], '', 9);
      case 'dextrocardia':
        return entry('Dextrocardia', [
          'No treatment - it is an anatomical variant. Confirm by examination: the apex beat and heart sounds are on the right.',
          'To get an interpretable 12-lead, reverse the arm electrodes and place the chest leads in mirror image across the right chest (V1 at the left sternal edge, V2 at the right, V3R-V6R). Label the tracing clearly.',
          'Defibrillation pads and manual compressions should also be sited for a right-sided heart.'
        ], '', 60);
      case 'tremor':
      case 'ac60':
      case 'wander':
      case 'loose_lead':
        return entry('Artifact - fix the tracing before treating it', [
          'Never make a treatment decision from a tracing you cannot read. Look at the patient: a person who is talking to you is not in VF, whatever the monitor shows.',
          'Skin preparation is most of the fix: dry the skin, shave if needed, abrade lightly, and use fresh electrodes. Put limb electrodes on the limbs, not the torso.',
          cfg.artifact === 'tremor' ? 'Muscle tremor: warm and reassure the patient, support the arms, ask them to rest their hands under their buttocks, and treat shivering or pain.'
            : cfg.artifact === 'ac60' ? '60-cycle interference: move the cables away from power cords and electrical equipment, unplug what you can, and check for a dry or loose electrode.'
            : cfg.artifact === 'wander' ? 'Baseline wander: have the patient lie still and breathe quietly, keep the cables from being tugged, and replace poorly adherent electrodes.'
            : 'Loose electrode: find the lead that is misbehaving, replace that electrode, and check the cable connection.',
          'Then repeat the 12-lead.'
        ], '', 9);
    }
    return null;
  }

  /* ------------------------------------------------------------- build */

  function build(result) {
    var cfg = result.config, m = result.measurements;
    var out = [];
    var paced = cfg.pacing && cfg.pacing !== 'none';
    var pureRhythm = cfg.rhythm === 'vfib' || cfg.rhythm === 'asystole';

    function push(e) { if (e) out.push(e); }

    // The rhythm entry is skipped when a pacemaker is setting the rhythm.
    if (!paced || pureRhythm) {
      var blocked = cfg.avblock && cfg.avblock !== 'none' && cfg.avblock !== 'first';
      var plainSinus = ['sinus', 'sinus_brady', 'sinus_tach', 'sinus_arrhythmia'].indexOf(cfg.rhythm) !== -1;
      // A sinus rhythm with a significant AV block is managed as the block.
      // ...and the slow sinus rhythm of hypothermia is managed by rewarming,
      // not by the bradycardia algorithm.
      var coldBrady = cfg.pattern === 'hypothermia' && cfg.rhythm === 'sinus_brady';
      if (!(blocked && plainSinus) && !coldBrady) push(rhythmEntry(cfg, m));
    }
    if (!pureRhythm) {
      push(blockEntry(cfg));
      push(ectopyEntry(cfg));
      push(pacingEntry(cfg));
      push(ischemiaEntry(cfg));
      push(patternEntry(cfg));
      push(conductionEntry(cfg));
      push(chamberEntry(cfg));
    }
    // Shivering on a hypothermic patient is a finding, not a faulty tracing.
    if (!(cfg.pattern === 'hypothermia' && cfg.artifact === 'tremor')) push(artifactEntry(cfg));

    // A dull "normal sinus rhythm" entry adds nothing next to a real finding.
    if (out.length > 1) {
      out = out.filter(function (e) { return e.priority < 95; });
    }
    out.sort(function (a, b) { return a.priority - b.priority; });
    return out;
  }

  EKG.treatment = {
    build: build,
    BASIS: 'Adult doses, based on American Heart Association ACLS (2020 guidelines with the 2025 update) and the 2025 ACC/AHA acute coronary syndromes guideline.'
  };
})(window.EKG);
