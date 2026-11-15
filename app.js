(function () {
'use strict';
var TMC = window.TMC, analyze = TMC.analyze, binStart = TMC.binStart, BIN = TMC.BIN;

/* ---------- helpers ---------- */
var LS_CUR = 'tmc.current.v1', LS_HIS = 'tmc.history.v1';
var APP_VERSION = '7 (15 Nov 2026)';
var $ = function (s, r) { return (r || document).querySelector(s); };
var uid = function () { return Math.random().toString(36).slice(2, 10); };
var pad = function (n) { return String(n).padStart(2, '0'); };
var hhmm = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
var ymd = function (t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var pct = function (x) { return x == null ? '–' : (x * 100).toFixed(1) + '%'; };

var DIRS = [
  { a: 0, n: 'N', f: 'North' }, { a: 45, n: 'NE', f: 'Northeast' }, { a: 90, n: 'E', f: 'East' }, { a: 135, n: 'SE', f: 'Southeast' },
  { a: 180, n: 'S', f: 'South' }, { a: 225, n: 'SW', f: 'Southwest' }, { a: 270, n: 'W', f: 'West' }, { a: 315, n: 'NW', f: 'Northwest' }
];
var DIR_ORDER = [0, 90, 180, 270, 45, 135, 225, 315];
var MAX_LEGS = 6;
function dirOf(a) { for (var i = 0; i < DIRS.length; i++) if (DIRS[i].a === a) return DIRS[i]; return DIRS[0]; }
function fixAngles(st) {   // older counts have no leg directions: assign them N, E, S, W, ...
  var used = {};
  st.legs.forEach(function (l) { if (!l.removed && typeof l.angle === 'number') used[l.angle] = 1; });
  st.legs.forEach(function (l) {
    if (typeof l.angle === 'number') return;
    var a = 0;
    for (var i = 0; i < DIR_ORDER.length; i++) if (!used[DIR_ORDER[i]]) { a = DIR_ORDER[i]; break; }
    l.angle = a; used[a] = 1;
  });
}
function newStudy(prev) {
  if (prev) fixAngles(prev);
  var base = prev
    ? prev.legs.filter(function (l) { return !l.removed; }).map(function (l) { return { name: l.name, angle: l.angle }; })
    : [{ name: 'North', angle: 0 }, { name: 'East', angle: 90 }, { name: 'South', angle: 180 }, { name: 'West', angle: 270 }];
  return {
    id: uid(), site: prev ? prev.site : '', observer: prev ? prev.observer : '',
    created: Date.now(), startedAt: null, endedAt: null,
    legs: base.map(function (l) { return { id: uid(), name: l.name, angle: l.angle, removed: false }; }),
    events: [], notes: []
  };
}
function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v || def; } catch (e) { return def; } }
function persist() { try { localStorage.setItem(LS_CUR, JSON.stringify(S)); } catch (e) {} }
function persistHist() { try { localStorage.setItem(LS_HIS, JSON.stringify(H)); } catch (e) {} }

var S = load(LS_CUR, null) || newStudy();
var H = load(LS_HIS, []);
var mode = 'veh';          // 'veh' | 'p' (only used by the compact layout)
var cls = 'car';           // car | truck (trucks and buses) | bike
var clsLocked = false, lastClsTap = 0;
var viewBin = null;        // null = live interval; otherwise start (ms) of an earlier interval being edited
var rmMode = false, lastAct = 0;
var IDLE_PAST = 60000, IDLE_RM = 20000;
var alignStart = true;
var view = S.startedAt ? (S.endedAt ? 'results' : 'count') : 'setup';

var app = $('#app');
var activeLegs = function () { return S.legs.filter(function (l) { return !l.removed; }); };
var legNameOf = function (st, id) { var l = st.legs.find(function (x) { return x.id === id; }); return l ? l.name : '?'; };
var nextMark = function () { var n = Date.now(), b = binStart(n); return b === n ? n : b + BIN; };

function toast(msg) {
  var t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
}

/* ---------- audio feedback ---------- */
var SOUND_KEY = 'tmc.sound';
var soundOn = (function () { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { return true; } })();
var actx = null;
function audio() {
  try {
    if (!actx) { var C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
    if (actx && actx.state === 'suspended') actx.resume();
  } catch (e) {}
  return actx;
}
function beep(freq, dur, type, vol, delay) {
  var a = audio(); if (!a) return;
  try {
    var t0 = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) {}
}
// Each class has its own sound so a wrong-class tap can be caught by ear.
function sound(kind) {
  if (!soundOn) return;
  switch (kind) {
    case 'car': beep(740, 0.08); break;
    case 'truck': beep(420, 0.16, 'triangle', 0.4); break;
    case 'bus': beep(420, 0.07, 'triangle', 0.4); beep(420, 0.07, 'triangle', 0.4, 0.11); break;
    case 'bike': beep(1180, 0.06); break;
    case 'ped': beep(900, 0.05); beep(1250, 0.05, 'sine', 0.3, 0.07); break;
    case 'undo': beep(520, 0.07, 'sawtooth', 0.15); beep(300, 0.12, 'sawtooth', 0.15, 0.08); break;
  }
}

/* keep the screen awake while counting */
var wl = null;
function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wl && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(function (l) { wl = l; l.addEventListener('release', function () { wl = null; }); }).catch(function () {});
    }
  } catch (e) {}
}
function releaseAwake() { try { if (wl) { wl.release(); wl = null; } } catch (e) {} }
document.addEventListener('visibilitychange', function () { if (view === 'count') keepAwake(); });

