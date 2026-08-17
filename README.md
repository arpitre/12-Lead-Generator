# 12-Lead EKG Generator

A browser-based 12-lead ECG simulator for paramedic students and preceptors. Build a
tracing from dropdowns (or pick a preset case), hand it to a student in **blind mode**
so nothing gives the answer away, then reveal a step-by-step explanation of *why* the
interpretation is what it is — anatomically and electrically.

No build step, no dependencies, no backend. Open `index.html` and it runs.

---

## Running it

**Hosted (recommended for a class):** publish the repository with GitHub Pages
(Settings → Pages → deploy from branch, root folder). Students then just need the URL.

**Local:** clone the repository and open `index.html` in any modern browser. It works
straight off the filesystem — no server required — so a preceptor can carry the folder
on a USB stick.

**Local with a server** (only needed if you want clean share links):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## How you'd use it

### Building a case
Open **Case builder** and either start from a preset (85 of them, grouped by topic) or
compose one yourself. Every dropdown is independent, so you can stack findings the way
real patients do — an inferior STEMI *with* a Wenckebach *with* muscle tremor artifact.

Controls cover rate and rhythm, ectopy, AV block, axis, bundle branch and fascicular
block, pre-excitation, pacing (including failure to capture and undersensing), infarct
territory and stage, chamber enlargement, electrolyte and toxicologic patterns, extra
lead sets, and acquisition artifact.

### Blind mode
Turn on **Blind mode** and the app hides the measurement block, the machine
interpretation, the case name and the entire control panel. The student gets a tracing
and nothing else. **Reveal** brings back the interpretation and the walkthrough; it
toggles, so you can hide it again and re-run the case.

A shared link generated while blind mode is on *opens* in blind mode — that is the
intended way to assign a case.

### The explanation
After revealing, the walkthrough follows the order a student should read every 12-lead:

1. **Rate** — how to count it, and why an irregular rhythm breaks the 300-rule
2. **Rhythm & regularity** — regularity, P waves, P:QRS relationship, QRS width
3. **Axis** — the quadrant method and what a deviation implies
4. **Intervals** — PR, QRS, QT/QTc with the thresholds that matter
5. **Morphology & conduction** — bundle branch blocks, hypertrophy, pattern recognition
6. **ST segments & T waves** — measured deviations, contiguity, reciprocal change
7. **Anatomy & vessel** — which wall, which artery, which complications to expect
8. **Mimics** — the look-alikes and how to exclude them
9. **What it means in the field** — prehospital implications

Sections that relate to particular leads have a **Highlight on the tracing** button.

### Other tools
- **Calipers** — drag across the tracing to measure. Reports milliseconds, large
  squares, millimetres, millivolts, and the heart rate an R-R of that length implies.
- **Share case** — encodes the entire case into the URL, including the random seed, so
  the recipient sees a byte-identical tracing right down to the artifact.
- **Random case** — optionally restricted to one topic ("only blocks", "only STEMIs").
  Opens blind, since a random case is most useful unseen.
- **Print** — prints the tracing on one page with the explanation on a second. Printing
  while in blind mode gives you a clean worksheet.

---

## How the waveform is generated

The tracing is **not** twelve hand-drawn squiggles. It is a simulated cardiac vector
projected onto each lead's axis, which is what a real ECG machine records.

