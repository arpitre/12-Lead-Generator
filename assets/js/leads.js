/* leads.js — lead geometry.
 *
 * Everything in this app is built on a single idea: at any instant the heart
 * behaves like one electrical vector in 3D space. Each ECG lead is a direction
 * in that space, and the squiggle a lead draws is just the vector projected
 * onto (dotted with) that lead's direction.
 *
 * Coordinate system (patient-centred):
 *   +x  toward the patient's LEFT
 *   +y  toward the patient's FEET (inferior)
 *   +z  toward the patient's BACK (posterior);  -z = anterior
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var D = Math.PI / 180;

  // Frontal-plane lead: the familiar hexaxial angles (Lead I = 0 deg, aVF = +90).
  function frontal(deg) { return [Math.cos(deg * D), Math.sin(deg * D), 0]; }

  // Horizontal-plane lead: angle measured from V6 (0 deg, straight left)
  // rotating toward anterior.
  function transverse(deg) { return [Math.cos(deg * D), 0, -Math.sin(deg * D)]; }

  /* Chest electrode: a transverse angle plus a downward tilt.
   *
   * V3-V6 sit in the fifth intercostal space, below the electrical centre of
   * the heart, so their lead axes point a little toward the feet as well as
   * round the chest. Leaving that out makes V6 an exact copy of lead I -- any
   * rightward axis then wipes the R waves out of the lateral chest leads,
   * which real right-axis tracings do not do. */
  function chest(deg, tilt) {
    var t = transverse(deg);
    return unit([t[0], tilt || 0, t[2]]);
  }

  function unit(v) {
    var m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / m, v[1] / m, v[2] / m];
  }

  var LEAD_VECTORS = {
    I:   frontal(0),
    II:  frontal(60),
    III: frontal(120),
    aVR: frontal(-150),
    aVL: frontal(-30),
    aVF: frontal(90),

    V1: chest(115, 0),
    V2: chest(94, 0),
    V3: chest(63, 0.10),
    V4: chest(48, 0.20),
    V5: chest(23, 0.22),
    V6: chest(0, 0.22),

    // Right-sided chest leads are the mirror image of V4-V6 across the midline.
    V4R: chest(132, 0.20),
    V5R: chest(157, 0.22),
    V6R: chest(180, 0.22),

    // Posterior leads continue around the back past V6, at the same level.
    V7: chest(-22, 0.22),
    V8: chest(-45, 0.22),
    V9: chest(-67, 0.22)
  };

  /* A single central dipole can't know that the chest electrodes sit closer to
   * the heart than the limb electrodes do. These per-lead gains stand in for
   * that proximity effect; they are what make V2-V4 tall and the limb leads
   * comparatively modest, the way a real 12-lead looks. */
  var QRS_GAIN = {
    I: 1, II: 1, III: 1, aVR: 1, aVL: 1, aVF: 1,
    V1: 1.50, V2: 2.30, V3: 2.45, V4: 2.35, V5: 1.85, V6: 1.40,
    V4R: 1.30, V5R: 1.15, V6R: 1.00,
    V7: 1.15, V8: 1.00, V9: 0.90
  };

  /* A ventricular or paced beat spreads slowly through muscle as a broad
   * wavefront rather than a compact dipole, so the chest electrodes get less
   * of a proximity boost from it than they do from a normal QRS -- but not
   * none: a real PVC is still the biggest thing on the page in V2-V4. */
  var VENT_GAIN = {
    I: 1, II: 1, III: 1, aVR: 1, aVL: 1, aVF: 1,
    V1: 1.30, V2: 1.70, V3: 1.70, V4: 1.60, V5: 1.40, V6: 1.20,
    V4R: 1.10, V5R: 1.00, V6R: 0.95,
    V7: 1.00, V8: 0.90, V9: 0.85
  };

  /* Injury currents are a slower, more diffuse phenomenon than the QRS spike,
   * so the precordial proximity boost is much smaller for the ST segment.
   * Without this, a 2 mm inferior STEMI would render as 7 mm of anterior ST
   * elevation. */
  var ST_GAIN = {
    I: 1, II: 1, III: 1, aVR: 1, aVL: 1, aVF: 1,
    V1: 1.15, V2: 1.45, V3: 1.45, V4: 1.40, V5: 1.25, V6: 1.10,
    V4R: 1.20, V5R: 1.10, V6R: 1.00,
    V7: 1.00, V8: 0.95, V9: 0.90
  };

  var STANDARD_12 = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF',
                     'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function scale(v, k) { return [v[0] * k, v[1] * k, v[2] * k]; }

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

  /* Build a direction from a frontal-plane angle plus a posterior component.
   * This is how axis deviation is expressed: rotate the angle, keep the rest. */
  function axisDir(angleDeg, posterior) {
    return unit([Math.cos(angleDeg * D), Math.sin(angleDeg * D), posterior || 0]);
  }

  // Frontal-plane axis of a vector, in the conventional -180..+180 degrees.
  function frontalAxis(v) {
    return Math.round(Math.atan2(v[1], v[0]) / D);
  }

  EKG.leads = {
    VECTORS: LEAD_VECTORS,
    QRS_GAIN: QRS_GAIN,
    VENT_GAIN: VENT_GAIN,
    ST_GAIN: ST_GAIN,
    STANDARD_12: STANDARD_12,
    frontal: frontal,
    transverse: transverse,
    unit: unit,
    dot: dot,
    scale: scale,
    add: add,
    axisDir: axisDir,
    frontalAxis: frontalAxis
  };
})(window.EKG);