/* ---------- intersection drawing ---------- */
var uv = function (a) { var r = a * Math.PI / 180; return { x: Math.sin(r), y: -Math.cos(r) }; };  // outward direction of a leg (compass angle, clockwise from screen-up)
var f1 = function (n) { return Math.round(n * 10) / 10; };
var shortTxt = function (t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
var sortedLegs = function () { return activeLegs().slice().sort(function (a, b) { return a.angle - b.angle; }); };
var turnOf = function (a, b) { return ((b - a - 180) % 360 + 540) % 360 - 180; };   // + right, - left, 0 straight (for a driver arriving on leg a, leaving on leg b)
function cwR(L, legs) {   // distance of a leg's crosswalk from the centre; diagonal legs next to a cardinal leg sit further out so buttons don't collide
  if (L.angle % 90 === 0) return 172;
  var near = legs.some(function (g) { var dd = Math.abs(g.angle - L.angle); dd = Math.min(dd, 360 - dd); return g.id !== L.id && dd === 45; });
  return near ? 325 : 172;
}
function walkDir(from, to) {   // compass direction a pedestrian walks when crossing leg `from` toward neighbouring leg `to`
  var legs = sortedLegs(), i = legs.findIndex(function (l) { return l.id === from; });
  if (i < 0) return '';
  var n = legs.length, th = legs[i].angle;
  if (legs[(i + 1) % n].id === to) return dirOf((th + 90) % 360).f;
  if (legs[(i - 1 + n) % n].id === to) return dirOf((th + 270) % 360).f;
  return '';
}
function turnLabel(t) {
  var a = Math.abs(t), sd = t < 0 ? 'L' : 'R';
  if (a < 23) return 'THRU';
  if (a < 68) return 'BEAR ' + sd;
  if (a < 113) return t < 0 ? 'LEFT' : 'RIGHT';
  return 'SHARP ' + sd;
}
function svgWrap(inner) { return '<svg class="isec" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>'; }

function layoutOf(legs) {   // lane layout for up to 4 legs on N/E/S/W; anything else uses the compact layout
  return legs.length <= 4 && legs.every(function (l) { return l.angle % 90 === 0; }) ? 'panel' : 'compact';
}
function roadsInner(legs, small, rw) {
  rw = rw || 110;
  var o = '', i, panel = rw > 110;
  legs.forEach(function (L) { o += '<g transform="translate(500 500) rotate(' + L.angle + ')"><rect class="rd" x="' + (-rw) + '" y="-720" width="' + (2 * rw) + '" height="720"/></g>'; });
  o += '<circle class="rd" cx="500" cy="500" r="' + rw + '"/>';
  legs.forEach(function (L) {
    o += '<g transform="translate(500 500) rotate(' + L.angle + ')"><line class="cl" x1="0" y1="' + (-(rw + 18)) + '" x2="0" y2="-720"/>';
    if (!panel) {
      var cw = cwR(L, legs);
      for (i = -4; i <= 4; i++) o += '<rect class="zb" x="' + (i * 24 - 7) + '" y="' + (-(cw + 15)) + '" width="14" height="30"/>';
    }
    o += '</g>';
  });
  legs.forEach(function (L) {   // name tag at the end of each leg
    var d = uv(L.angle), out = { x: -d.y, y: d.x }, fs = small ? 44 : 28, nm = shortTxt(L.name, 14), lines = null;
    var w = Math.min(nm.length * fs * 0.58 + 30, 340), h = fs + 16, x0, y0;
    if (small) { x0 = 500 + d.x * 410 - w / 2; y0 = 500 + d.y * 410 - h / 2; }
    else if (panel) {   // in the grass beside the end of the road (driver's left), clear of every button
      var maxw = 316, lat = rw + 14, cpw = 0.58;
      fs = 34; nm = shortTxt(L.name, 60);
      if (nm.length * fs * cpw + 30 <= maxw) lines = [nm];
      else {   // two lines at a readable size
        var ws = nm.split(' '), best = null, bi;
        for (bi = 1; bi < ws.length; bi++) { var l1 = ws.slice(0, bi).join(' '), l2 = ws.slice(bi).join(' '), mx = Math.max(l1.length, l2.length); if (!best || mx < best.mx) best = { a: l1, b: l2, mx: mx }; }
        if (!best) best = { a: nm.slice(0, Math.ceil(nm.length / 2)), b: nm.slice(Math.ceil(nm.length / 2)), mx: Math.ceil(nm.length / 2) };
        fs = Math.max(22, Math.min(30, Math.floor((maxw - 30) / (best.mx * cpw))));
        var cap = Math.floor((maxw - 30) / (fs * cpw));
        lines = [shortTxt(best.a, cap), shortTxt(best.b, cap)];
      }
      var ml = 0; lines.forEach(function (q) { ml = Math.max(ml, q.length); });
      w = Math.min(ml * fs * cpw + 30, maxw); h = lines.length * fs * 1.12 + 16;
      var sd = { x: -d.y, y: d.x };   // side of the road the name sits on
      var cx = 500 + d.x * (496 - w / 2) + sd.x * (lat + w / 2) * Math.abs(sd.x), cy = 500 + d.y * (496 - h / 2) + sd.y * (lat + h / 2) * Math.abs(sd.y);
      if (Math.abs(d.y) > 0.5) cx = 500 + sd.x * (lat + w / 2); else cy = 500 + sd.y * (lat + h / 2);
      x0 = cx - w / 2; y0 = cy - h / 2;
    }
    else {
      var px = 500 + d.x * 452 + out.x * 56, py = 500 + d.y * 452 + out.y * 56;
      x0 = Math.abs(d.x) < 0.2 ? (out.x > 0 ? 506 : 494 - w) : px - w / 2;
      y0 = py - h / 2;
    }
    x0 = Math.max(4, Math.min(996 - w, x0)); y0 = Math.max(4, Math.min(996 - h, y0));
    o += '<rect class="rlp" x="' + f1(x0) + '" y="' + f1(y0) + '" width="' + f1(w) + '" height="' + f1(h) + '" rx="' + f1(h / 2) + '"/>' +
      (lines || [nm]).map(function (q, qi, arr) { return '<text class="rlt" x="' + f1(x0 + w / 2) + '" y="' + f1(y0 + h / 2 + fs * 0.35 + (qi - (arr.length - 1) / 2) * fs * 1.12) + '" style="font-size:' + fs + 'px">' + esc(q) + '</text>'; }).join('');
  });
  return o;
}
function roadsSVG(legs) { return svgWrap(roadsInner(legs, true, layoutOf(legs) === 'panel' ? 160 : 110)); }

/* ---------- leg editor (used in setup + sheet) ---------- */
function legEditor(box) {
  fixAngles(S);
  function drawPreview() { var pv = box.querySelector('.pv'); if (pv) pv.innerHTML = roadsSVG(sortedLegs()); }
  function draw() {
    var legs = sortedLegs();
    box.innerHTML = '<div class="pv"></div>' + legs.map(function (l) {
      return '<div class="legrow" data-id="' + l.id + '"><input class="ln" value="' + esc(l.name) + '" aria-label="Leg name">' +
        '<select class="la" aria-label="Direction this leg points">' + DIRS.map(function (d) { return '<option value="' + d.a + '"' + (d.a === l.angle ? ' selected' : '') + '>' + d.n + '</option>'; }).join('') + '</select>' +
        '<button data-a="del" class="del"' + (legs.length <= 3 ? ' disabled' : '') + '>✕</button></div>';
    }).join('') +
      '<button data-a="add" class="ghost add"' + (legs.length >= MAX_LEGS ? ' disabled' : '') + '>+ Add leg</button>' +
      '<p class="hint">Choose the direction each leg points on the diagram (N = top of the screen). Up to 4 legs pointing N, E, S or W get the lane layout; 5 or more legs, or diagonal legs, use a compact layout. 3 to ' + MAX_LEGS + ' legs.</p>';
    drawPreview();
  }
  box.addEventListener('input', function (e) {
    if (!e.target.classList.contains('ln')) return;
    var id = e.target.closest('.legrow').dataset.id, l = S.legs.find(function (x) { return x.id === id; });
    if (l) { l.name = e.target.value; persist(); drawPreview(); }
  });
  box.addEventListener('change', function (e) {
    if (!e.target.classList.contains('la')) return;
    var id = e.target.closest('.legrow').dataset.id, l = S.legs.find(function (x) { return x.id === id; }), a = +e.target.value;
    if (!l) return;
    if (activeLegs().some(function (x) { return x.id !== id && x.angle === a; })) { toast('Another leg already points ' + dirOf(a).n); e.target.value = l.angle; return; }
    l.angle = a; persist(); draw();
  });
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b || b.disabled) return;
    if (b.dataset.a === 'add') {
      var used = {}; activeLegs().forEach(function (x) { used[x.angle] = 1; });
      var a = DIR_ORDER.find(function (x) { return !used[x]; }); if (a == null) return;
      var nm = dirOf(a).f, taken = activeLegs().map(function (x) { return x.name; });
      while (taken.indexOf(nm) >= 0) nm += ' 2';
      S.legs.push({ id: uid(), name: nm, angle: a, removed: false });
    } else {
      var id = b.closest('.legrow').dataset.id, idx = S.legs.findIndex(function (x) { return x.id === id; });
      if (idx < 0) return;
      var usedEv = S.events.some(function (ev) { return ev.from === id || ev.to === id; });
      if (usedEv && !confirm('"' + S.legs[idx].name + '" has recorded counts. They are kept in the data and exports, but the leg disappears from the count screen. Remove it?')) return;
      if (usedEv) S.legs[idx].removed = true; else S.legs.splice(idx, 1);
    }
    persist(); draw();
  });
  draw();
}