At any instant the heart is modelled as a single electrical dipole in 3D space
(`+x` toward the patient's left, `+y` toward the feet, `+z` toward the back). Each lead
is a direction in that space, and the trace a lead draws is the dot product of the
vector with that direction.

A heartbeat is assembled from a few vector lobes:

| Lobe | Direction | What it produces |
|---|---|---|
| Septal | rightward, anterior | small q in I/aVL/V5/V6, small r in V1 |
| Main free wall | leftward, inferior, posterior | the dominant R wave; carries the axis |
| Terminal basal | rightward, superior | small s in I and V6 |
| T wave | roughly concordant with the main lobe | normal upright T |
| Injury (ST) | outward through the ischaemic wall | ST elevation and depression |

The injury current is modelled as a standing DC offset that builds across the *whole*
QRS, because muscle is converted to the injured potential progressively as
depolarisation sweeps through it. By the time the R wave is on its way down the offset
is most of the way in, so the descending limb never reaches the isoelectric line — it
curves straight into the ST segment. That is why a real STEMI's J point is itself
elevated and why the ST and T fuse into one dome.

Two further details make the difference between a tracing that looks real and one that
does not:

- **Terminal forces are attenuated in proportion to injury severity.** Ischaemic muscle
  generates little late depolarisation force, which is why the S wave shrinks or
  vanishes over an infarcting wall. This is mechanical, not cosmetic: the terminal lobe
  peaks about 20 ms before the J point, so leaving it intact drags the trace back down
  through the baseline exactly where the ST should be lifting. Pericarditis and early
  repolarisation deliberately keep their S waves — that muscle is alive.
- **Acute injury takes off convex or obliquely straight.** The concave saddle is
  reserved for early repolarisation and pericarditis, which is the discriminator
  students actually need.

Pathology is expressed by adding, removing, rotating or rescaling those lobes — never
by drawing a lead by hand. This is the point of the whole design, because it means the
teaching relationships emerge from the physics instead of being faked:

- **Reciprocal change is automatic.** One injury vector points at the damaged wall.
  Leads facing it record elevation; leads on the opposite side record its mirror. There
  is no code that "adds ST depression to aVL" for an inferior MI.
- **III > II in an RCA occlusion falls out for free**, because lead III sits further
  right than lead II and the RV injury vector points rightward as well as downward.
- **Posterior infarction produces no elevation at all** on the standard 12 leads, and
  the V7-V9 electrodes see it plainly — same vector, different electrode positions.
- **Axis deviation is a rotation**, so every lead changes together and consistently.
- **Dextrocardia** is modelled by mirroring the chest leads, which reproduces both the
  inverted lead I and the reversed R-wave progression from one change.

Rhythm is scheduled independently of morphology. Atrial and ventricular activity are
separate timelines, which is the only honest way to draw complete heart block: the
P waves and QRS complexes really are two unrelated metronomes marching through each
other. Wenckebach uses a decreasing PR increment, so the R-R intervals genuinely
shorten before the dropped beat, the way they do on a real strip.

Ventricular and paced beats are painted into a second buffer and projected with lower
chest-lead gains, because a broad muscle-to-muscle wavefront couples to the precordial
electrodes very differently from a compact His-Purkinje dipole.

### Calibrating against real recordings (PTB-XL)

The constants in `leads.js` and `morphology.js` were tuned by eye against published
morphology. `tools/ptbxl_profile.py` replaces that with measurements taken from real
clinical ECGs.

[PTB-XL](https://physionet.org/content/ptb-xl/1.0.3/) is 21,799 clinical 12-leads from
18,869 patients, annotated with SCP diagnostic statements. The script reads a local copy
**in place** and writes one small JSON of aggregate statistics — a median P-QRS-T beat
and an amplitude summary for each diagnosis, in each of the twelve leads:

```bash
pip install wfdb numpy pandas
python tools/ptbxl_profile.py "D:/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3"
# -> assets/data/ptbxl-profiles.json   (a few hundred KB)
```

Only medians computed across hundreds of records are written out; no individual patient
recording is copied or redistributed. PTB-XL is published under CC BY 4.0, and the
attribution that licence requires is embedded in the output file.

The dataset itself is ~2 GB and is deliberately **not** committed here. Only the derived
profile is.

That profile is useful in two ways. It lets per-lead gains, amplitudes and ST magnitudes
be set from real distributions instead of estimated. More importantly it turns "does this
tracing look right?" into a number: a synthesized beat can be compared against the median
real beat for the same diagnosis, lead by lead. Every morphology bug found so far was
caught by a clinician's eye rather than by the automated checks, because the checks test
properties that were chosen after the fact. A reference beat tests the whole shape at
once, including whatever nobody thought to assert.

### Measurements are measured, not asserted
The ST deviations quoted in the explanation are sampled off the rendered signal 40 ms
past the J point against the TP baseline — the same place a human reader puts their eye
— rather than read back out of the configuration. If the engine ever draws something
different from what the dropdowns claim, the numbers disagree and the discrepancy is
visible instead of hidden.

---

## Project layout

```
index.html
assets/css/app.css
assets/js/
  leads.js        lead geometry and per-lead gains
  morphology.js   beat templates; all pathology modifiers
  rhythm.js       beat scheduling: rhythms, blocks, ectopy, pacing
  generator.js    assembles the signal and projects it onto the leads
  interpret.js    measurements off the signal + machine-style statements
  catalog.js      the dropdown schema and the preset case library
  explain.js      the step-by-step teaching walkthrough
  render.js       SVG renderer (ECG paper, 4x3 + rhythm strip, header)
  calipers.js     drag-to-measure
  app.js          UI wiring, blind mode, sharing, printing
```

The SVG is drawn in **millimetre units**, so 25 mm/s and 10 mm/mV are literally 25 and
10 in that coordinate space, the grid is a 1 mm pattern, and the calipers report real
time and voltage with no scaling fudge factor.

### Adding a finding
1. Add the physiology to `morphology.js` (a lobe, a vector rotation, or an overlay).
2. Add the option to the relevant field in `catalog.js`.
3. Add a machine statement in `interpret.js` and teaching text in `explain.js`.
4. Optionally add a preset to `PRESETS` so it is one click away.

---

## Scope and limitations

- Tracings are **physiologic approximations, not recordings from real patients.** They
  are built to teach pattern recognition and the reasoning behind it.
- The visual style follows a monitor-style 12-lead printout. It is not a pixel-exact
  reproduction of any manufacturer's output, and the interpretation statements are
  written in the style of a monitor's algorithm rather than copied from one.
- Real ECGs contain variation this model does not reproduce: body habitus, lead
  placement drift, prior infarcts layered under new ones, and the sheer messiness of
  sick patients. Students should move to real 12-leads once they have the system down.
- **Not for clinical use.** Nothing generated here should inform the care of a patient.

## License

MIT — see `LICENSE`. Use it, fork it, adapt it for your service or program.
