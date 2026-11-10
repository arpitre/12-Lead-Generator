#!/usr/bin/env node
/* make-landing-images.js — regenerate the tracings shown on the landing page.
 *
 *   node tools/make-landing-images.js
 *
 * The hero sheet, the three sample strips and the social preview card are all
 * drawn by the simulator's own engine, so they have to be regenerated whenever
 * the morphology model changes or they will show waveforms the app no longer
 * produces. The SVGs need nothing but Node. The PNG card additionally needs
 * Playwright (`npm i playwright`); without it that one file is skipped.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'assets/img');

const ctx = { window: { EKG: {} }, console, Math, Date, Float32Array };
vm.createContext(ctx);
['leads', 'morphology', 'rhythm', 'generator', 'interpret', 'catalog', 'treatment', 'explain', 'render']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f + '.js'), 'utf8'), ctx));
const EKG = ctx.window.EKG;

const SEED = 20250817;
const gen = cfg => EKG.generator.generate(Object.assign({}, EKG.catalog.DEFAULTS, cfg, { seed: SEED }));
const preset = label => EKG.catalog.PRESETS.find(p => p.label === label).cfg;

const PAPER = '#fff7f4', MINOR = '#f2b9ae', MAJOR = '#e08878', INK = '#14100f';
const FONT = "Segoe UI, system-ui, sans-serif";
const GRID = '<defs><pattern id="mn" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1,0 L0,0 0,1" fill="none" stroke="' + MINOR +
  '" stroke-width="0.08"/></pattern><pattern id="mj" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#mn)"/>' +
  '<path d="M5,0 L0,0 0,5" fill="none" stroke="' + MAJOR + '" stroke-width="0.22"/></pattern></defs>';

// One lead as a polyline: 25 mm/s, 10 mm/mV, every second sample.
function trace(r, lead, t0, seconds, x0, baseY, stroke) {
  const d = r.leads[lead], fs_ = r.fs, pts = [];
  for (let i = Math.round(t0 * fs_); i <= Math.round((t0 + seconds) * fs_) && i < d.length; i += 2) {
    pts.push((x0 + (i / fs_ - t0) * 25).toFixed(2) + ',' + (baseY - d[i] * 10).toFixed(2));
  }
  return '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + INK + '" stroke-width="' + stroke +
    '" stroke-linejoin="round" stroke-linecap="round"/>';
}

function label(text, y) {
  const w = 3.7 + text.length * 1.05;
  return '<rect x="3.2" y="' + y + '" width="' + w.toFixed(1) + '" height="4.4" rx="0.8" fill="' + PAPER + '" opacity="0.92"/>' +
    '<text x="4" y="' + (y + 3.4).toFixed(1) + '" font-family="' + FONT + '" font-size="3.2" font-weight="700" fill="' + INK + '">' + text + '</text>';
}

// Two-lead sample strip, 4.2 seconds wide. rows: [lead, baselineY].
function strip(file, cfg, rows, t0) {
  const r = gen(cfg);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 111 48" role="img" aria-label="Simulated ECG strip">\n' + GRID +
    '\n<rect width="111" height="48" fill="' + PAPER + '"/>\n<rect width="111" height="48" fill="url(#mj)"/>\n';
  rows.forEach((row, i) => { s += trace(r, row[0], t0, 4.2, 3, row[1], 0.42) + '\n' + label(row[0], i === 0 ? 2.8 : 24.8) + '\n'; });
  fs.writeFileSync(path.join(IMG, file), s + '</svg>');
  console.log('wrote assets/img/' + file);
}

// The full sheet, exactly as the app renders it, with its styles inlined.
function hero() {
  const RealDate = ctx.Date;
  ctx.Date = function () { return new RealDate(2026, 7, 17, 21, 54, 29); };   // a fixed timestamp keeps the file stable
  let svg = EKG.render.render(gen(preset('Normal sinus rhythm')), {});
  ctx.Date = RealDate;
  const sans = "font-family:'Segoe UI',system-ui,sans-serif", mono = 'font-family:ui-monospace,Menlo,Consolas,monospace';
  const css = '<style>\n.paper{fill:' + PAPER + '}.grid-minor{stroke:' + MINOR + '}.grid-major{stroke:' + MAJOR + '}\n' +
    '.trace{fill:none;stroke:' + INK + ';stroke-width:.34;stroke-linejoin:round;stroke-linecap:round}\n' +
    '.col-sep{stroke:' + MAJOR + ';stroke-width:.15}.row-sep{stroke:' + MAJOR + ';stroke-width:.2}\n' +
    '.lead-label{' + sans + ';font-size:3.2px;font-weight:700;fill:' + INK + '}\n' +
    '.footer-text{' + sans + ';font-size:2.6px;fill:#7a5c55}\n' +
    '.hdr-title{' + sans + ';font-size:3.6px;font-weight:700;fill:' + INK + ';letter-spacing:.04em}\n' +
    '.hdr-meta{' + sans + ';font-size:2.9px;fill:#7a5c55}\n.hdr-rule{stroke:#b98d82;stroke-width:.2}\n' +
    '.hdr-key{' + sans + ';font-size:2.5px;font-weight:700;fill:#8a655c;letter-spacing:.05em}\n' +
    '.hdr-val{' + mono + ';font-size:3.4px;font-weight:700;fill:' + INK + '}\n' +
    '.hdr-interp{' + mono + ';font-size:3.1px;fill:' + INK + '}\n</style>';
  svg = svg.replace(/(<svg[^>]*>)/, '$1' + css);
  fs.writeFileSync(path.join(IMG, 'hero-12-lead.svg'), svg);
  console.log('wrote assets/img/hero-12-lead.svg');
}

// 1200 x 630 social preview card: needs a browser to rasterise.
async function ogCard() {
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) { console.log('playwright not installed - skipped og-cover.png'); return; }
  const r = gen(preset('Normal sinus rhythm'));
  const stripSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 34" width="1200" height="170">' + GRID +
    '<rect width="240" height="34" fill="' + PAPER + '"/><rect width="240" height="34" fill="url(#mj)"/>' +
    trace(r, 'II', 0.2, 9.4, 3, 23, 0.5) +
    '<rect x="3.2" y="2.6" width="6" height="4.6" rx="0.8" fill="' + PAPER + '" opacity="0.92"/>' +
    '<text x="4.2" y="6.2" font-family="' + FONT + '" font-size="3.4" font-weight="700" fill="' + INK + '">II</text></svg>';
  const html = '<body style="margin:0;width:1200px;height:630px;background:#0e1117;font-family:DejaVu Sans,Segoe UI,system-ui,sans-serif;position:relative;overflow:hidden">' +
    '<div style="position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:12px;color:#4a9fe3;font-size:24px;font-weight:700">' +
    '<svg viewBox="0 0 52 18" width="52" height="18"><path d="M0,9 H2 Q4.5,5.6 7.5,9 L9.5,9 L10.3,10.2 L12,1.8 L13.7,13.2 L14.5,9 L16.5,9 Q19.5,3.8 23,9 L28,9 Q30.5,5.6 33.5,9 L35.5,9 L36.3,10.2 L38,1.8 L39.7,13.2 L40.5,9 L42.5,9 Q45.5,3.8 49,9 L52,9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>12 Lead Simulator</div>' +
    '<div style="position:absolute;left:64px;top:104px;color:#f1f3f7;font-size:64px;font-weight:700;line-height:1.02;width:700px">Unlimited ECGs to practice on.</div>' +
    '<div style="position:absolute;left:64px;top:246px;color:#b6bdc9;font-size:25px;line-height:1.36;width:520px">Build any case, hide the answer, then reveal the reasoning — free in the browser.</div>' +
    '<div style="position:absolute;left:0;top:392px;width:1200px;height:170px;border-top:3px solid #4a9fe3">' + stripSvg + '</div></body>';
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await pg.setContent(html);
  await pg.screenshot({ path: path.join(IMG, 'og-cover.png') });
  await b.close();
  console.log('wrote assets/img/og-cover.png');
}

hero();
strip('case-normal.svg', preset('Normal sinus rhythm'), [['II', 15], ['V2', 31]], 0.6);
strip('case-inferior-stemi.svg', preset('Inferior STEMI'), [['III', 15], ['aVL', 34]], 0.6);
strip('case-heart-block.svg', preset('Complete heart block, junctional escape'), [['II', 15], ['V1', 33]], 0.6);
ogCard();