/* ---------- sheets ---------- */
function closeSheet() { var s = $('#sheet'); if (s) s.remove(); }
function openSheet(title, html, mount) {
  closeSheet();
  var s = document.createElement('div'); s.id = 'sheet';
  s.innerHTML = '<div class="sheet"><div class="sh"><b>' + esc(title) + '</b><button id="shclose" class="hb dark">Done</button></div><div class="sb">' + html + '</div></div>';
  document.body.appendChild(s);
  s.addEventListener('click', function (e) { if (e.target === s || e.target.id === 'shclose') { closeSheet(); render(); } });
  if (mount) mount($('.sb', s), s);
}

/* ---------- rendering ---------- */
function fit() {
  try { document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px'); } catch (e) {}
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', function () { fit(); setTimeout(fit, 300); });
document.addEventListener('touchmove', function (e) { if (view === 'count' && !e.target.closest('#sheet')) e.preventDefault(); }, { passive: false });
function render() {
  fit();
  document.documentElement.classList[view === 'count' ? 'add' : 'remove']('cvmode');
  if (view === 'setup') renderSetup();
  else if (view === 'count') renderCount();
  else renderResults();
  window.scrollTo(0, 0);
}

function renderSetup() {
  app.innerHTML =
    '<div class="page"><h1>New traffic count</h1>' +
    '<div class="card"><label>Site / intersection<input id="site" type="text" value="' + esc(S.site) + '" placeholder="e.g. Bank St @ Gladstone Ave"></label>' +
    '<label>Observer<input id="obs" type="text" value="' + esc(S.observer) + '" placeholder="Your name"></label></div>' +
    '<div class="card"><h2>Legs</h2><div id="legs"></div></div>' +
    '<div class="card"><label class="chk"><input type="checkbox" id="align"' + (alignStart ? ' checked' : '') + '> Start at the next 15-minute mark</label><div class="hint" id="alignhint"></div></div>' +
    '<button class="big go" id="start">Start count</button>' +
    '<div class="row"><button class="ghost" id="hist">Past counts (' + H.length + ')</button></div>' +
    '<p class="foot">Works offline. Counts are saved on this iPad as you tap — export the CSV files after each count.<br>To install: Safari → Share → Add to Home Screen.<br>App version ' + APP_VERSION + '</p></div>';
  legEditor($('#legs'));
  $('#site').addEventListener('input', function (e) { S.site = e.target.value; persist(); });
  $('#obs').addEventListener('input', function (e) { S.observer = e.target.value; persist(); });
  $('#align').addEventListener('change', function (e) { alignStart = e.target.checked; tick(); });
  tick();
}

function arrowIcon(h, dt) {   // bent arrow: arrives heading h, leaves heading dt
  var L = 13, oy = -6, p0 = { x: -h.x * L, y: oy - h.y * L }, p2 = { x: dt.x * L, y: oy + dt.y * L };
  var tip = { x: p2.x + dt.x * 5, y: p2.y + dt.y * 5 }, bx = tip.x - dt.x * 10, by = tip.y - dt.y * 10, qx = -dt.y * 7, qy = dt.x * 7;
  return '<polyline class="ic" points="' + f1(p0.x) + ',' + f1(p0.y) + ' 0,' + oy + ' ' + f1(p2.x) + ',' + f1(p2.y) + '"/>' +
    '<polygon class="ich" points="' + f1(tip.x) + ',' + f1(tip.y) + ' ' + f1(bx + qx) + ',' + f1(by + qy) + ' ' + f1(bx - qx) + ',' + f1(by - qy) + '"/>';
}
function uIcon(h) {
  var a = Math.atan2(-h.x, h.y) * 180 / Math.PI;
  return '<g transform="translate(0 -6) rotate(' + f1(a) + ')"><path class="ic" d="M-9,-14 L-9,2 A9,9 0 0 0 9,2 L9,-6"/><polygon class="ich" points="9,-16 3,-6 15,-6"/></g>';
}
function badgeG(k, from, to, cx, cy) {   // small purple bubble: bicycles that made this movement in the current interval
  return k === 'v' ? '<g class="bk" data-bk="b|' + from + '|' + to + '" visibility="hidden"><circle cx="' + cx + '" cy="' + cy + '" r="15"/><text x="' + cx + '" y="' + (cy + 6) + '">0</text></g>' : '';
}
function mvG(k, from, to, label, icon, x, y, f, extra) {
  return '<g class="mv' + (extra || '') + '" data-k="' + k + '" data-from="' + from + '" data-to="' + to + '" transform="translate(' + f1(x) + ' ' + f1(y) + ') scale(' + (Math.round(f * 1000) / 1000) + ')">' +
    '<rect class="bg" x="-44" y="-44" width="88" height="88" rx="16"/>' +
    '<rect class="flash" x="-44" y="-44" width="88" height="88" rx="16"/>' +
    '<rect class="rg0" x="-46" y="-46" width="92" height="92" rx="18"/><rect class="rg1" x="-46" y="-46" width="92" height="92" rx="18"/>' +
    '<text class="lb" x="0" y="-27"' + (label.length > 7 ? ' style="font-size:' + Math.max(9, Math.floor(115 / label.length)) + 'px"' : '') + '>' + esc(label) + '</text>' + icon +
    '<text class="n" x="0" y="38" data-key="' + k + '|' + from + '|' + to + '">0</text>' + badgeG(k, from, to, 38, -38) + '</g>';
}
function flatG(k, from, to, icon, x, y, w, h, extra, vert) {   // flat button: icon then count (side by side, or stacked when vert)
  var hw = w / 2, hh = h / 2;
  return '<g class="mv' + (extra || '') + '" data-k="' + k + '" data-from="' + from + '" data-to="' + to + '" transform="translate(' + f1(x) + ' ' + f1(y) + ')">' +
    '<rect class="bg" x="' + (-hw) + '" y="' + (-hh) + '" width="' + w + '" height="' + h + '" rx="14"/>' +
    '<rect class="flash" x="' + (-hw) + '" y="' + (-hh) + '" width="' + w + '" height="' + h + '" rx="14"/>' +
    '<rect class="rg0" x="' + (-hw - 2) + '" y="' + (-hh - 2) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" rx="16"/><rect class="rg1" x="' + (-hw - 2) + '" y="' + (-hh - 2) + '" width="' + (w + 4) + '" height="' + (h + 4) + '" rx="16"/>' +
    '<g transform="' + (vert ? 'translate(0 ' + f1(-h * 0.2 + 6) + ')' : 'translate(' + f1(-w * 0.2) + ' 6)') + ' scale(1.2)">' + icon + '</g>' +
    '<text class="n" x="' + (vert ? 0 : f1(w * 0.22)) + '" y="' + (vert ? f1(h * 0.22 + 11) : 11) + '" data-key="' + k + '|' + from + '|' + to + '">0</text>' + badgeG(k, from, to, hw - 4, -hh + 2) + '</g>';
}
var COMPASS = '<g transform="translate(62 62)"><circle r="34" class="cmp"/><polygon class="cmpn" points="0,-24 9,10 0,4 -9,10"/><text class="cmpt" y="-38">N</text></g>';

/* compact layout: used for 5+ legs or diagonal legs (buttons stacked along each leg, crosswalks behind a toggle) */
function countSVG(legs, md) {
  var n = legs.length, o = roadsInner(legs, false), k = 'v';
  if (md === 'p') {
    legs.forEach(function (L, i) {
      var th = L.angle * Math.PI / 180, d = uv(L.angle), t = { x: Math.cos(th), y: Math.sin(th) };   // t = clockwise walking direction
      var sep = 47 / Math.max(Math.abs(t.x), Math.abs(t.y)), rc = cwR(L, legs);
      [[legs[(i - 1 + n) % n], -1], [legs[(i + 1) % n], 1]].forEach(function (pr) {
        var dt = { x: t.x * pr[1], y: t.y * pr[1] };
        o += mvG('p', L.id, pr[0].id, dirOf((L.angle + (pr[1] > 0 ? 90 : 270)) % 360).f.toUpperCase(), arrowIcon(dt, dt), 500 + d.x * rc + dt.x * sep, 500 + d.y * rc + dt.y * sep, 1, ' pd');
      });
    });
  } else {
    legs.forEach(function (L) {
      var d = uv(L.angle), right = { x: d.y, y: -d.x }, hd = { x: -d.x, y: -d.y };
      var ex = legs.filter(function (g) { return g.id !== L.id; })
        .map(function (D) { return { leg: D, turn: turnOf(L.angle, D.angle), u: false }; })
        .sort(function (a, b) { return a.turn - b.turn; });
      ex.push({ leg: L, turn: 180, u: true });
      var cnt = ex.length, bs = Math.min(88, Math.floor(380 / cnt) - 6), f = bs / 88;
      var m = Math.max(Math.abs(d.x), Math.abs(d.y)), step = (bs + 6) / m, r0 = 122 + (bs / 2 + 2) / m, lat = bs / 2 + 6;
      ex.forEach(function (x, i) {
        var r = r0 + i * step, cx = 500 + d.x * r + right.x * lat, cy = 500 + d.y * r + right.y * lat;
        o += mvG(k, L.id, x.leg.id, x.u ? 'U-TURN' : turnLabel(x.turn), x.u ? uIcon(hd) : arrowIcon(hd, uv(x.leg.angle)), cx, cy, f, x.u ? ' u' : '');
      });
    });
  }
  return svgWrap(o + COMPASS);
}

/* lane layout: each leg shows crosswalk buttons, then Right | Thru | Left across the road as the driver sees it from above, then U-turn */
function panelSVG(legs) {
  var o = roadsInner(legs, false, 160), n = legs.length;
  legs.forEach(function (L, i) {
    var d = uv(L.angle), right = { x: d.y, y: -d.x }, hd = { x: -d.x, y: -d.y };
    var th = L.angle * Math.PI / 180, t = { x: Math.cos(th), y: Math.sin(th) }, vert = Math.abs(d.x) > 0.5;   // t = clockwise walking direction; vert = east/west leg
    var at = function (r, lam, vec) { return { x: 500 + d.x * r + vec.x * lam, y: 500 + d.y * r + vec.y * lam }; };
    [[legs[(i - 1 + n) % n], -1], [legs[(i + 1) % n], 1]].forEach(function (pr) {   // crosswalk: one button per walking direction
      var dt = { x: t.x * pr[1], y: t.y * pr[1] }, p = at(202, pr[1] * 78, t);
      o += flatG('p', L.id, pr[0].id, arrowIcon(dt, dt), p.x, p.y, vert ? 66 : 150, vert ? 150 : 66, ' pd', vert);
    });
    legs.forEach(function (D) {
      if (D.id === L.id) return;
      var tn = turnOf(L.angle, D.angle), lam = tn < 0 ? -104 : tn > 0 ? 104 : 0, p = at(287, lam, right);   // + lam = driver's right
      o += mvG('v', L.id, D.id, turnLabel(tn), arrowIcon(hd, uv(D.angle)), p.x, p.y, 1.06, '');
    });
    var pu = at(368, -96, right);
    o += flatG('v', L.id, L.id, uIcon(hd), pu.x, pu.y, vert ? 56 : 128, vert ? 128 : 56, ' u', vert);
  });
  return svgWrap(o + COMPASS);
}

/* class selector: Truck/Bus and Bike count once, then fall back to Car; double-tap keeps one selected */
var CLS_LABEL = { car: 'Car', truck: 'Truck/Bus', bike: 'Bike' };
function clsColour() { return cls === 'truck' ? 'var(--truck)' : cls === 'bike' ? 'var(--bike)' : 'var(--car)'; }
function clsBtnsHTML() {
  return ['car', 'truck', 'bike'].map(function (c) {
    return '<button data-cls="' + c + '"' + (cls === c ? ' class="on"' : '') + '>' + CLS_LABEL[c] + (cls === c && clsLocked ? ' 🔒' : '') + '</button>';
  }).join('');
}
function applyCls() {
  var nav = $('.classes'); if (nav) nav.innerHTML = clsBtnsHTML();
  var st = $('.stage'); if (st) st.style.setProperty('--c', clsColour());
}
function clsTap(c) {
  var now = Date.now();
  if (c === 'car') { cls = 'car'; clsLocked = false; }
  else if (cls === c && !clsLocked && now - lastClsTap < 500) { clsLocked = true; toast(CLS_LABEL[c] + ' stays selected — tap Car to switch back'); }
  else { cls = c; clsLocked = false; }
  lastClsTap = now; applyCls();
}

function renderCount() {
  fixAngles(S);
  var legs = sortedLegs(), panel = layoutOf(legs) === 'panel';
  if (panel) mode = 'veh';
  app.innerHTML =
    '<div class="cv"><header class="top"><div class="ti"><div class="site">' + esc(S.site || 'Untitled count') + '</div>' +
    '<div class="sub"><span id="clock"></span></div></div><div class="ivn"><button id="ivprev" class="hb sm">◀</button><b id="binlabel"></b><button id="ivnext" class="hb sm">▶</button><button id="ivlive" class="hb sm live">Live</button></div>' +
    '<div class="tot"><span class="pill veh">Veh<b id="tv">0</b></span><span class="pill bike">Bike<b id="tb">0</b></span><span class="pill ped">Ped<b id="tp">0</b></span></div>' +
    '<div class="acts"><button id="notesbtn" class="hb">Notes</button><button id="legsbtn" class="hb">Legs</button><button id="resbtn" class="hb">Results</button><button id="snd" class="hb">' + (soundOn ? '🔊' : '🔇') + '</button><button id="stop" class="hb stop">Stop</button></div>' +
    '<div id="last" class="last"><div id="lasttxt" class="lt"></div><button id="undo" class="hb">↶ Undo</button><button id="recent" class="hb">Recent</button></div></header>' +
    '<div class="cmain"><aside class="ctl">' +
    (panel ? '' : '<nav class="modes">' + [['veh', 'Vehicles'], ['p', 'Pedestrians']].map(function (m) { return '<button data-mode="' + m[0] + '"' + (mode === m[0] ? ' class="on"' : '') + '>' + m[1] + '</button>'; }).join('') + '</nav>') +
    (panel || mode === 'veh' ? '<nav class="classes">' + clsBtnsHTML() + '</nav><p class="clshint">Truck/Bus and Bike count once, then go back to Car. Double-tap to keep one selected.</p>' : '') +
    '<nav class="rmrow"><button id="rmbtn">− Remove counts</button></nav></aside><div class="stage' + (!panel && mode === 'p' ? ' pedmode' : '') + '" style="--c:' + clsColour() + '">' + '<div id="banner"></div>' + (panel ? panelSVG(legs) : countSVG(legs, mode)) + '</div></div></div>';
  keepAwake();
  tick();
}

/* live counts for the current interval */
function curBin() { return viewBin == null ? binStart(Date.now()) : viewBin; }
function binCounts() {
  var bs = curBin(), be = bs + BIN, m = {}, tot = { v: 0, b: 0, p: 0 };
  for (var i = S.events.length - 1; i >= 0; i--) {
    var e = S.events[i]; if (e.t < bs || e.t >= be) continue;
    var key = e.k + '|' + e.from + '|' + e.to;
    m[key] = (m[key] || 0) + 1; tot[e.k]++;
  }
  return { m: m, tot: tot, bs: bs };
}
function tick() {
  var now = Date.now(), ah = $('#alignhint');
  if (ah) ah.textContent = alignStart ? 'Counting will begin at ' + hhmm(nextMark()) + '. Tapping Start before then is fine.' : 'Counting begins the moment you tap Start (the first interval may be partial).';
  if (view !== 'count') return;
  if (viewBin != null && (viewBin >= binStart(now) || now - lastAct > IDLE_PAST)) { viewBin = null; rmMode = false; }
  if (rmMode && now - lastAct > IDLE_RM) rmMode = false;
  var c = binCounts();
  app.querySelectorAll('.n').forEach(function (el) { el.textContent = c.m[el.dataset.key] || 0; });
  app.querySelectorAll('.bk').forEach(function (g) { var nb = c.m[g.dataset.bk] || 0; g.setAttribute('visibility', nb ? 'visible' : 'hidden'); g.querySelector('text').textContent = nb; });
  var d = new Date(now);
  $('#clock').textContent = hhmm(now) + ':' + pad(d.getSeconds());
  $('#binlabel').textContent = hhmm(c.bs) + '–' + hhmm(c.bs + BIN);
  $('#tv').textContent = c.tot.v; $('#tb').textContent = c.tot.b; $('#tp').textContent = c.tot.p;
  var left = S.startedAt - now;
  var msg = '';
  if (left > 0) msg = 'Count starts at ' + hhmm(S.startedAt) + ' — in ' + Math.floor(left / 60000) + ':' + pad(Math.floor(left / 1000) % 60);
  else if (rmMode) msg = 'REMOVE MODE — tap a button to take one count out of ' + hhmm(c.bs) + '–' + hhmm(c.bs + BIN);
  else if (viewBin != null) msg = 'Editing an earlier interval (' + hhmm(c.bs) + '–' + hhmm(c.bs + BIN) + ') — taps are added to it. Back to live in ' + Math.max(0, Math.ceil((IDLE_PAST - (now - lastAct)) / 1000)) + ' s';
  var bn = $('#banner'); bn.textContent = msg; bn.className = rmMode ? 'rmb' : '';
  var stg = $('.stage'); if (stg) { stg.classList[viewBin != null ? 'add' : 'remove']('past'); stg.classList[rmMode ? 'add' : 'remove']('rm'); }
  var rb = $('#rmbtn'); if (rb) { rb.classList[rmMode ? 'add' : 'remove']('on'); rb.textContent = rmMode ? 'Done removing' : '− Remove counts'; }
  $('#ivprev').disabled = c.bs <= binStart(S.startedAt);
  $('#ivnext').disabled = viewBin == null;
  $('#ivlive').style.visibility = viewBin == null ? 'hidden' : 'visible';
  $('#undo').disabled = !S.events.length;
  updateLast(false);
}
setInterval(tick, 1000);

var hms = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
function kindLabel(e) { return e.k === 'v' ? (e.c === 'car' ? 'Car' : 'Truck/Bus') : e.k === 'b' ? 'Bike' : 'Pedestrian'; }
function chipCls(e) { return e.k === 'v' ? (e.c === 'car' ? 'car' : 'truck') : e.k === 'b' ? 'bike' : 'ped'; }
function routeLabel(st, e) {
  if (e.k === 'p') return 'Crossing ' + legNameOf(st, e.from) + ' → toward ' + legNameOf(st, e.to);
  return e.from === e.to ? legNameOf(st, e.from) + ' U-turn' : 'From ' + legNameOf(st, e.from) + ' → ' + legNameOf(st, e.to);
}
function describe(st, e) { return hhmm(e.t) + ' ' + kindLabel(e) + ' · ' + routeLabel(st, e); }

/* "last counted" bar */
function updateLast(pulse) {
  var el = $('#last'); if (!el) return;
  var e = S.events[S.events.length - 1], box = $('#lasttxt');
  app.querySelectorAll('.mv.lastb').forEach(function (m) { m.classList.remove('lastb'); });
  if (e) { var lm = app.querySelector('.mv[data-k="' + (e.k === 'b' ? 'v' : e.k) + '"][data-from="' + e.from + '"][data-to="' + e.to + '"]'); if (lm) lm.classList.add('lastb'); }
  if (!e) { box.innerHTML = '<span class="mut">Nothing counted yet</span>'; return; }
  var ago = Math.max(0, Math.round((Date.now() - e.t) / 1000));
  var agoTxt = ago < 60 ? ago + ' s ago' : Math.floor(ago / 60) + ' min ago';
  box.innerHTML = '<span class="chip ' + chipCls(e) + '">' + esc(kindLabel(e)) + '</span>' + esc(routeLabel(S, e)) +
    ' <span class="mut">· ' + hms(e.t) + ' · ' + agoTxt + '</span>';
  if (pulse) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
}

/* recent counts: fix the class or remove a miscount, even a few minutes later */
function openRecent() {
  function list() {
    var n = S.events.length; if (!n) return '<p class="hint">Nothing counted yet.</p>';
    var out = [];
    for (var i = n - 1; i >= 0 && out.length < 25; i--) {
      var e = S.events[i];
      out.push('<div class="rrow" data-i="' + i + '"><div class="ri"><span class="chip ' + chipCls(e) + '">' + esc(kindLabel(e)) + '</span>' + esc(routeLabel(S, e)) + '<small>' + hms(e.t) + '</small></div>' +
        (e.k === 'v' ? '<div class="cs">' + ['car', 'truck'].map(function (c) { return '<button class="cb' + ((e.c === c || (c === 'truck' && e.c === 'bus')) ? ' on' : '') + '" data-a="cls" data-c="' + c + '">' + (c === 'car' ? 'Car' : 'Truck/Bus') + '</button>'; }).join('') + '</div>' : '') +
        '<button class="ghost del" data-a="del">✕</button></div>');
    }
    return '<p class="hint">Most recent first (last 25). Change the class or remove a miscount.</p>' + out.join('');
  }
  openSheet('Recent counts', '<div id="rl">' + list() + '</div>', function (box) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var i = +b.closest('.rrow').dataset.i, ev = S.events[i]; if (!ev) return;
      if (b.dataset.a === 'del') { S.events.splice(i, 1); sound('undo'); }
      else { ev.c = b.dataset.c; sound(ev.c); }
      persist(); $('#rl').innerHTML = list(); tick();
    });
  });
}

