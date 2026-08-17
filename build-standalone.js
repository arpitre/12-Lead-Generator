#!/usr/bin/env node
/* build-standalone.js — bundle the app into one self-contained HTML file.
 *
 *   node build-standalone.js
 *
 * Produces `12-lead-generator.html`: no external CSS or JS, no server, no
 * network. Double-click it, email it, put it on a USB stick, or host it
 * anywhere that serves a single file.
 *
 * Re-run this after changing anything in assets/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, '12-lead-generator.html');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Load order matters: each file registers itself on the shared EKG namespace.
const SCRIPTS = [
  'assets/js/leads.js',
  'assets/js/morphology.js',
  'assets/js/rhythm.js',
  'assets/js/generator.js',
  'assets/js/interpret.js',
  'assets/js/catalog.js',
  'assets/js/explain.js',
  'assets/js/render.js',
  'assets/js/calipers.js',
  'assets/js/app.js'
];

const html = read('index.html');
const css = read('assets/css/app.css');

// Pull the page markup out of index.html and drop the <script src> tags,
// so the two entry points can never drift apart.
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('could not find <body> in index.html');
const body = bodyMatch[1].replace(/<script\s+src=[^>]*><\/script>/gi, '').trim();

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
const title = titleMatch ? titleMatch[1].trim() : '12-Lead EKG Generator';

// A literal </script> anywhere inside inlined JS would close the tag early.
const guard = js => js.replace(/<\/script>/gi, '<\\/script>');

const js = SCRIPTS.map(f =>
  '/* ===== ' + f + ' ===== */\n' + guard(read(f))
).join('\n\n');

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="Generate realistic simulated 12-lead ECG tracings for paramedic students and preceptors, with blind interpretation mode and step-by-step explanations.">
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + kb + ' KB, ' + SCRIPTS.length + ' scripts inlined)');
