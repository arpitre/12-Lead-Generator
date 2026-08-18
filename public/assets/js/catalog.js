/* catalog.js — the dropdowns and the preset case library.
 *
 * CONTROLS drives the whole UI: the panel is built from it, the URL encoder
 * walks it, and "Random case" picks from it. Adding a new teaching finding
 * means adding one option here plus its physiology in morphology.js.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var DEFAULTS = {
    rhythm: 'sinus',
    rate: 75,
    ectopy: 'none',
    avblock: 'none',
    blockRatio: 3,
    prInterval: 160,
    atrialRate: 82,
    escapeSite: 'junctional',
    escapeRate: 42,
    flutterConduction: 2,
    retrogradeP: 'before',
    vtOrigin: 'rv',
    avDissociation: false,
    axis: 'normal',
    ivcd: 'none',
    wpwType: 'a',
    pacing: 'none',
    pacerRate: 70,
    ischemia: 'none',
    severity: 'moderate',
    stage: 'acute',
    qWaves: false,
    chambers: 'none',
    pattern: 'none',
    extraLeads: 'none',
    artifact: 'none',
    looseLead: 'III',
    noise: 0.012,
    seed: 20250817
  };

  var CONTROLS = [
    {
      group: 'Rate & rhythm',
      fields: [
        {
          id: 'rhythm', label: 'Underlying rhythm', hint: 'The basic mechanism driving the heart.',
          options: [
            { g: 'Sinus', o: [
              ['sinus', 'Normal sinus rhythm'],
              ['sinus_brady', 'Sinus bradycardia'],
              ['sinus_tach', 'Sinus tachycardia'],
              ['sinus_arrhythmia', 'Sinus arrhythmia']
            ]},
            { g: 'Atrial', o: [
              ['afib', 'Atrial fibrillation'],
              ['aflutter', 'Atrial flutter'],
              ['atach', 'Atrial tachycardia'],
              ['svt', 'SVT (narrow, regular)'],
              ['mat', 'Multifocal atrial tachycardia'],
              ['wandering', 'Wandering atrial pacemaker']
            ]},
            { g: 'Junctional', o: [
              ['junctional', 'Junctional escape rhythm'],
              ['accel_junctional', 'Accelerated junctional'],
              ['junctional_tach', 'Junctional tachycardia']
            ]},
            { g: 'Ventricular', o: [
              ['idioventricular', 'Idioventricular rhythm'],
              ['aivr', 'Accelerated idioventricular (AIVR)'],
              ['vtach', 'Monomorphic ventricular tachycardia'],
              ['polymorphic_vt', 'Polymorphic VT / torsades'],
              ['vfib', 'Ventricular fibrillation'],
              ['asystole', 'Asystole']
            ]}
          ]
        },
        { id: 'rate', label: 'Rate (bpm)', type: 'number', min: 20, max: 300, step: 1,
          hint: 'Atrial rate for supraventricular rhythms; ventricular rate otherwise.' },
        { id: 'avDissociation', label: 'AV dissociation (P waves marching through)', type: 'checkbox',
          showIf: { rhythm: ['vtach', 'polymorphic_vt'] },
          hint: 'Independent sinus P waves are the strongest evidence a wide tachycardia is ventricular.' },
        { id: 'vtOrigin', label: 'VT focus', showIf: { rhythm: ['vtach'] },
          options: [['rv', 'Right ventricle (LBBB-like)'], ['lv', 'Left ventricle (RBBB-like)'], ['rvot', 'Outflow tract (inferior axis)']] },
        { id: 'flutterConduction', label: 'Flutter conduction', type: 'number-select',
          showIf: { rhythm: ['aflutter'] },
          options: [['2', '2:1 (ventricular rate ~150)'], ['3', '3:1 (~100)'], ['4', '4:1 (~75)'], ['0', 'Variable block']] },
        { id: 'retrogradeP', label: 'Retrograde P waves', showIf: { rhythm: ['junctional', 'accel_junctional', 'junctional_tach'] },
          options: [['before', 'Just before the QRS'], ['after', 'Just after the QRS'], ['none', 'Hidden in the QRS']] },
        {
          id: 'ectopy', label: 'Ectopy', hint: 'Extra beats layered onto the underlying rhythm.',
          options: [
            ['none', 'None'],
            ['pac', 'Premature atrial complex (PAC)'],
            ['pjc', 'Premature junctional complex (PJC)'],
            ['pvc_uni', 'PVCs, unifocal'],
            ['pvc_multi', 'PVCs, multifocal'],
            ['bigeminy', 'Ventricular bigeminy'],
            ['trigeminy', 'Ventricular trigeminy'],
            ['couplet', 'PVC couplet'],
            ['nsvt', 'Non-sustained VT (short run)']
          ]
        }
      ]
    },
    {
      group: 'AV conduction',
      fields: [
        {
          id: 'avblock', label: 'AV block',
          options: [
            ['none', 'None (1:1 conduction)'],
            ['first', 'First degree'],
            ['mobitz1', 'Second degree Type I (Wenckebach)'],
            ['mobitz2', 'Second degree Type II'],
            ['twotoone', '2:1 AV block'],
            ['third', 'Third degree (complete)']
          ]
        },
        { id: 'prInterval', label: 'PR interval (ms)', type: 'number', min: 80, max: 400, step: 10,
          showIf: { avblock: ['none', 'first'] } },
        { id: 'blockRatio', label: 'Conduction ratio', type: 'number', min: 2, max: 6, step: 1,
          showIf: { avblock: ['mobitz1', 'mobitz2'] },
          hint: 'e.g. 3 gives 3:2 conduction — two beats conduct, the third P is dropped.' },
        { id: 'atrialRate', label: 'Atrial (P wave) rate', type: 'number', min: 40, max: 160, step: 1,
          showIf: { avblock: ['third'] } },
        { id: 'escapeSite', label: 'Escape pacemaker', showIf: { avblock: ['third'] },
          options: [['junctional', 'Junctional (narrow, 40-60)'], ['ventricular', 'Ventricular (wide, 20-40)']] },
        { id: 'escapeRate', label: 'Escape rate', type: 'number', min: 15, max: 65, step: 1,
          showIf: { avblock: ['third'] } }
      ]
    },
    {
      group: 'Axis & intraventricular conduction',
      fields: [
        {
          id: 'axis', label: 'QRS axis',
          options: [
            ['normal', 'Normal (-30 to +90)'],
            ['lad', 'Left axis deviation'],
            ['rad', 'Right axis deviation'],
            ['extreme', 'Extreme / indeterminate ("northwest")']
          ]
        },
        {
          id: 'ivcd', label: 'Bundle branch / fascicle',
          options: [
            ['none', 'Normal conduction'],
            ['rbbb', 'Right bundle branch block'],
            ['lbbb', 'Left bundle branch block'],
            ['lafb', 'Left anterior fascicular block'],
            ['lpfb', 'Left posterior fascicular block'],
            ['bifascicular', 'Bifascicular (RBBB + LAFB)'],
            ['ivcd', 'Nonspecific intraventricular conduction delay'],
            ['wpw', 'Wolff-Parkinson-White pre-excitation']
          ]
        },
        { id: 'wpwType', label: 'Accessory pathway', showIf: { ivcd: ['wpw'] },
          options: [['a', 'Type A — left sided (upright delta in V1)'], ['b', 'Type B — right sided (negative delta in V1)']] }
      ]
    },
    {
      group: 'Pacing',
      fields: [
        {
          id: 'pacing', label: 'Pacemaker',
          options: [
            ['none', 'None'],
            ['atrial', 'Atrial paced (AAI)'],
            ['ventricular', 'Ventricular paced (VVI)'],
            ['av_sequential', 'AV sequential (DDD)'],
            ['biventricular', 'Biventricular (CRT)'],
            ['demand', 'Demand pacing (intermittent capture of a slow rhythm)'],
            ['failure_capture', 'Failure to capture'],
            ['failure_sense', 'Failure to sense (undersensing)']
          ]
        },
        { id: 'pacerRate', label: 'Set rate', type: 'number', min: 30, max: 120, step: 1,
          showIfNot: { pacing: ['none'] } }
      ]
    },
    {
      group: 'Ischemia & infarct',
      fields: [
        {
          id: 'ischemia', label: 'Territory / pattern',
          options: [
            ['none', 'None'],
            { g: 'ST elevation MI', o: [
              ['septal', 'Septal (V1-V2)'],
              ['anterior', 'Anterior (V3-V4)'],
              ['anteroseptal', 'Anteroseptal (V1-V4)'],
              ['extensive_anterior', 'Extensive anterior (V1-V6, I, aVL)'],
              ['anterolateral', 'Anterolateral'],
              ['lateral', 'Lateral (I, aVL, V5-V6)'],
              ['high_lateral', 'High lateral (I, aVL)'],
              ['inferior', 'Inferior (II, III, aVF)'],
              ['inferior_rv', 'Inferior + right ventricular'],
              ['inferolateral', 'Inferolateral'],
              ['inferoposterior', 'Inferoposterior'],
              ['posterior', 'Posterior (isolated)']
            ]},
            { g: 'Occlusion equivalents & ischemia', o: [
              ['de_winter', 'de Winter T waves'],
              ['wellens_a', 'Wellens Type A (biphasic T)'],
              ['wellens_b', 'Wellens Type B (deep symmetric T inversion)'],
              ['subendocardial', 'Diffuse subendocardial ischemia (aVR elevation)']
            ]}
          ]
        },
        { id: 'severity', label: 'Degree of ST change', showIfNot: { ischemia: ['none', 'wellens_a', 'wellens_b', 'de_winter'] },
          options: [['subtle', 'Subtle (~1 mm)'], ['moderate', 'Moderate (2-3 mm)'], ['marked', 'Marked (4-6 mm)'], ['tombstone', 'Tombstoning']] },
        { id: 'stage', label: 'Stage of infarct', showIfNot: { ischemia: ['none', 'wellens_a', 'wellens_b', 'de_winter', 'subendocardial'] },
          options: [
            ['hyperacute', 'Hyperacute (tall fat T waves, minutes)'],
            ['acute', 'Acute (ST elevation)'],
            ['evolving', 'Evolving (Q waves + T inversion)'],
            ['old', 'Old / established (Q waves only)']
          ] },
        { id: 'qWaves', label: 'Include pathologic Q waves', type: 'checkbox',
          showIf: { stage: ['acute'] } }
      ]
    },
    {
      group: 'Chambers, metabolic & toxicologic',
      fields: [
        {
          id: 'chambers', label: 'Chamber enlargement',
          options: [
            ['none', 'None'],
            ['lvh', 'Left ventricular hypertrophy'],
            ['lvh_strain', 'LVH with strain pattern'],
            ['rvh', 'Right ventricular hypertrophy'],
            ['lae', 'Left atrial enlargement'],
            ['rae', 'Right atrial enlargement'],
            ['biatrial', 'Biatrial enlargement']
          ]
        },
        {
          id: 'pattern', label: 'Other pattern',
          options: [
            ['none', 'None'],
            { g: 'Electrolytes', o: [
              ['hyperk_mild', 'Hyperkalemia — mild (peaked T waves)'],
              ['hyperk_moderate', 'Hyperkalemia — moderate (flat P, wide QRS)'],
              ['hyperk_severe', 'Hyperkalemia — severe (sine wave)'],
              ['hypok', 'Hypokalemia (U waves)'],
              ['hypocalcemia', 'Hypocalcemia (long QT)'],
              ['hypercalcemia', 'Hypercalcemia (short QT)']
            ]},
            { g: 'Pericardium & repolarization', o: [
              ['pericarditis', 'Acute pericarditis'],
              ['early_repol', 'Benign early repolarization'],
              ['alternans', 'Electrical alternans (effusion/tamponade)'],
              ['low_voltage', 'Low voltage'],
              ['brugada', 'Brugada Type 1'],
              ['lqts', 'Long QT syndrome']
            ]},
            { g: 'Toxicologic & environmental', o: [
              ['digoxin', 'Digoxin effect'],
              ['tca', 'Tricyclic overdose (wide QRS, terminal R in aVR)'],
              ['hypothermia', 'Hypothermia (Osborn / J waves)']
            ]},
            { g: 'Other', o: [
              ['pe', 'Pulmonary embolism (S1Q3T3, right strain)']
            ]}
          ]
        }
      ]
    },
    {
      group: 'Acquisition & display',
      fields: [
        {
          id: 'extraLeads', label: 'Additional leads',
          options: [
            ['none', 'Standard 12-lead'],
            ['right', 'Right sided — V4R, V5R, V6R (15-lead)'],
            ['posterior', 'Posterior — V7, V8, V9 (15-lead)']
          ],
          hint: 'Replaces the V4-V6 column so students can see what the extra leads add.'
        },
        {
          id: 'artifact', label: 'Artifact / acquisition error',
          options: [
            ['none', 'Clean tracing'],
            ['wander', 'Baseline wander'],
            ['tremor', 'Muscle tremor / shivering'],
            ['ac60', '60 Hz electrical interference'],
            ['loose_lead', 'Loose or disconnected electrode'],
            ['la_ra_reversal', 'Arm lead reversal (LA/RA swapped)'],
            ['dextrocardia', 'Dextrocardia']
          ]
        },
        { id: 'looseLead', label: 'Affected lead', showIf: { artifact: ['loose_lead'] },
          options: [['I', 'Lead I'], ['II', 'Lead II'], ['III', 'Lead III'], ['V1', 'V1'], ['V4', 'V4'], ['V6', 'V6']] }
      ]
    }
  ];

  /* ------------------------------------------------------------ presets */

  function P(label, category, cfg, teaching) {
    return { label: label, category: category, cfg: cfg, teaching: teaching || '' };
  }

  var PRESETS = [
    // --- baseline
    P('Normal sinus rhythm', 'Baseline', { rhythm: 'sinus', rate: 72 },
      'The reference tracing. Have students walk the whole system on this one first so they know what normal looks like before hunting for pathology.'),
    P('Normal, athletic bradycardia', 'Baseline', { rhythm: 'sinus_brady', rate: 46, pattern: 'early_repol' }),

    // --- rate & rhythm
    P('Sinus bradycardia', 'Rate & rhythm', { rhythm: 'sinus_brady', rate: 44 }),
    P('Sinus tachycardia', 'Rate & rhythm', { rhythm: 'sinus_tach', rate: 128 }),
    P('Sinus arrhythmia', 'Rate & rhythm', { rhythm: 'sinus_arrhythmia', rate: 70 }),
    P('Atrial fibrillation, controlled', 'Rate & rhythm', { rhythm: 'afib', rate: 78 }),
    P('Atrial fibrillation with RVR', 'Rate & rhythm', { rhythm: 'afib', rate: 156 }),
    P('Atrial flutter, 2:1 conduction', 'Rate & rhythm', { rhythm: 'aflutter', flutterConduction: 2 },
      'The trap: a regular narrow tachycardia at almost exactly 150. Always look for buried flutter waves before calling it SVT.'),
    P('Atrial flutter, variable block', 'Rate & rhythm', { rhythm: 'aflutter', flutterConduction: 0 }),
    P('SVT', 'Rate & rhythm', { rhythm: 'svt', rate: 186 }),
    P('Multifocal atrial tachycardia', 'Rate & rhythm', { rhythm: 'mat', rate: 118 }),
    P('Junctional escape rhythm', 'Rate & rhythm', { rhythm: 'junctional', rate: 44 }),
    P('Accelerated junctional rhythm', 'Rate & rhythm', { rhythm: 'accel_junctional', rate: 78 }),

    // --- ectopy
    P('Unifocal PVCs', 'Ectopy', { rhythm: 'sinus', rate: 78, ectopy: 'pvc_uni' }),
    P('Multifocal PVCs', 'Ectopy', { rhythm: 'sinus', rate: 82, ectopy: 'pvc_multi' }),
    P('Ventricular bigeminy', 'Ectopy', { rhythm: 'sinus', rate: 72, ectopy: 'bigeminy' }),
    P('Ventricular trigeminy', 'Ectopy', { rhythm: 'sinus', rate: 74, ectopy: 'trigeminy' }),
    P('PVC couplet', 'Ectopy', { rhythm: 'sinus', rate: 76, ectopy: 'couplet' }),
    P('Non-sustained VT', 'Ectopy', { rhythm: 'sinus', rate: 80, ectopy: 'nsvt' }),
    P('Premature atrial complex', 'Ectopy', { rhythm: 'sinus', rate: 74, ectopy: 'pac' }),

    // --- blocks
    P('First degree AV block', 'AV block', { rhythm: 'sinus', rate: 66, avblock: 'first', prInterval: 280 }),
    P('Wenckebach (Mobitz I)', 'AV block', { rhythm: 'sinus', rate: 78, avblock: 'mobitz1', blockRatio: 3 },
      'Watch the PR interval stretch beat by beat until one P wave fails to conduct. The R-R actually shortens on the way in.'),
    P('Mobitz II', 'AV block', { rhythm: 'sinus', rate: 82, avblock: 'mobitz2', blockRatio: 3, ivcd: 'rbbb' },
      'Fixed PR, then a P wave drops out of nowhere. This one goes to the pacing pads, not to atropine and hope.'),
    P('2:1 AV block', 'AV block', { rhythm: 'sinus', rate: 84, avblock: 'twotoone' }),
    P('Complete heart block, junctional escape', 'AV block', { rhythm: 'sinus', rate: 84, avblock: 'third', atrialRate: 84, escapeSite: 'junctional', escapeRate: 46 }),
    P('Complete heart block, ventricular escape', 'AV block', { rhythm: 'sinus', rate: 88, avblock: 'third', atrialRate: 88, escapeSite: 'ventricular', escapeRate: 30 }),

    // --- wide complex
    P('Monomorphic VT', 'Wide complex', { rhythm: 'vtach', rate: 172 }),
    P('VT with AV dissociation', 'Wide complex', { rhythm: 'vtach', rate: 164, avDissociation: true, atrialRate: 88 },
      'The independent P waves are the proof. Find them and the VT-vs-SVT-with-aberrancy argument is over.'),
    P('Torsades de pointes', 'Wide complex', { rhythm: 'polymorphic_vt', rate: 230 }),
    P('Idioventricular rhythm', 'Wide complex', { rhythm: 'idioventricular', rate: 30 }),
    P('AIVR (reperfusion rhythm)', 'Wide complex', { rhythm: 'aivr', rate: 72 }),
    P('Coarse ventricular fibrillation', 'Wide complex', { rhythm: 'vfib' }),
    P('Asystole', 'Wide complex', { rhythm: 'asystole' }),

    // --- conduction
    P('Right bundle branch block', 'Conduction', { rhythm: 'sinus', rate: 74, ivcd: 'rbbb' }),
    P('Left bundle branch block', 'Conduction', { rhythm: 'sinus', rate: 76, ivcd: 'lbbb' }),
    P('Left anterior fascicular block', 'Conduction', { rhythm: 'sinus', rate: 72, ivcd: 'lafb', axis: 'lad' }),
    P('Bifascicular block (RBBB + LAFB)', 'Conduction', { rhythm: 'sinus', rate: 70, ivcd: 'bifascicular', axis: 'lad' }),
    P('WPW, Type A', 'Conduction', { rhythm: 'sinus', rate: 74, ivcd: 'wpw', wpwType: 'a' }),
    P('WPW, Type B', 'Conduction', { rhythm: 'sinus', rate: 76, ivcd: 'wpw', wpwType: 'b' }),

    // --- pacing
    P('Ventricular paced (VVI)', 'Pacing', { rhythm: 'sinus', rate: 40, pacing: 'ventricular', pacerRate: 70 }),
    P('AV sequential paced (DDD)', 'Pacing', { rhythm: 'sinus', rate: 40, pacing: 'av_sequential', pacerRate: 70 }),
    P('Atrial paced (AAI)', 'Pacing', { rhythm: 'sinus', rate: 40, pacing: 'atrial', pacerRate: 70 }),
    P('Biventricular paced (CRT)', 'Pacing', { rhythm: 'sinus', rate: 40, pacing: 'biventricular', pacerRate: 72 }),
    P('Demand pacing over a slow rhythm', 'Pacing', { rhythm: 'sinus_brady', rate: 40, pacing: 'demand', pacerRate: 60 }),
    P('Pacemaker failure to capture', 'Pacing', { rhythm: 'sinus_brady', rate: 38, pacing: 'failure_capture', pacerRate: 70 },
      'Spikes are there, complexes are not. Every spike should be followed by a wide QRS; the ones that are not are failed capture.'),
    P('Pacemaker failure to sense', 'Pacing', { rhythm: 'sinus', rate: 62, pacing: 'failure_sense', pacerRate: 70 }),

    // --- STEMI
    P('Inferior STEMI', 'STEMI', { rhythm: 'sinus_brady', rate: 52, ischemia: 'inferior', severity: 'moderate' },
      'Bradycardia with an inferior STEMI is not a coincidence — the RCA usually feeds the SA and AV nodes.'),
    P('Inferior STEMI with RV infarct', 'STEMI', { rhythm: 'sinus_brady', rate: 48, ischemia: 'inferior_rv', severity: 'moderate', extraLeads: 'right' },
      'ST elevation higher in III than II points to the RCA. Get V4R before anyone reaches for nitro.'),
    P('Anteroseptal STEMI', 'STEMI', { rhythm: 'sinus_tach', rate: 104, ischemia: 'anteroseptal', severity: 'marked' }),
    P('Extensive anterior STEMI', 'STEMI', { rhythm: 'sinus_tach', rate: 112, ischemia: 'extensive_anterior', severity: 'marked', qWaves: true },
      'Big territory, sick patient. Expect pump failure rather than the bradycardia you see with inferior infarcts.'),
    P('Lateral STEMI', 'STEMI', { rhythm: 'sinus', rate: 88, ischemia: 'lateral', severity: 'moderate' }),
    P('High lateral STEMI', 'STEMI', { rhythm: 'sinus', rate: 84, ischemia: 'high_lateral', severity: 'moderate' },
      'Only I and aVL are up, and the reciprocal depression in III is often more obvious than the elevation itself.'),
    P('Posterior STEMI (isolated)', 'STEMI', { rhythm: 'sinus', rate: 78, ischemia: 'posterior', severity: 'moderate', extraLeads: 'posterior' },
      'Nothing is elevated on the standard 12-lead. You are reading the mirror image in V1-V3: tall R, ST depression, upright T.'),
    P('Inferoposterior STEMI', 'STEMI', { rhythm: 'sinus_brady', rate: 56, ischemia: 'inferoposterior', severity: 'moderate' }),
    P('Anterior STEMI, hyperacute phase', 'STEMI', { rhythm: 'sinus', rate: 88, ischemia: 'anterior', stage: 'hyperacute' }),
    P('Inferior MI, evolving', 'STEMI', { rhythm: 'sinus', rate: 72, ischemia: 'inferior', stage: 'evolving' }),
    P('Old anterior MI', 'STEMI', { rhythm: 'sinus', rate: 74, ischemia: 'anteroseptal', stage: 'old' }),
    P('Tombstoning anterior STEMI', 'STEMI', { rhythm: 'sinus_tach', rate: 118, ischemia: 'extensive_anterior', severity: 'tombstone' }),
    P('STEMI in the setting of LBBB', 'STEMI', { rhythm: 'sinus', rate: 92, ivcd: 'lbbb', ischemia: 'inferior', severity: 'marked' },
      'Concordant ST elevation — the ST segment going the SAME way as the QRS — is the most specific Sgarbossa criterion.'),

    // --- occlusion equivalents
    P('de Winter T waves', 'Ischemia', { rhythm: 'sinus_tach', rate: 98, ischemia: 'de_winter' },
      'No ST elevation, but this is a proximal LAD occlusion until proven otherwise. Treat it like a STEMI.'),
    P('Wellens Type A', 'Ischemia', { rhythm: 'sinus', rate: 74, ischemia: 'wellens_a' }),
    P('Wellens Type B', 'Ischemia', { rhythm: 'sinus', rate: 72, ischemia: 'wellens_b' },
      'Pain-free when you meet them, deceptively well looking, and sitting on a critical LAD lesion. Do not stress test this patient.'),
    P('Diffuse subendocardial ischemia', 'Ischemia', { rhythm: 'sinus_tach', rate: 116, ischemia: 'subendocardial' },
      'Widespread ST depression with elevation in aVR. Think left main or severe three-vessel disease, not a single blocked artery.'),

    // --- hypertrophy & other
    P('Left ventricular hypertrophy', 'Other patterns', { rhythm: 'sinus', rate: 70, chambers: 'lvh' }),
    P('LVH with strain', 'Other patterns', { rhythm: 'sinus', rate: 72, chambers: 'lvh_strain' },
      'The classic STEMI mimic. Strain follows the big voltage and the ST depression is downsloping, not the flat/convex elevation of injury.'),
    P('Right ventricular hypertrophy', 'Other patterns', { rhythm: 'sinus', rate: 84, chambers: 'rvh', axis: 'rad' }),
    P('Acute pericarditis', 'Other patterns', { rhythm: 'sinus_tach', rate: 102, pattern: 'pericarditis' },
      'Diffuse, concave ST elevation that ignores coronary territories, plus PR depression. No reciprocal changes.'),
    P('Benign early repolarization', 'Other patterns', { rhythm: 'sinus', rate: 62, pattern: 'early_repol' }),
    P('Pericardial effusion with alternans', 'Other patterns', { rhythm: 'sinus_tach', rate: 122, pattern: 'alternans' }),
    P('Brugada Type 1', 'Other patterns', { rhythm: 'sinus', rate: 72, pattern: 'brugada' }),
    P('Pulmonary embolism (S1Q3T3)', 'Other patterns', { rhythm: 'sinus_tach', rate: 124, pattern: 'pe', axis: 'rad' }),

    // --- metabolic / tox
    P('Hyperkalemia, peaked T waves', 'Metabolic & tox', { rhythm: 'sinus', rate: 76, pattern: 'hyperk_mild' }),
    P('Hyperkalemia, moderate', 'Metabolic & tox', { rhythm: 'sinus', rate: 68, pattern: 'hyperk_moderate' }),
    P('Hyperkalemia, sine wave', 'Metabolic & tox', { rhythm: 'sinus', rate: 90, pattern: 'hyperk_severe' },
      'Pre-arrest. If the QRS is merging into the T wave, calcium goes in before anything else.'),
    P('Hypokalemia with U waves', 'Metabolic & tox', { rhythm: 'sinus', rate: 78, pattern: 'hypok' }),
    P('Hypocalcemia (long QT)', 'Metabolic & tox', { rhythm: 'sinus', rate: 70, pattern: 'hypocalcemia' }),
    P('Digoxin effect', 'Metabolic & tox', { rhythm: 'afib', rate: 64, pattern: 'digoxin' }),
    P('Tricyclic overdose', 'Metabolic & tox', { rhythm: 'sinus_tach', rate: 128, pattern: 'tca', axis: 'rad' },
      'Wide QRS, tachycardia, and a terminal R wave in aVR. Sodium bicarbonate, not amiodarone.'),
    P('Hypothermia with Osborn waves', 'Metabolic & tox', { rhythm: 'sinus_brady', rate: 38, pattern: 'hypothermia', artifact: 'tremor' }),

    // --- artifact
    P('Arm lead reversal', 'Artifact', { rhythm: 'sinus', rate: 74, artifact: 'la_ra_reversal' },
      'Looks alarming, means nothing. Negative P and QRS in lead I with a normal aVF is the tell — check the electrodes, do not treat the tracing.'),
    P('Muscle tremor artifact', 'Artifact', { rhythm: 'sinus', rate: 88, artifact: 'tremor' }),
    P('60 Hz interference', 'Artifact', { rhythm: 'sinus', rate: 76, artifact: 'ac60' }),
    P('Loose electrode', 'Artifact', { rhythm: 'sinus', rate: 74, artifact: 'loose_lead', looseLead: 'III' }),
    P('Baseline wander', 'Artifact', { rhythm: 'sinus', rate: 80, artifact: 'wander' }),
    P('Dextrocardia', 'Artifact', { rhythm: 'sinus', rate: 74, artifact: 'dextrocardia' })
  ];

  /* ------------------------------------------------------------ helpers */

  // Flatten a field's option list (which may contain optgroups) to [value,label].
  function flatOptions(field) {
    var out = [];
    (field.options || []).forEach(function (o) {
      if (o && o.g) o.o.forEach(function (x) { out.push(x); });
      else out.push(o);
    });
    return out;
  }

  function labelFor(fieldId, value) {
    for (var i = 0; i < CONTROLS.length; i++) {
      for (var j = 0; j < CONTROLS[i].fields.length; j++) {
        var f = CONTROLS[i].fields[j];
        if (f.id !== fieldId) continue;
        var opts = flatOptions(f);
        for (var k = 0; k < opts.length; k++) {
          if (String(opts[k][0]) === String(value)) return opts[k][1];
        }
      }
    }
    return String(value);
  }

  function findField(id) {
    for (var i = 0; i < CONTROLS.length; i++) {
      for (var j = 0; j < CONTROLS[i].fields.length; j++) {
        if (CONTROLS[i].fields[j].id === id) return CONTROLS[i].fields[j];
      }
    }
    return null;
  }

  function fromPreset(preset) {
    var cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });
    Object.keys(preset.cfg).forEach(function (k) { cfg[k] = preset.cfg[k]; });
    cfg.seed = Math.floor(Math.random() * 1e9);
    return cfg;
  }

  EKG.catalog = {
    DEFAULTS: DEFAULTS,
    CONTROLS: CONTROLS,
    PRESETS: PRESETS,
    flatOptions: flatOptions,
    labelFor: labelFor,
    findField: findField,
    fromPreset: fromPreset
  };
})(window.EKG);