/* notes */
function notesCardHTML() {
  var ns = S.notes || [];
  return '<div class="card"><h2>Notes</h2>' + (ns.length ? ns.map(function (n) { return '<p class="nline"><small>' + hms(n.t) + '</small>' + esc(n.text) + '</p>'; }).join('') : '<p class="hint">No notes.</p>') + '</div>';
}
function openNotes() {
  function list() {
    var ns = S.notes || [];
    if (!ns.length) return '<p class="hint">No notes yet.</p>';
    return ns.map(function (n, i) {
      return '<div class="nrow" data-i="' + i + '"><div class="ni"><small>' + hms(n.t) + '</small>' + esc(n.text) + '</div><button class="ghost del" data-a="ndel">✕</button></div>';
    }).reverse().join('');
  }
  var chips = ['Rain', 'Snow', 'Construction', 'Collision', 'Signal issue', 'Event nearby'];
  openSheet('Notes', '<div class="chips">' + chips.map(function (c) { return '<button class="chipb" data-chip="' + c + '">' + c + '</button>'; }).join('') + '</div>' +
    '<textarea id="notetxt" rows="3" placeholder="Type a note — saved with the current time"></textarea>' +
    '<button class="big" id="noteadd">Add note</button><div id="nl">' + list() + '</div>', function (box) {
    var ta = $('#notetxt', box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.chip) { ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + '. ' : '') + b.dataset.chip; return; }
      if (b.id === 'noteadd') {
        var txt = ta.value.trim(); if (!txt) { toast('Type a note first'); return; }
        (S.notes = S.notes || []).push({ t: Date.now(), text: txt });
        persist(); ta.value = ''; $('#nl').innerHTML = list(); toast('Note added'); return;
      }
      if (b.dataset.a === 'ndel') { S.notes.splice(+b.closest('.nrow').dataset.i, 1); persist(); $('#nl').innerHTML = list(); }
    });
  });
}

