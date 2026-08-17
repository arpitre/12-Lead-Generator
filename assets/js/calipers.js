/* calipers.js — drag-to-measure on the tracing.
 *
 * Because the SVG is drawn in millimetre units, a measurement is just the
 * width of the drag: millimetres divided by 25 mm/s gives seconds, and
 * millimetres divided by 10 mm/mV gives millivolts. No calibration constant
 * to get wrong.
 */
window.EKG = window.EKG || {};
(function (EKG) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var state = { active: false, svg: null, drag: null, group: null, readout: null };

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function toSvgPoint(svg, evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  function clear() {
    if (state.group && state.group.parentNode) state.group.parentNode.removeChild(state.group);
    state.group = null;
    if (state.readout) state.readout.textContent = 'Drag across the tracing to measure.';
  }

  function draw(p0, p1) {
    if (!state.svg) return;
    if (state.group && state.group.parentNode) state.group.parentNode.removeChild(state.group);

    var g = el('g', { class: 'caliper-layer' });
    var x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
    var w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);

    g.appendChild(el('rect', { x: x, y: y, width: w, height: h, class: 'caliper-box' }));
    g.appendChild(el('line', { x1: p0.x, y1: p0.y, x2: p0.x, y2: p1.y, class: 'caliper-edge' }));
    g.appendChild(el('line', { x1: p1.x, y1: p0.y, x2: p1.x, y2: p1.y, class: 'caliper-edge' }));

    var ms = Math.round((w / EKG.render.MM_PER_SEC) * 1000);
    var mv = (h / EKG.render.MM_PER_MV);
    var label = el('text', { x: x + w / 2, y: y - 1.5, class: 'caliper-label', 'text-anchor': 'middle' });
    label.textContent = ms + ' ms';
    g.appendChild(label);

    state.svg.appendChild(g);
    state.group = g;

    if (state.readout) {
      var bpm = ms > 0 ? Math.round(60000 / ms) : 0;
      state.readout.innerHTML =
        '<strong>' + ms + ' ms</strong> horizontally (' + (w / 5).toFixed(1) + ' large squares)' +
        ' &nbsp;·&nbsp; <strong>' + h.toFixed(1) + ' mm</strong> vertically (' + mv.toFixed(2) + ' mV)' +
        (ms > 150 ? ' &nbsp;·&nbsp; an R-R of this length is <strong>' + bpm + ' bpm</strong>' : '');
    }
  }

  function onDown(e) {
    if (!state.active) return;
    e.preventDefault();
    state.drag = toSvgPoint(state.svg, e);
    state.svg.setPointerCapture && state.svg.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!state.active || !state.drag) return;
    draw(state.drag, toSvgPoint(state.svg, e));
  }

  function onUp() { state.drag = null; }

  function attach(svg, readout) {
    state.svg = svg;
    state.readout = readout;
    if (!svg) return;
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointerleave', onUp);
  }

  function setActive(on) {
    state.active = on;
    if (state.svg) state.svg.classList.toggle('caliper-active', on);
    if (!on) clear();
    else if (state.readout) state.readout.textContent = 'Drag across the tracing to measure.';
  }

  EKG.calipers = { attach: attach, setActive: setActive, clear: clear };
})(window.EKG);
