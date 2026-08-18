/* render.js — draws the tracing as SVG on ECG paper.
 *
 * All SVG user units are millimetres, which makes the whole thing honest:
 * 25 mm/s and 10 mm/mV are literally 25 and 10 in this coordinate space, the
 * grid is a 1 mm pattern, and the calipers can report real time and voltage
 * without a scaling fudge factor anywhere.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var MM_PER_SEC = 25;
  var MM_PER_MV = 10;

  var PAGE = {
    pad: 4,
    calWidth: 11,       // room for the 1 mV calibration pulse at the row start
    colWidth: 62.5,     // 2.5 seconds at 25 mm/s
    cols: 4,
    rowHeight: 30,
    rhythmHeight: 32,
    headerHeight: 31
  };

  var LAYOUT = [
    ['I', 'aVR'],
    ['II', 'aVL'],
    ['III', 'aVF']
  ];

  function precordialSet(cfg) {
    if (cfg.extraLeads === 'right') return [['V1', 'V4R'], ['V2', 'V5R'], ['V3', 'V6R']];
    if (cfg.extraLeads === 'posterior') return [['V1', 'V7'], ['V2', 'V8'], ['V3', 'V9']];
    return [['V1', 'V4'], ['V2', 'V5'], ['V3', 'V6']];
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtTime(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '  ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* Build the polyline for one lead over one time window. */
  function tracePath(data, fs, t0, t1, x0, baselineY, clip) {
    var i0 = Math.max(0, Math.round(t0 * fs));
    var i1 = Math.min(data.length - 1, Math.round(t1 * fs));
    var pts = [];
    for (var i = i0; i <= i1; i++) {
      var x = x0 + ((i - i0) / fs) * MM_PER_SEC;
      var y = baselineY - data[i] * MM_PER_MV;
      if (y < baselineY - clip) y = baselineY - clip;
      if (y > baselineY + clip) y = baselineY + clip;
      pts.push(x.toFixed(2) + ',' + y.toFixed(2));
    }
    return pts.join(' ');
  }

  function render(result, opts) {
    opts = opts || {};
    var cfg = result.config;
    var blind = !!opts.blind;
    var highlight = opts.highlight || [];
    var interp = opts.interp || EKG.interpret.interpret(result);

    var grid = LAYOUT.map(function (row, i) { return row.concat(precordialSet(cfg)[i]); });
    var rhythmLead = 'II';

    var contentW = PAGE.calWidth + PAGE.colWidth * PAGE.cols;
    var W = contentW + PAGE.pad * 2;

    /* The header grows with the interpretation: a normal ECG needs two lines,
     * an inferior STEMI with reciprocal change needs five. A fixed height
     * would either waste paper or run the statements over the tracing. */
    var maxLines = 6;
    var nLines = blind ? 2 : Math.min(interp.lines.length, maxLines);
    var headerH = blind ? 20
      : 15 + (interp.alert ? 7 : 0) + nLines * 4.1 + 4;
    var tracingTop = PAGE.pad + headerH;
    var H = tracingTop + PAGE.rowHeight * 3 + PAGE.rhythmHeight + PAGE.pad + 5;

    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' +
      'class="ecg-svg" preserveAspectRatio="xMidYMid meet" role="img" ' +
      'aria-label="Simulated 12-lead electrocardiogram">');

    // ---- ECG paper grid
    s.push('<defs>' +
      '<pattern id="minorGrid" width="1" height="1" patternUnits="userSpaceOnUse">' +
      '<path d="M1,0 L0,0 0,1" fill="none" class="grid-minor" stroke-width="0.08"/></pattern>' +
      '<pattern id="majorGrid" width="5" height="5" patternUnits="userSpaceOnUse">' +
      '<rect width="5" height="5" fill="url(#minorGrid)"/>' +
      '<path d="M5,0 L0,0 0,5" fill="none" class="grid-major" stroke-width="0.22"/></pattern>' +
      '</defs>');
    s.push('<rect width="' + W + '" height="' + H + '" class="paper"/>');
    s.push('<rect x="0" y="' + (tracingTop - 3) + '" width="' + W + '" height="' + (H - tracingTop + 3) +
      '" fill="url(#majorGrid)"/>');

    // ---- header
    s.push(renderHeader(result, interp, blind, W, maxLines));

    // ---- highlight bands
    var rows = [];
    for (var r = 0; r < 3; r++) rows.push(tracingTop + r * PAGE.rowHeight);
    if (highlight.length) {
      for (var hr = 0; hr < 3; hr++) {
        for (var hc = 0; hc < 4; hc++) {
          if (highlight.indexOf(grid[hr][hc]) === -1) continue;
          var hx = PAGE.pad + PAGE.calWidth + hc * PAGE.colWidth;
          s.push('<rect x="' + hx + '" y="' + rows[hr] + '" width="' + PAGE.colWidth +
            '" height="' + PAGE.rowHeight + '" class="lead-highlight"/>');
        }
      }
    }

    // ---- twelve lead panels
    var clip = PAGE.rowHeight / 2 - 1.2;
    for (var row = 0; row < 3; row++) {
      var baseY = rows[row] + PAGE.rowHeight / 2;

      // calibration pulse: 1 mV = 10 mm tall, 5 mm wide
      var cx = PAGE.pad + 2;
      s.push('<polyline class="trace" points="' +
        cx + ',' + baseY + ' ' + (cx + 1.5) + ',' + baseY + ' ' +
        (cx + 1.5) + ',' + (baseY - MM_PER_MV) + ' ' +
        (cx + 6.5) + ',' + (baseY - MM_PER_MV) + ' ' +
        (cx + 6.5) + ',' + baseY + ' ' + (cx + 8.5) + ',' + baseY + '"/>');

      for (var col = 0; col < 4; col++) {
        var name = grid[row][col];
        var data = result.leads[name];
        var x0 = PAGE.pad + PAGE.calWidth + col * PAGE.colWidth;
        var t0 = col * 2.5, t1 = t0 + 2.5;

        if (col > 0) {
          s.push('<line x1="' + x0 + '" y1="' + (rows[row] + 3) + '" x2="' + x0 +
            '" y2="' + (rows[row] + PAGE.rowHeight - 3) + '" class="col-sep"/>');
        }
        s.push('<text x="' + (x0 + 1.5) + '" y="' + (rows[row] + 5.5) + '" class="lead-label">' + name + '</text>');

        if (data) {
          s.push('<polyline class="trace" points="' + tracePath(data, result.fs, t0, t1, x0, baseY, clip) + '"/>');
        }
        s.push(pacerSpikes(result, t0, t1, x0, baseY, clip));
      }
    }

    // ---- rhythm strip
    var ry = tracingTop + PAGE.rowHeight * 3;
    var rBase = ry + PAGE.rhythmHeight / 2;
    var rClip = PAGE.rhythmHeight / 2 - 1.2;
    s.push('<line x1="' + PAGE.pad + '" y1="' + ry + '" x2="' + (W - PAGE.pad) + '" y2="' + ry + '" class="row-sep"/>');
    var rcx = PAGE.pad + 2;
    s.push('<polyline class="trace" points="' +
      rcx + ',' + rBase + ' ' + (rcx + 1.5) + ',' + rBase + ' ' +
      (rcx + 1.5) + ',' + (rBase - MM_PER_MV) + ' ' +
      (rcx + 6.5) + ',' + (rBase - MM_PER_MV) + ' ' +
      (rcx + 6.5) + ',' + rBase + ' ' + (rcx + 8.5) + ',' + rBase + '"/>');
    s.push('<text x="' + (PAGE.pad + PAGE.calWidth + 1.5) + '" y="' + (ry + 5.5) + '" class="lead-label">' +
      rhythmLead + '  (rhythm strip)</text>');
    s.push('<polyline class="trace" points="' +
      tracePath(result.leads[rhythmLead], result.fs, 0, result.duration, PAGE.pad + PAGE.calWidth, rBase, rClip) + '"/>');
    s.push(pacerSpikes(result, 0, result.duration, PAGE.pad + PAGE.calWidth, rBase, rClip));

    // ---- technical footer, exactly the sort of line a monitor prints
    s.push('<text x="' + PAGE.pad + '" y="' + (H - 1.5) + '" class="footer-text">' +
      '25 mm/s &#160; 10 mm/mV &#160; 0.05&#8211;150 Hz &#160; 60 Hz notch on' + '</text>');
    s.push('<text x="' + (W - PAGE.pad) + '" y="' + (H - 1.5) + '" class="footer-text" text-anchor="end">' +
      (blind ? 'BLIND MODE &#8212; interpretation withheld' : 'Simulated tracing &#8212; training use only') + '</text>');

    s.push('</svg>');
    return s.join('');
  }

  function pacerSpikes(result, t0, t1, x0, baseY, clip) {
    var spikes = result.schedule.pacerSpikes || [];
    if (!spikes.length) return '';
    var out = [];
    spikes.forEach(function (sp) {
      if (sp.t < t0 || sp.t > t1) return;
      var x = x0 + (sp.t - t0) * MM_PER_SEC;
      var h = sp.chamber === 'A' ? 5 : 9;
      out.push('<line x1="' + x.toFixed(2) + '" y1="' + (baseY + 1.5) + '" x2="' + x.toFixed(2) +
        '" y2="' + (baseY - h) + '" class="pacer-spike"/>');
    });
    return out.join('');
  }

  function renderHeader(result, interp, blind, W, maxLines) {
    var m = result.measurements, cfg = result.config;
    var s = [];
    var y = PAGE.pad + 5;
    var left = PAGE.pad + 1;

    s.push('<text x="' + left + '" y="' + y + '" class="hdr-title">12-LEAD ECG &#160;&#160; TRAINING SIMULATION</text>');
    s.push('<text x="' + (W - PAGE.pad) + '" y="' + y + '" class="hdr-meta" text-anchor="end">' +
      'UNCONFIRMED &#8212; SIMULATED &#160;&#160; ' + esc(fmtTime(new Date())) + '</text>');
    s.push('<line x1="' + PAGE.pad + '" y1="' + (y + 1.8) + '" x2="' + (W - PAGE.pad) + '" y2="' + (y + 1.8) + '" class="hdr-rule"/>');

    if (blind) {
      s.push('<text x="' + left + '" y="' + (y + 8) + '" class="hdr-blind">' +
        'MEASUREMENTS AND INTERPRETATION WITHHELD &#8212; BLIND MODE</text>');
      s.push('<text x="' + left + '" y="' + (y + 14) + '" class="hdr-meta">' +
        'Interpret the tracing below, then use Reveal to check yourself.</text>');
      return s.join('');
    }

    // Measurement block, laid out the way a monitor prints it.
    var cells = [
      ['VENT. RATE', m.hr ? m.hr + ' BPM' : '--'],
      ['PR INT', m.pr ? m.pr + ' ms' : '-- ms'],
      ['QRS DUR', m.qrs + ' ms'],
      ['QT/QTc', m.qt + '/' + m.qtc + ' ms'],
      ['P-QRS-T AXES', (m.pAxis === null ? '--' : m.pAxis) + '  ' + m.qrsAxis + '  ' + m.tAxis]
    ];
    // Keep the measurement cells inside the left three-quarters so the last
    // one cannot collide with anything anchored to the right edge.
    var cw = (W - PAGE.pad * 2) * 0.82 / cells.length;
    cells.forEach(function (c, i) {
      var cx = left + i * cw;
      s.push('<text x="' + cx + '" y="' + (y + 6.5) + '" class="hdr-key">' + c[0] + '</text>');
      s.push('<text x="' + cx + '" y="' + (y + 11.5) + '" class="hdr-val">' + esc(c[1]) + '</text>');
    });

    var iy = y + 16.5;
    if (interp.alert) {
      s.push('<rect x="' + PAGE.pad + '" y="' + (iy - 3.8) + '" width="' + (W - PAGE.pad * 2) +
        '" height="5.6" class="alert-band"/>');
      s.push('<text x="' + left + '" y="' + (iy) + '" class="hdr-alert">' + esc(interp.alert) + '</text>');
      iy += 6.5;
    }

    var shown = interp.lines.slice(0, maxLines);
    shown.forEach(function (line, i) {
      s.push('<text x="' + left + '" y="' + (iy + i * 4.1) + '" class="hdr-interp">' + esc(line) + '</text>');
    });

    if (interp.lines.length > maxLines) {
      s.push('<text x="' + (W - PAGE.pad) + '" y="' + (iy + (shown.length - 1) * 4.1) + '" class="hdr-meta" text-anchor="end">' +
        '+' + (interp.lines.length - maxLines) + ' more statement(s) — see interpretation below</text>');
    }

    return s.join('');
  }

  EKG.render = {
    render: render,
    MM_PER_SEC: MM_PER_SEC,
    MM_PER_MV: MM_PER_MV,
    PAGE: PAGE
  };
})(window.EKG);