function tap(btn) {
  if (!S.startedAt || S.endedAt) return;
  var now = Date.now();
  if (now < S.startedAt) { toast('Count has not started yet'); return; }
  if (rmMode) return removeOne(btn);
  lastAct = now;
  var past = viewBin != null && viewBin < binStart(now);
  var isVeh = btn.dataset.k === 'v';
  var ev = { t: past ? viewBin + BIN - 1 : now, k: isVeh && cls === 'bike' ? 'b' : btn.dataset.k, from: btn.dataset.from, to: btn.dataset.to };
  if (ev.k === 'v') ev.c = cls;
  S.events.push(ev); persist(); tick(); updateLast(true);
  sound(ev.k === 'v' ? ev.c : ev.k === 'b' ? 'bike' : 'ped');
  if (isVeh && !clsLocked && cls !== 'car') { cls = 'car'; applyCls(); }
  btn.classList.add('hit'); setTimeout(function () { btn.classList.remove('hit'); }, 110);
}
function ivNav(dir) {
  var first = binStart(S.startedAt), nb = curBin() + dir * BIN;
  if (nb < first) return;
  viewBin = nb >= binStart(Date.now()) ? null : nb;
  if (viewBin == null) rmMode = false;
  lastAct = Date.now(); tick();
}
function removeOne(btn) {
  var bs = curBin(), be = bs + BIN, k = btn.dataset.k, from = btn.dataset.from, to = btn.dataset.to;
  var kinds = k === 'p' ? ['p'] : cls === 'bike' ? ['b', 'v'] : ['v', 'b'];
  lastAct = Date.now();
  for (var j = 0; j < kinds.length; j++) {
    for (var i = S.events.length - 1; i >= 0; i--) {
      var e = S.events[i];
      if (e.k === kinds[j] && e.from === from && e.to === to && e.t >= bs && e.t < be) {
        S.events.splice(i, 1); persist(); tick(); updateLast(false); sound('undo'); toast('Removed: ' + describe(S, e)); return;
      }
    }
  }
  toast('Nothing to remove there in this interval');
}
function undo() {
  var e = S.events.pop();
  if (!e) { toast('Nothing to undo'); return; }
  persist(); tick(); sound('undo'); toast('Removed: ' + describe(S, e));
}

/* ---------- results ---------- */
function matrixHTML(A, st) {
  var pk = A.peak; if (!pk) return '';
  var used = {};
  Object.keys(pk.matrix).forEach(function (k) { var p = k.split('>'); used[p[0]] = 1; used[p[1]] = 1; });
  var legs = st.legs.filter(function (l) { return !l.removed || used[l.id]; });
  var nm = function (l) { return esc(l.name) + (l.removed ? ' (removed)' : ''); };
  var colTot = {}, grand = 0;
  var rows = legs.map(function (f) {
    var rt = 0;
    var cells = legs.map(function (t) {
      var m = pk.matrix[f.id + '>' + t.id];
      var v = m ? m.total : 0, h = m ? m.truck : 0;
      rt += v; colTot[t.id] = (colTot[t.id] || 0) + v;
      return '<td>' + (v || '') + (h ? '<small>' + h + ' heavy</small>' : '') + '</td>';
    }).join('');
    grand += rt;
    return '<tr><td>' + nm(f) + '</td>' + cells + '<td><b>' + rt + '</b></td></tr>';
  }).join('');
  return '<div class="card"><h2>Peak-hour movements (all vehicles)</h2><p class="hint">Rows = approach, columns = exit. Diagonal = U-turns.</p><div class="scroll"><table><thead><tr><th>From \\ To</th>' +
    legs.map(function (l) { return '<th>' + nm(l) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td>Exit total</td>' +
    legs.map(function (l) { return '<td>' + (colTot[l.id] || 0) + '</td>'; }).join('') + '<td>' + grand + '</td></tr></tfoot></table></div></div>';
}

function renderResults() {
  var A = analyze(S), pk = A.peak, running = !S.endedAt;
  var tot = A.bins.reduce(function (s, b) { s.car += b.car; s.truck += b.truck; s.veh += b.veh; s.bike += b.bike; s.ped += b.ped; return s; }, { car: 0, truck: 0, veh: 0, bike: 0, ped: 0 });
  var warns = [];
  if (running) warns.push('Count still in progress — the current interval is incomplete.');
  if (binStart(S.startedAt) !== S.startedAt) warns.push('Count started at ' + hhmm(S.startedAt) + ', so the first interval is partial.');
  if (S.endedAt && Math.abs(binStart(S.endedAt) - S.endedAt) > 5000 && Math.abs(binStart(S.endedAt) + BIN - S.endedAt) > 5000) warns.push('Count stopped at ' + hhmm(S.endedAt) + ', so the last interval is partial.');
  if (!pk) warns.push('Peak hour needs at least four 15-minute intervals (one full hour).');

  var peakKpis = pk ?
    '<div class="kpi"><small>Peak hour</small><b>' + hhmm(pk.start) + '–' + hhmm(pk.end) + '</b></div>' +
    '<div class="kpi"><small>Peak-hour vehicles</small><b>' + pk.vol + '</b></div>' +
    '<div class="kpi"><small>Peak hour factor</small><b>' + (pk.phf == null ? '–' : pk.phf.toFixed(2)) + '</b></div>' +
    '<div class="kpi"><small>Heavy vehicles</small><b>' + pct(pk.heavyPct) + '</b><small>' + pk.truck + ' trucks/buses</small></div>' +
    '<div class="kpi"><small>Bikes / peds in peak</small><b>' + pk.bike + ' / ' + pk.ped + '</b></div>' : '';

  var rows = A.bins.map(function (b, i) {
    var inPk = pk && i >= pk.i && i < pk.i + 4;
    return '<tr' + (inPk ? ' class="pk"' : '') + '><td>' + hhmm(b.start) + '–' + hhmm(b.start + BIN) + '</td><td>' + b.car + '</td><td>' + b.truck + '</td><td><b>' + b.veh + '</b></td><td>' + b.bike + '</td><td>' + b.ped + '</td></tr>';
  }).join('');

  app.innerHTML =
    '<div class="page"><h1>' + esc(S.site || 'Untitled count') + '</h1>' +
    '<p class="hint">' + ymd(S.startedAt) + (S.observer ? ' · ' + esc(S.observer) : '') + '</p>' +
    warns.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') +
    '<div class="kpis">' + peakKpis + '</div>' +
    '<div class="card"><h2>15-minute intervals</h2><p class="hint">Highlighted rows are the peak hour.</p><div class="scroll"><table><thead><tr><th>Interval</th><th>Car</th><th>Truck/Bus</th><th>Vehicles</th><th>Bike</th><th>Ped</th></tr></thead><tbody>' + rows +
    '</tbody><tfoot><tr><td>Total</td><td>' + tot.car + '</td><td>' + tot.truck + '</td><td>' + tot.veh + '</td><td>' + tot.bike + '</td><td>' + tot.ped + '</td></tr></tfoot></table></div></div>' +
    matrixHTML(A, S) +
    notesCardHTML() +
    '<div class="row"><button class="ghost" id="exp1">Export intervals CSV</button><button class="ghost" id="exp2">Export movements CSV</button></div>' +
    '<div class="row">' + (running ? '<button class="ghost" id="back">← Back to counting</button>' : '<button class="ghost" id="resume">Resume count</button>') +
    '<button class="ghost" id="notesres">Notes</button><button class="ghost" id="newcount">New count</button><button class="ghost" id="hist">Past counts (' + H.length + ')</button></div></div>';
}

/* ---------- export ---------- */
function csv(rows) {
  return rows.map(function (r) {
    return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
  }).join('\r\n');
}
function fileBase() { return (S.site || 'count').replace(/[^\w\-]+/g, '_').slice(0, 40) + '_' + ymd(S.startedAt); }
function share(name, text) {
  var blob = new Blob([text], { type: 'text/csv' });
  try {
    var file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(function () {}); return; }
  } catch (e) {}
  var a = document.createElement('a');
  if (!('download' in a)) { window.open('data:text/csv;charset=utf-8,' + encodeURIComponent(text), '_blank'); return; }
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
}
function exportIntervals() {
  var A = analyze(S), pk = A.peak;
  var rows = [['Site', 'Date', 'Observer', 'Interval start', 'Interval end', 'Cars', 'Trucks/Buses', 'Vehicles total', 'Bicycles', 'Pedestrians', 'In peak hour']];
  A.bins.forEach(function (b, i) {
    rows.push([S.site, ymd(b.start), S.observer, hhmm(b.start), hhmm(b.start + BIN), b.car, b.truck, b.veh, b.bike, b.ped, pk && i >= pk.i && i < pk.i + 4 ? 'Y' : '']);
  });
  rows.push([]);
  if (pk) {
    rows.push(['Peak hour (all vehicles)', hhmm(pk.start) + '-' + hhmm(pk.end)]);
    rows.push(['Peak hour volume', pk.vol]);
    rows.push(['Peak hour factor', pk.phf == null ? '' : pk.phf.toFixed(3)]);
    rows.push(['Heavy vehicle share', pk.heavyPct == null ? '' : (pk.heavyPct * 100).toFixed(1) + '%']);
  } else rows.push(['Peak hour', 'n/a (fewer than 4 intervals)']);
  rows.push([]); rows.push(['Legs (direction as drawn, N = top)'].concat(sortedLegs().map(function (l) { return l.name + ' (' + dirOf(l.angle).n + ')'; })));
  var ns = S.notes || [];
  if (ns.length) { rows.push([]); rows.push(['Notes']); rows.push(['Date', 'Time', 'Note']); ns.forEach(function (n) { rows.push([ymd(n.t), hhmm(n.t), n.text]); }); }
  share(fileBase() + '_intervals.csv', csv(rows));
}
function exportMovements() {
  var agg = {};
  S.events.forEach(function (e) {
    var bs = binStart(e.t), md = e.k === 'v' ? 'Vehicle' : e.k === 'b' ? 'Bicycle' : 'Pedestrian';
    var cl = e.k === 'v' ? (e.c === 'car' ? 'Car' : 'Truck/Bus') : '';
    var key = [bs, md, e.from, e.to, cl].join('|');
    agg[key] = (agg[key] || 0) + 1;
  });
  var rows = [['Site', 'Date', 'Interval start', 'Interval end', 'Mode', 'From leg (crosswalk leg for pedestrians)', 'To leg (walking toward, for pedestrians)', 'Class', 'Count', 'Walking direction (pedestrians)']];
  Object.keys(agg).map(function (k) { return k.split('|'); })
    .sort(function (a, b) { return (a[0] - b[0]) || a[1].localeCompare(b[1]) || legNameOf(S, a[2]).localeCompare(legNameOf(S, b[2])) || legNameOf(S, a[3]).localeCompare(legNameOf(S, b[3])) || a[4].localeCompare(b[4]); })
    .forEach(function (p) {
      var bs = +p[0];
      rows.push([S.site, ymd(bs), hhmm(bs), hhmm(bs + BIN), p[1], legNameOf(S, p[2]), p[2] === p[3] ? 'U-turn' : legNameOf(S, p[3]), p[4], agg[p.join('|')], p[1] === 'Pedestrian' ? walkDir(p[2], p[3]) : '']);
    });
  share(fileBase() + '_movements.csv', csv(rows));
}

/* ---------- study management ---------- */
function archiveCurrent() {
  if (!S.startedAt) return;
  if (!S.endedAt) S.endedAt = Date.now();
  H.push(S); persistHist();
}
function startNew() {
  archiveCurrent();
  S = newStudy(S); persist(); mode = 'veh'; cls = 'car'; clsLocked = false; viewBin = null; rmMode = false; view = 'setup'; render();
}
function openHistory() {
  function list() {
    if (!H.length) return '<p class="hint">No past counts yet. Finished counts are kept here on this iPad.</p>';
    return H.slice().reverse().map(function (h) {
      var veh = h.events.filter(function (e) { return e.k === 'v'; }).length;
      return '<div class="hrow" data-id="' + h.id + '"><div class="hi"><b>' + esc(h.site || 'Untitled count') + '</b><small>' + ymd(h.startedAt) + ' · ' + hhmm(h.startedAt) + ' · ' + veh + ' vehicles</small></div>' +
        '<button class="ghost" data-a="open">Open</button><button class="ghost" data-a="del">Delete</button></div>';
    }).join('');
  }
  openSheet('Past counts', '<div id="hl">' + list() + '</div>', function (box) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var id = b.closest('.hrow').dataset.id, i = H.findIndex(function (x) { return x.id === id; });
      if (i < 0) return;
      if (b.dataset.a === 'del') {
        if (!confirm('Delete this saved count permanently?')) return;
        H.splice(i, 1); persistHist(); $('#hl').innerHTML = list();
      } else {
        var chosen = H.splice(i, 1)[0];
        if (S.startedAt) { if (!S.endedAt) S.endedAt = Date.now(); H.push(S); }
        persistHist(); S = chosen; persist(); view = 'results'; closeSheet(); render();
      }
    });
  });
}

/* ---------- events ---------- */
app.addEventListener('click', function (e) {
  var mvEl = e.target.closest('.mv'); if (mvEl) return tap(mvEl);
  var t = e.target.closest('button'); if (!t) return;
  if (t.dataset.mode) { mode = t.dataset.mode; return render(); }
  if (t.dataset.cls) return clsTap(t.dataset.cls);
  switch (t.id) {
    case 'start':
      if (activeLegs().length < 3) { toast('An intersection needs at least 3 legs'); return; }
      audio(); S.startedAt = alignStart ? nextMark() : Date.now(); S.endedAt = null;
      persist(); view = 'count'; render(); break;
    case 'undo': undo(); break;
    case 'ivprev': ivNav(-1); break;
    case 'ivnext': ivNav(1); break;
    case 'ivlive': viewBin = null; rmMode = false; lastAct = Date.now(); tick(); break;
    case 'rmbtn': rmMode = !rmMode; lastAct = Date.now(); tick(); break;
    case 'recent': openRecent(); break;
    case 'notesbtn': case 'notesres': openNotes(); break;
    case 'snd': soundOn = !soundOn; try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch (e2) {} t.textContent = soundOn ? '🔊' : '🔇'; if (soundOn) sound('car'); break;
    case 'legsbtn': openSheet('Intersection legs', '<div id="legbox"></div>', function (box) { legEditor($('#legbox', box)); }); break;
    case 'resbtn': view = 'results'; releaseAwake(); render(); break;
    case 'back': view = 'count'; render(); break;
    case 'stop':
      if (confirm('Stop counting and view results?')) { S.endedAt = Date.now(); persist(); releaseAwake(); view = 'results'; render(); }
      break;
    case 'resume': S.endedAt = null; persist(); view = 'count'; render(); break;
    case 'exp1': exportIntervals(); break;
    case 'exp2': exportMovements(); break;
    case 'newcount': if (confirm('Start a new count? This one is saved under Past counts.')) startNew(); break;
    case 'hist': openHistory(); break;
  }
});

render();
if ('serviceWorker' in navigator) {
  var hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) { try { reg.update(); } catch (e) {} }).catch(function () {});
  navigator.serviceWorker.addEventListener('controllerchange', function () {   // a new version took over: reload, but never in the middle of a count
    if (!hadCtl || reloaded || view === 'count') return;
    reloaded = true; location.reload();
  });
}
})();
