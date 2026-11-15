(function () {
'use strict';
var TMC = window.TMC, analyze = TMC.analyze, binStart = TMC.binStart, BIN = TMC.BIN;

/* ---------- helpers ---------- */
var LS_CUR = 'tmc.current.v1', LS_HIS = 'tmc.history.v1';
var APP_VERSION = '18 (15 Nov 2026)';
var $ = function (s, r) { return (r || document).querySelector(s); };
var uid = function () { return Math.random().toString(36).slice(2, 10); };
var pad = function (n) { return String(n).padStart(2, '0'); };
var hhmm = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
var ymd = function (t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var WDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var dayName = function (t) { return WDAYS[new Date(t).getDay()]; };
var ymdw = function (t) { return dayName(t) + ', ' + ymd(t); };
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
    id: uid(), site: prev ? prev.site : '', observer: prev ? prev.observer : '', weather: '',
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
var cls = 'car';           // car | truck (heavy vehicles: trucks and buses) | bike
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
// [frequency Hz, seconds, wave, volume, start delay] per note.
var SOUNDS = {
  car: [[740, 0.08, 'sine', 0.3, 0]],
  truck: [[420, 0.16, 'triangle', 0.4, 0]],
  bus: [[420, 0.07, 'triangle', 0.4, 0], [420, 0.07, 'triangle', 0.4, 0.11]],
  bike: [[1180, 0.06, 'sine', 0.3, 0]],
  ped: [[900, 0.05, 'sine', 0.3, 0], [1250, 0.05, 'sine', 0.3, 0.07]],
  undo: [[520, 0.07, 'sawtooth', 0.15, 0], [300, 0.12, 'sawtooth', 0.15, 0.08]]
};
// Primary path: real audio clips (an <audio> element keeps playing when the iPad's side switch is set to mute, and works on old iOS).
// Backup path: Web Audio oscillators.
var clips = {};
function makeClip(notes) {
  var rate = 22050, end = 0, i, j;
  notes.forEach(function (n) { end = Math.max(end, n[4] + n[1]); });
  var len = Math.ceil((end + 0.04) * rate), pcm = new Int16Array(len);
  notes.forEach(function (n) {
    var f = n[0], dur = n[1], type = n[2], vol = n[3] * 1.6, st = Math.floor(n[4] * rate), cnt = Math.floor(dur * rate);
    for (j = 0; j < cnt && st + j < len; j++) {
      var t = j / rate, ph = (t * f) % 1, w = type === 'triangle' ? 4 * Math.abs(ph - 0.5) - 1 : type === 'sawtooth' ? 2 * ph - 1 : Math.sin(2 * Math.PI * ph);
      var env = Math.min(1, t / 0.006) * Math.pow(1 - j / cnt, 1.4);
      var v = pcm[st + j] + Math.round(w * env * vol * 32767 * 0.6);
      pcm[st + j] = Math.max(-32767, Math.min(32767, v));
    }
  });
  var bytes = new Uint8Array(44 + len * 2), dv = new DataView(bytes.buffer);
  var wr = function (o, s2) { for (var q = 0; q < s2.length; q++) bytes[o + q] = s2.charCodeAt(q); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); wr(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, len * 2, true);
  for (i = 0; i < len; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  var bin = ''; for (i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  var el = new Audio('data:audio/wav;base64,' + btoa(bin)); el.preload = 'auto'; try { el.load(); } catch (e) {}
  return el;
}
function playClip(kind) {
  try {
    if (!window.Audio) return false;
    var el = clips[kind] || (clips[kind] = makeClip(SOUNDS[kind]));
    try { el.pause(); el.currentTime = 0; } catch (e) {}
    var p = el.play();
    if (p && p.catch) p.catch(function () { playBeeps(kind); });
    return true;
  } catch (e) { return false; }
}
function playBeeps(kind) { (SOUNDS[kind] || []).forEach(function (n) { beep(n[0], n[1], n[2], n[3], n[4]); }); }
function sound(kind) {
  if (!soundOn || !SOUNDS[kind]) return;
  if (!playClip(kind)) playBeeps(kind);
}
// iOS only lets sound start from a touch: prepare the clips on the very first touch of the app
function unlockSound() {
  document.removeEventListener('touchend', unlockSound, true); document.removeEventListener('click', unlockSound, true);
  try { audio(); Object.keys(SOUNDS).forEach(function (k) { if (!clips[k]) clips[k] = makeClip(SOUNDS[k]); }); } catch (e) {}
}
document.addEventListener('touchend', unlockSound, true); document.addEventListener('click', unlockSound, true);

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
    box.innerHTML = '<div class="xpv"></div>' + legs.map(function (l) {
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
    '<label>Observer<input id="obs" type="text" value="' + esc(S.observer) + '" placeholder="Your name"></label>' +
    '<label>Weather conditions<input id="wx" type="text" value="' + esc(S.weather || '') + '" placeholder="e.g. Sunny, dry, 5°C"></label></div>' +
    '<div class="card"><h2>Legs</h2><div id="legs"></div></div>' +
    '<div class="card"><label class="chk"><input type="checkbox" id="align"' + (alignStart ? ' checked' : '') + '> Start at the next 15-minute mark</label><div class="hint" id="alignhint"></div></div>' +
    '<button class="big go" id="start">Start count</button>' +
    '<div class="row"><button class="ghost" id="hist">Past counts (' + H.length + ')</button></div>' +
    '<p class="foot">Works offline. Counts are saved on this iPad as you tap — export the CSV files after each count.<br>To install: Safari → Share → Add to Home Screen.<br>App version ' + APP_VERSION + ' <button class="ghost" id="chkupd" style="min-height:36px;padding:4px 10px;margin-left:8px">Check for updates</button></p></div>';
  legEditor($('#legs'));
  $('#site').addEventListener('input', function (e) { S.site = e.target.value; persist(); });
  $('#obs').addEventListener('input', function (e) { S.observer = e.target.value; persist(); });
  $('#wx').addEventListener('input', function (e) { S.weather = e.target.value; persist(); });
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

/* class selector: Heavy vehicle and Bike count once, then fall back to Car; double-tap keeps one selected */
var CLS_LABEL = { car: 'Car', truck: 'Heavy vehicle', bike: 'Bike' };
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
    (panel || mode === 'veh' ? '<nav class="classes">' + clsBtnsHTML() + '</nav><p class="clshint">Heavy vehicle and Bike count once, then go back to Car. Double-tap to keep one selected.</p>' : '') +
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
function kindLabel(e) { return e.k === 'v' ? (e.c === 'car' ? 'Car' : 'Heavy vehicle') : e.k === 'b' ? 'Bike' : 'Pedestrian'; }
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
        (e.k === 'v' ? '<div class="cs">' + ['car', 'truck'].map(function (c) { return '<button class="cb' + ((e.c === c || (c === 'truck' && e.c === 'bus')) ? ' on' : '') + '" data-a="cls" data-c="' + c + '">' + (c === 'car' ? 'Car' : 'Heavy') + '</button>'; }).join('') + '</div>' : '') +
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
function notesCardHTML(edit) {
  var ns = S.notes || [];
  return '<div class="card"><div class="chead"><h2>Notes</h2>' + (edit ? '<button class="ghost sm" id="notesres">' + (ns.length ? 'Edit' : 'Add note') + '</button>' : '') + '</div>' + (ns.length ? ns.map(function (n) { return '<p class="nline"><small>' + hms(n.t) + '</small>' + esc(n.text) + '</p>'; }).join('') : '<p class="hint">No notes.</p>') + '</div>';
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

var pvTab = 0;
function previewHTML() {
  var sh = buildSheets(), i, tabs = '', body = '';
  if (pvTab >= sh.length) pvTab = 0;
  for (i = 0; i < sh.length; i++) tabs += '<button class="seg' + (i === pvTab ? ' on' : '') + '" data-pv="' + i + '">' + esc(sh[i].name) + '</button>';
  var R = sh[pvTab].rows, g = R[1], h = R[2], n = h.length, head1 = '<th></th>', c, span;
  for (c = 3; c < n; c++) {
    if (g[c]) { span = 1; while (c + span < n && !g[c + span] && c + span < n - 1) span++; head1 += '<th class="grp" colspan="' + span + '">' + esc(g[c]) + '</th>'; c += span - 1; }
    else head1 += '<th></th>';
  }
  var head2 = '<th>Interval</th>'; for (c = 3; c < n; c++) head2 += '<th>' + esc(h[c]) + '</th>';
  for (i = 3; i < R.length; i++) {
    var r = R[i], isT = r[0] === 'Total', row = '<td>' + (isT ? 'Total' : esc(r[1]) + '–' + esc(r[2])) + '</td>';
    for (c = 3; c < n; c++) row += '<td>' + (r[c] === 0 ? '<span class="z">0</span>' : r[c]) + '</td>';
    body += '<tr' + (isT ? ' class="sumr"' : '') + '>' + row + '</tr>';
  }
  return '<div class="card"><h2>Export preview</h2><p class="hint">This is what the Excel and CSV files contain. Excel has one sheet per table; CSV has one file per table.</p><div class="segs">' + tabs + '</div><div class="scroll"><table class="xpv"><thead><tr>' + head1 + '</tr><tr>' + head2 + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function renderResults() {
  var A = analyze(S), pk = A.peak, running = !S.endedAt;
  var tot = A.bins.reduce(function (s, b) { s.car += b.car; s.truck += b.truck; s.veh += b.veh; s.bike += b.bike; s.ped += b.ped; return s; }, { car: 0, truck: 0, veh: 0, bike: 0, ped: 0 });
  var warns = [];
  if (running) warns.push('Count still in progress — the current interval is incomplete.');
  if (binStart(S.startedAt) !== S.startedAt) warns.push('Count started at ' + hhmm(S.startedAt) + ', so the first interval is partial.');
  if (S.endedAt && Math.abs(binStart(S.endedAt) - S.endedAt) > 5000 && Math.abs(binStart(S.endedAt) + BIN - S.endedAt) > 5000) warns.push('Count stopped at ' + hhmm(S.endedAt) + ', so the last interval is partial.');
  if (!pk) warns.push('No peak hour yet: it needs four complete 15-minute intervals in a row (one full hour). Complete intervals so far: ' + A.nFull + '. Partial first or last intervals do not count.');

  var peakKpis = pk ?
    '<div class="kpi"><small>Peak hour</small><b class="nw">' + hhmm(pk.start) + '–' + hhmm(pk.end) + '</b></div>' +
    '<div class="kpi"><small>Vehicles in peak hour</small><b>' + pk.vol + '</b></div>' +
    '<div class="kpi"><small>Peak hour factor</small><b>' + (pk.phf == null ? '–' : pk.phf.toFixed(2)) + '</b></div>' +
    '<div class="kpi"><small>Heavy vehicles</small><b>' + pct(pk.heavyPct) + '</b><small>' + pk.truck + ' of ' + pk.vol + '</small></div>' : '';

  var nN = (S.notes || []).length;
  app.innerHTML =
    '<div class="tbar">' +
    (running ? '<button id="back"><i>←</i>Back to count</button>' : '<button id="resume"><i>▶</i>Resume count</button>') +
    '<button id="notesres"><i>✎</i>Notes' + (nN ? ' (' + nN + ')' : '') + '</button>' +
    '<button id="newcount"><i>＋</i>New count</button>' +
    '<button id="hist"><i>☰</i>Past counts (' + H.length + ')</button></div>' +
    '<div class="page"><h1>' + esc(S.site || 'Untitled count') + '</h1>' +
    '<p class="hint">' + ymdw(S.startedAt) + (S.observer ? ' · ' + esc(S.observer) : '') + (S.weather ? ' · ' + esc(S.weather) : '') + '</p>' +
    warns.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') +
    '<div class="xgrid">' +
    '<button class="hb dark" id="pdfbtn">Summary PDF<small>Diagrams and tables</small></button>' +
    '<button class="hb dark" id="exp1">Excel<small>4 sheets</small></button>' +
    '<button class="hb dark" id="exp2">CSV<small>4 files</small></button></div>' +
    '<div class="kpis">' + peakKpis + '</div>' +
    matrixHTML(A, S) +
    previewHTML() +
    ((S.notes || []).length ? notesCardHTML(false) : '') + '</div>';
}

/* ---------- export ---------- */
/* delivering files: each file gets its own button, so every share/save is a direct tap (iOS requires that) */
function saveOne(it) {   // plain download / open fallback
  try {
    var url = URL.createObjectURL(it.blob), a = document.createElement('a');
    if ('download' in a) { a.href = url; a.download = it.name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved ' + it.name + ' (see Downloads)'); }
    else { window.open(url, '_blank'); }
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } catch (e) { toast('Could not save: ' + (e && e.message || e)); }
}
var CAN_DL = (function () { try { return 'download' in document.createElement('a'); } catch (e) { return false; } })();
var LEGACY_NOTE = 'This iPad’s software (iOS 12) cannot send files from a Home Screen app. Use Email or Share as text, or Copy and paste into Excel.';
function canShareIt(it) {
  try {
    if (!navigator.share) return false;
    var file = new File([it.blob], it.name, { type: it.mime });
    return navigator.canShare ? !!navigator.canShare({ files: [file] }) : false;
  } catch (e) { return false; }
}
function shareOne(it) {
  var file = null;
  try { file = new File([it.blob], it.name, { type: it.mime }); } catch (e) {}
  if (file && canShareIt(it)) {
    try {
      navigator.share({ files: [file], title: it.name }).catch(function (err) { if (err && err.name === 'AbortError') return; toast('Share sheet refused (' + (err && err.name || 'error') + ')'); if (CAN_DL) saveOne(it); });
      return;
    } catch (e) {}
  }
  if (CAN_DL) saveOne(it); else toast('This iPad can not send files from the app');
}
function shareText(it) {
  try { navigator.share({ title: it.name, text: it.text }).catch(function () {}); } catch (e) { toast('Sharing text is not available'); }
}
function mailText(it) {
  location.href = 'mailto:?subject=' + encodeURIComponent(it.name) + '&body=' + encodeURIComponent(it.text);
}
function copyOut(txt) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(function () { toast('Copied — paste into Excel, Numbers or Notes'); }, function () { toast('Copy not allowed here'); }); return; } } catch (e) {}
  var ok = false, ta = document.createElement('textarea');
  ta.value = txt; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;-webkit-user-select:text;user-select:text';
  document.body.appendChild(ta);
  try {
    var r = document.createRange(); r.selectNodeContents(ta); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    ta.setSelectionRange(0, 999999); ok = document.execCommand('copy');
  } catch (e) {}
  ta.parentNode.removeChild(ta);
  toast(ok ? 'Copied — paste into Excel, Numbers or Notes' : 'Copy is not allowed on this iPad');
}
function tsv(rows) { return rows.map(function (r) { return r.map(function (c) { return c == null ? '' : String(c).replace(/[\t\r\n]+/g, ' '); }).join('\t'); }).join('\n'); }
function offerFiles(items) {
  var rows = items.map(function (it, i) {
    var ok = canShareIt(it), btn = '';
    if (ok) btn += '<button class="hb dark" data-a="share" data-i="' + i + '">Share / Save</button>' + (CAN_DL ? '<a class="ghost lnk" data-i="' + i + '" target="_blank">Open</a>' : '');
    if (it.text) {
      if (navigator.share) btn += '<button class="' + (ok ? 'ghost' : 'hb dark') + '" data-a="text" data-i="' + i + '">Share as text</button>';
      btn += '<button class="ghost" data-a="mail" data-i="' + i + '">Email text</button><button class="ghost" data-a="copy" data-i="' + i + '">Copy</button>';
    }
    return '<div class="xrow"><div class="ri"><b>' + esc(it.name) + '</b><small>' + Math.max(1, Math.round(it.blob.size / 1024)) + ' KB</small></div><div class="xb">' + btn + '</div>' +
      (ok ? '' : '<p class="hint" style="margin:6px 0 0">' + LEGACY_NOTE + '</p>') + '</div>';
  }).join('');
  openSheet('Export', rows, function (box) {
    var links = box.querySelectorAll('a.lnk');
    for (var i = 0; i < links.length; i++) { try { links[i].href = URL.createObjectURL(items[+links[i].dataset.i].blob); } catch (e) {} }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var it = items[+b.dataset.i], a = b.dataset.a;
      if (a === 'share') shareOne(it); else if (a === 'text') shareText(it); else if (a === 'mail') mailText(it); else if (a === 'copy') copyOut(it.tsv || it.text);
    });
  });
}

/* ---- tables: rows are intervals, columns are movements grouped by leg (left, thru, right) ---- */
function exportModel() {
  var A = analyze(S), pk = A.peak, bins = A.bins, idx = {}, used = {}, usedP = {}, anyU = false;
  bins.forEach(function (b, i) { idx[b.start] = i; b.t = {}; });
  S.events.forEach(function (e) {
    var key = e.from + '>' + e.to;
    if (e.k === 'p') usedP[key] = 1; else { used[key] = 1; if (e.from === e.to) anyU = true; }
    var b = bins[idx[binStart(e.t)]]; if (!b) return;
    var tk = (e.k === 'p' ? 'p' : 'm') + key, o = b.t[tk] || (b.t[tk] = { car: 0, truck: 0, bike: 0, ped: 0 });
    if (e.k === 'v') o[e.c === 'bus' ? 'truck' : e.c]++; else if (e.k === 'b') o.bike++; else o.ped++;
  });
  var active = sortedLegs(), act = {};
  active.forEach(function (l) { act[l.id] = 1; });
  var all = active.slice();
  S.legs.forEach(function (l) { if (l.removed) { var has = Object.keys(used).concat(Object.keys(usedP)).some(function (k) { var p = k.split('>'); return p[0] === l.id || p[1] === l.id; }); if (has) all.push(l); } });
  var head = function (L) { return L.name + (L.removed ? ' (removed)' : '') + ' (' + dirOf(L.angle).n + ')'; };

  var mcols = [];
  all.forEach(function (L) {
    var ds = all.filter(function (g) { return g.id !== L.id; }).map(function (g) { return { g: g, tn: turnOf(L.angle, g.angle), u: false }; })
      .sort(function (a, b) { return a.tn - b.tn; });
    ds = ds.filter(function (x) { return (act[L.id] && act[x.g.id]) || used[L.id + '>' + x.g.id]; });
    if (anyU && (act[L.id] || used[L.id + '>' + L.id])) ds.push({ g: L, tn: 180, u: true });
    var cnt = {}; ds.forEach(function (x) { x.lb = x.u ? 'U-turn' : cap(turnLabel(x.tn).toLowerCase()); cnt[x.lb] = (cnt[x.lb] || 0) + 1; });
    ds.forEach(function (x, i) {
      mcols.push({ k: 'm' + L.id + '>' + x.g.id, h1: i === 0 ? head(L) : '', h2: cnt[x.lb] > 1 ? x.lb + ' → ' + x.g.name : x.lb });
    });
  });
  var pcols = [], seen = {};
  all.forEach(function (L) {
    var i = active.indexOf(L), n = active.length, nb = [];
    if (i >= 0) nb = [active[(i - 1 + n) % n], active[(i + 1) % n]];
    Object.keys(usedP).forEach(function (k) { var p = k.split('>'); if (p[0] === L.id) { var g = S.legs.filter(function (x) { return x.id === p[1]; })[0]; if (g && nb.indexOf(g) < 0) nb.push(g); } });
    var first = true;
    nb.forEach(function (g) {
      var key = L.id + '>' + g.id; if (seen[key]) return; seen[key] = 1;
      if (!(act[L.id] && act[g.id]) && !usedP[key]) return;
      var wd = walkDir(L.id, g.id);
      pcols.push({ k: 'p' + key, h1: first ? 'Crossing ' + head(L) : '', h2: wd ? 'Walking ' + wd : 'Toward ' + g.name }); first = false;
    });
  });
  return { A: A, pk: pk, bins: bins, mcols: mcols, pcols: pcols };
}

function tableRows(M, title, cols, fn, extras, peakRow) {
  var rows = [], r, bins = M.bins, pk = M.pk;
  var all = cols.concat(extras || []);
  r = [title]; r.b = true; rows.push(r);
  r = ['', '', ''].concat(all.map(function (c) { return c.h1 || ''; })); r.b = true; rows.push(r);
  r = ['Date', 'Start', 'End'].concat(all.map(function (c) { return c.h2; })); r.b = true; rows.push(r);
  var tot = all.map(function () { return 0; });
  bins.forEach(function (b, i) {
    rows.push([ymd(b.start), hhmm(b.start), hhmm(b.start + BIN)].concat(all.map(function (c, j) {
      var v = c.fn ? c.fn(b, i) : fn(b, c);
      if (typeof v === 'number') tot[j] += v;
      return v;
    })));
  });
  r = ['Total', '', ''].concat(all.map(function (c, j) { return c.text ? '' : tot[j]; })); r.b = true; rows.push(r);
  if (peakRow && pk) {
    var pr = all.map(function (c) {
      if (c.text) return '';
      var s = 0; for (var i = pk.i; i < pk.i + 4; i++) { var v = c.fn ? c.fn(bins[i], i) : fn(bins[i], c); if (typeof v === 'number') s += v; }
      return s;
    });
    r = ['Peak hour', hhmm(pk.start), hhmm(pk.end)].concat(pr); r.b = true; rows.push(r);
    rows.push(['Peak hour factor', '', '', pk.phf == null ? '' : +pk.phf.toFixed(3)]);
  }
  return rows;
}

function buildSheets() {
  var M = exportModel();
  var cell = function (cls) { return function (b, c) { var o = b.t[c.k]; return o ? o[cls] : 0; }; };
  var withApp = function (cols, cls) {   // adds an "Approach total" column after each leg group
    var out = [], grp = [];
    var flush = function () { if (!grp.length) return; var g = grp.slice(); out.push({ h1: '', h2: 'Approach total', fn: function (b) { var t = 0; g.forEach(function (c) { t += cell(cls)(b, c); }); return t; } }); grp = []; };
    cols.forEach(function (c) { if (c.h1) flush(); out.push(c); grp.push(c); });
    flush(); return out;
  };
  var one = function (title, cols, cls, app) { return tableRows(M, title, app ? withApp(cols, cls) : cols, cell(cls), [{ h2: 'Total', fn: function (b) { var t = 0; cols.forEach(function (c) { t += cell(cls)(b, c); }); return t; } }], false); };
  return [
    { name: 'Cars', rows: one('Cars — by movement', M.mcols, 'car'), file: 'cars' },
    { name: 'Heavy vehicles', rows: one('Heavy vehicles — by movement', M.mcols, 'truck'), file: 'heavy_vehicles' },
    { name: 'Bikes', rows: one('Bicycles — by movement', M.mcols, 'bike', true), file: 'bikes' },
    { name: 'Pedestrians', rows: one('Pedestrians — by crosswalk and walking direction', M.pcols, 'ped', true), file: 'pedestrians' }
  ];
}

function csv(rows) {
  return rows.map(function (r) {
    return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
  }).join('\r\n');
}
function fileBase() { return (S.site || 'count').replace(/[^\w\-]+/g, '_').slice(0, 40) + '_' + ymd(S.startedAt); }
function exportCSVs() {
  try {
    var sheets = buildSheets();
    offerFiles(sheets.map(function (sh) {
      return { name: fileBase() + '_' + sh.file + '.csv', mime: 'text/csv', blob: new Blob(['\ufeff' + csv(sh.rows)], { type: 'text/csv' }), text: csv(sh.rows), tsv: tsv(sh.rows) };
    }));
  } catch (e) { toast('Export failed: ' + (e && e.message || e)); }
}

/* ---- minimal .xlsx writer (stored zip, no library, works offline) ---- */
var CRC_T = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function utf8(s) {
  var e = unescape(encodeURIComponent(s)), b = new Uint8Array(e.length);
  for (var i = 0; i < e.length; i++) b[i] = e.charCodeAt(i);
  return b;
}
function zipStore(files) {   // files: [{name, data(string)}]
  var parts = [], central = [], off = 0;
  var u16 = function (n) { return [n & 255, (n >> 8) & 255]; }, u32 = function (n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; };
  files.forEach(function (f) {
    var nm = utf8(f.name), d = utf8(f.data), crc = crc32(d);
    var lh = [0x50, 0x4b, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(d.length), u32(d.length), u16(nm.length), u16(0));
    parts.push(new Uint8Array(lh), nm, d);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(d.length), u32(d.length), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), nm);
    off += lh.length + nm.length + d.length;
  });
  var csz = 0; central.forEach(function (c) { csz += c.length; });
  parts = parts.concat(central);
  parts.push(new Uint8Array([0x50, 0x4b, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(csz), u32(off), u16(0))));
  return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function xlsxBlob(sheets) {
  var X = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); };
  var colName = function (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  var files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map(function (s, i) { return '<sheet name="' + X(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' }
  ];
  sheets.forEach(function (s, si) {
    var w = 0; s.rows.forEach(function (r) { w = Math.max(w, r.length); });
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="3" width="9" customWidth="1"/><col min="4" max="' + Math.max(4, w) + '" width="15" customWidth="1"/></cols><sheetData>';
    s.rows.forEach(function (r, ri) {
      xml += '<row r="' + (ri + 1) + '">';
      r.forEach(function (v, ci) {
        if (v === '' || v == null) return;
        var ref = colName(ci) + (ri + 1), st = r.b ? ' s="1"' : '';
        xml += typeof v === 'number' ? '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>' : '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + X(v) + '</t></is></c>';
      });
      xml += '</row>';
    });
    files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', data: xml + '</sheetData></worksheet>' });
  });
  return zipStore(files);
}
function exportExcel() {
  try {
    var sheets = buildSheets();
    offerFiles([{ name: fileBase() + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', blob: xlsxBlob(sheets), text: sheets.map(function (sh) { return csv(sh.rows); }).join('\r\n\r\n'), tsv: sheets.map(function (sh) { return tsv(sh.rows); }).join('\n\n') }]);
  } catch (e) { toast('Export failed: ' + (e && e.message || e)); }
}

/* ---------- summary PDF: drawing ops feed both the in-app preview (SVG) and the PDF file ---------- */
var PW = 792, PH = 612;   // US Letter, landscape (points)
var _mc = null;
function tw(s, size, bold) {
  try { if (!_mc) _mc = document.createElement('canvas').getContext('2d'); _mc.font = (bold ? 'bold ' : '') + '100px Helvetica, Arial, sans-serif'; return _mc.measureText(s).width * size / 100; }
  catch (e) { return String(s).length * size * 0.55; }
}
function fitTxt(s, size, bold, maxw) { s = String(s); if (tw(s, size, bold) <= maxw) return s; while (s.length > 1 && tw(s + '…', size, bold) > maxw) s = s.slice(0, -1); return s + '…'; }

function Dg(ox, oy, sc) {   // diagram helper: unit space (0..1000) -> page points
  var ops = [];
  var d = {
    ops: ops, X: function (u) { return ox + u * sc; }, Y: function (u) { return oy + u * sc; },
    rect: function (x, y, w, h, o) { ops.push({ t: 'rect', x: ox + x * sc, y: oy + y * sc, w: w * sc, h: h * sc, fill: o.fill, stroke: o.stroke, sw: o.sw, r: (o.r || 0) * sc }); },
    line: function (x1, y1, x2, y2, o) { ops.push({ t: 'line', x1: ox + x1 * sc, y1: oy + y1 * sc, x2: ox + x2 * sc, y2: oy + y2 * sc, stroke: o.stroke, sw: o.sw, dash: o.dash }); },
    poly: function (pts, o) { ops.push({ t: 'poly', pts: pts.map(function (p) { return [ox + p[0] * sc, oy + p[1] * sc]; }), fill: o.fill, stroke: o.stroke, sw: o.sw, close: o.close !== false }); },
    text: function (x, y, s, size, o) { ops.push({ t: 'text', x: ox + x * sc, y: oy + y * sc, s: s, size: size, bold: o && o.bold, color: o && o.color, anchor: o && o.anchor }); }
  };
  return d;
}
function pt(a, v, k) { return { x: a.x + v.x * k, y: a.y + v.y * k }; }
function drawArrow(D, ac, hd, dt, len, col, u, hs) {
  hs = hs || 1;   // arrives heading hd, leaves heading dt (unit vectors); u = U-turn
  var pts, tip, dir;
  if (u) {
    var rv = { x: -hd.y, y: hd.x }, a = pt(pt(ac, rv, 11), hd, -len), b = pt(pt(ac, rv, 11), hd, len * 0.7), c = pt(pt(ac, rv, -11), hd, len * 0.7), e = pt(pt(ac, rv, -11), hd, -len * 0.5);
    pts = [a, b, c, e]; dir = { x: -hd.x, y: -hd.y }; tip = e;
  } else { pts = [pt(ac, hd, -len), ac, pt(ac, dt, len)]; dir = dt; tip = pts[2]; }
  D.poly(pts.map(function (p) { return [p.x, p.y]; }), { stroke: col, sw: 1.6, close: false });
  var pr = { x: -dir.y, y: dir.x }, h0 = pt(tip, dir, 11 * hs), h1 = pt(tip, pr, 7 * hs), h2 = pt(tip, pr, -7 * hs);
  D.poly([[h0.x, h0.y], [h1.x, h1.y], [h2.x, h2.y]], { fill: col });
}
function numFmt(n) { return String(n); }
function pageHeader(ops, title, lines) {
  ops.push({ t: 'text', x: 28, y: 27, s: fitTxt(S.site || 'Untitled count', 15, true, 736), size: 15, bold: true, color: '#0f172a' });
  ops.push({ t: 'text', x: 28, y: 43, s: title, size: 12.5, bold: true, color: '#1d4ed8' });
  lines.forEach(function (ln, i) { ops.push({ t: 'text', x: 28, y: 56 + i * 11, s: fitTxt(ln, 8.5, false, 736), size: 8.5, color: '#475569' }); });
}

/* ---- icons and the summary diagram (independent of the counting screen) ---- */
function ring(D, x, y, r, col, sw) { var p = []; for (var i = 0; i < 14; i++) p.push([x + r * Math.cos(i * Math.PI / 7), y + r * Math.sin(i * Math.PI / 7)]); D.poly(p, { stroke: col, sw: sw || 0.9 }); }
function iconBike(D, cx, cy, s, col) {   // s = width in D units
  var P = function (x, y) { return [cx + x * s, cy + y * s]; };
  ring(D, cx - 0.33 * s, cy + 0.12 * s, 0.2 * s, col); ring(D, cx + 0.33 * s, cy + 0.12 * s, 0.2 * s, col);
  D.poly([P(-0.33, 0.12), P(-0.08, -0.2), P(0.2, -0.2), P(0.33, 0.12)], { stroke: col, sw: 0.9, close: false });
  D.poly([P(-0.08, -0.2), P(0.02, 0.12), P(0.2, -0.2)], { stroke: col, sw: 0.9, close: false });
  D.poly([P(0.2, -0.2), P(0.16, -0.34), P(0.26, -0.34)], { stroke: col, sw: 0.9, close: false });
  D.line(cx - 0.18 * s, cy - 0.3 * s, cx - 0.02 * s, cy - 0.3 * s, { stroke: col, sw: 0.9 });
}
function iconPed(D, cx, cy, s, col) {   // s = height in D units
  var P = function (x, y) { return [cx + x * s, cy + y * s]; };
  ring(D, cx, cy - 0.38 * s, 0.1 * s, col);
  D.poly([P(0, -0.26), P(0, 0.08)], { stroke: col, sw: 1, close: false });
  D.poly([P(-0.2, -0.12), P(0, -0.2), P(0.2, -0.12)], { stroke: col, sw: 1, close: false });
  D.poly([P(-0.16, 0.44), P(0, 0.08), P(0.16, 0.44)], { stroke: col, sw: 1, close: false });
}
function wrapTxt(s, size, bold, maxw) {
  var words = String(s).split(' '), lines = [], line = '';
  words.forEach(function (w) { if (line && tw(line + ' ' + w, size, bold) > maxw) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w; });
  if (line) lines.push(line); return lines;
}
function pctHeavy(mv) { var v = mv ? mv.car + mv.truck : 0; return v ? (mv.truck / v * 100).toFixed(1) + '% heavy' : '–'; }
var DIR_SHORT = function (f) { for (var i = 0; i < DIRS.length; i++) if (DIRS[i].f === f) return DIRS[i].n; return ''; };

function legendOps(x, y, w) {
  var G = Dg(0, 0, 1), o = G.ops, k = 1;
  o.push({ t: 'text', x: x, y: y, s: 'HOW TO READ THIS PAGE', size: 8, bold: true, color: '#0f172a' }); y += 12;
  var item = function (drawSample, text, hh) {
    drawSample(y);
    var lines = wrapTxt(text, 7.2, false, w - 56);
    lines.forEach(function (ln, i) { o.push({ t: 'text', x: x + 54, y: y + 8 + i * 9, s: ln, size: 7.2, color: '#334155' }); });
    y += Math.max(hh, lines.length * 9 + 6);
  };
  item(function (yy) {
    G.rect(x, yy, 48, 46, { fill: '#ffffff', stroke: '#334155', sw: 0.9, r: 6 });
    drawArrow(G, { x: x + 12, y: yy + 10 }, { x: 0, y: -1 }, { x: 1, y: 0 }, 5, '#1e3a8a', false, 0.5);
    G.text(x + 33, yy + 14.5, '123', 10, { bold: true, color: '#0f172a', anchor: 'm' });
    G.text(x + 24, yy + 26, '8.1% heavy', 6.2, { color: '#c2410c', anchor: 'm' });
    iconBike(G, x + 14, yy + 37, 9, '#6d28d9'); G.text(x + 31, yy + 39.5, '4', 7, { bold: true, color: '#6d28d9', anchor: 'm' });
  }, 'Vehicles making this movement (cars + heavy vehicles). The arrow shows the turn.', 54);
  item(function (yy) { G.text(x + 23, yy + 9, '8.1% heavy', 7.5, { bold: true, color: '#c2410c', anchor: 'm' }); }, 'Share of those vehicles that were heavy vehicles (trucks and buses).', 20);
  item(function (yy) { iconBike(G, x + 14, yy + 8, 14, '#6d28d9'); G.text(x + 32, yy + 11, '4', 9, { bold: true, color: '#6d28d9', anchor: 'm' }); }, 'Bicycles making this movement (not included in the vehicle numbers).', 24);
  item(function (yy) {
    G.rect(x, yy, 50, 24, { fill: '#f0fdfa', stroke: '#0f766e', sw: 0.9, r: 6 });
    iconPed(G, x + 9, yy + 12, 12, '#115e59');
    drawArrow(G, { x: x + 21, y: yy + 12 }, { x: 1, y: 0 }, { x: 1, y: 0 }, 3.5, '#115e59', false, 0.5);
    G.text(x + 40, yy + 15.5, '12', 9, { bold: true, color: '#0f172a', anchor: 'm' });
  }, 'Pedestrians crossing at that leg, walking in the direction of the arrow.', 32);
  item(function (yy) {
    G.rect(x, yy, 50, 22, { fill: '#0f172a', r: 5 });
    G.text(x + 25, yy + 9, 'Street name', 6.2, { bold: true, color: '#ffffff', anchor: 'm' }); G.text(x + 25, yy + 17.5, 'Approach total: 171', 5, { bold: true, color: '#fde68a', anchor: 'm' });
  }, 'Name of the street and the total vehicles entering the intersection from it.', 30);
  return o;
}

function diagramPage(M, i0, i1, title, lines, mode) {   // mode: 'full' | 'peak' | 'nopeak'
  var legs = sortedLegs(), panel = layoutOf(legs) === 'panel', rw = panel ? 160 : 110, n = legs.length, sc = 0.496, k = 1 / sc;
  var V = volumesIn(M, i0, i1), D = Dg(212, 84, sc);
  D.rect(0, 0, 1000, 1000, { fill: '#dde7d6', stroke: '#94a3b8', sw: 0.8 });
  legs.forEach(function (L) {
    var d = uv(L.angle), q = { x: -d.y, y: d.x }, p1 = pt({ x: 500, y: 500 }, q, rw), p2 = pt(p1, d, 480), p3 = pt(pt({ x: 500, y: 500 }, q, -rw), d, 480), p4 = pt({ x: 500, y: 500 }, q, -rw);
    D.poly([[p1.x, p1.y], [p2.x, p2.y], [p3.x, p3.y], [p4.x, p4.y]], { fill: '#4b5563' });
  });
  var cp = []; for (var a = 0; a < 24; a++) cp.push([500 + rw * Math.cos(a * Math.PI / 12), 500 + rw * Math.sin(a * Math.PI / 12)]);
  D.poly(cp, { fill: '#4b5563' });
  legs.forEach(function (L) { var d = uv(L.angle), s = pt({ x: 500, y: 500 }, d, rw + 18), e = pt({ x: 500, y: 500 }, d, 480); D.line(s.x, s.y, e.x, e.y, { stroke: '#fbbf24', sw: 1, dash: [5, 4] }); });

  // one movement: arrow, vehicles, % heavy, bicycles
  var fitN = function (str, size, maxw) { return Math.min(size, maxw / Math.max(0.1, tw(String(str), 1, true))); };
  var card = function (c, w, h, hd, dt, mv, u) {
    var vv = mv ? mv.car + mv.truck : 0, bk = mv ? mv.bike : 0, ay = -h * sc / 2 + 11.5, nf = fitN(vv, 11.5, 21), bf = fitN(bk, 8, 15);
    D.rect(c.x - w / 2, c.y - h / 2, w, h, { fill: '#ffffff', stroke: '#334155', sw: 0.9, r: 8 });
    drawArrow(D, { x: c.x - 13 * k, y: c.y + ay * k }, hd, dt, 4.2 * k, '#1e3a8a', u, 0.7);
    D.text(c.x + 11.5 * k, c.y + (ay + nf * 0.36) * k, String(vv), nf, { bold: true, color: '#0f172a', anchor: 'm' });
    D.text(c.x, c.y + (ay + 17.2) * k, pctHeavy(mv), 6.6, { color: vv ? '#c2410c' : '#94a3b8', anchor: 'm' });
    iconBike(D, c.x - 11 * k, c.y + (ay + 28.5) * k, 11 * k, bk ? '#6d28d9' : '#a8a29e');
    D.text(c.x + 6 * k, c.y + (ay + 28.5 + bf * 0.36) * k, String(bk), bf, { bold: true, color: bk ? '#6d28d9' : '#a8a29e', anchor: 'm' });
  };
  var pedBox = function (c, vert, dt, np) {
    var w = vert ? 66 : 150, h = vert ? 150 : 66;
    D.rect(c.x - w / 2, c.y - h / 2, w, h, { fill: '#f0fdfa', stroke: '#0f766e', sw: 0.9, r: 8 });
    var o1 = vert ? { x: 0, y: -26 * k } : { x: -26 * k, y: 0 }, o2 = vert ? { x: 0, y: -4 * k } : { x: -4 * k, y: 0 }, o3 = vert ? { x: 0, y: 24 * k } : { x: 22 * k, y: 0 };
    iconPed(D, c.x + o1.x, c.y + o1.y, 12 * k, '#115e59');
    drawArrow(D, { x: c.x + o2.x, y: c.y + o2.y }, dt, dt, 6 * k, '#115e59', false, 0.8);
    var pf = fitN(np, 11, vert ? 26 : 24);
    D.text(c.x + o3.x, c.y + o3.y + (vert ? 0 : pf * 0.36 * k), String(np), pf, { bold: true, color: '#0f172a', anchor: 'm' });
  };
  var entering = function (L) { var s = 0; Object.keys(V.m).forEach(function (kk) { if (kk.split('>')[0] === L.id) s += V.m[kk].car + V.m[kk].truck; }); return s; };

  legs.forEach(function (L, i) {
    var d = uv(L.angle), right = { x: d.y, y: -d.x }, hd = { x: -d.x, y: -d.y }, th = L.angle * Math.PI / 180, t = { x: Math.cos(th), y: Math.sin(th) };
    var at = function (r, lam, vec) { return { x: 500 + d.x * r + vec.x * lam, y: 500 + d.y * r + vec.y * lam }; };
    var nbs = [[legs[(i - 1 + n) % n], -1], [legs[(i + 1) % n], 1]], ent = entering(L);
    if (panel) {
      var vert = Math.abs(d.x) > 0.5;
      nbs.forEach(function (pr) { pedBox(at(190, pr[1] * 78, t), vert, { x: t.x * pr[1], y: t.y * pr[1] }, V.p[L.id + '>' + pr[0].id] || 0); });
      legs.forEach(function (Dl) {
        if (Dl.id === L.id) return;
        var tn = turnOf(L.angle, Dl.angle), lam = tn < 0 ? -104 : tn > 0 ? 104 : 0;
        card(at(292, lam, right), 100, 100, hd, uv(Dl.angle), V.m[L.id + '>' + Dl.id], false);
      });
      card(at(395, -96, right), 104, 100, hd, hd, V.m[L.id + '>' + L.id], true);
      // street name and approach total, in the grass beside the end of the road
      var l1 = fitTxt(L.name, 8.5, true, 150), l2 = 'Approach total: ' + ent;
      var w = (Math.max(tw(l1, 8.5, true), tw(l2, 8, true)) + 14) / (sc), h = 27 / sc, sd = { x: -d.y, y: d.x };
      var off = rw + 10 + Math.abs(sd.x) * w / 2 + Math.abs(sd.y) * h / 2, R = 470;
      var cx = 500 + d.x * R + sd.x * off, cy = 500 + d.y * R + sd.y * off;
      cx = Math.max(w / 2 + 4, Math.min(996 - w / 2, cx)); cy = Math.max(h / 2 + 4, Math.min(996 - h / 2, cy));
      D.rect(cx - w / 2, cy - h / 2, w, h, { fill: '#0f172a', r: 8 * k });
      D.text(cx, cy - 2.4 * k, l1, 8.5, { bold: true, color: '#ffffff', anchor: 'm' });
      D.text(cx, cy + 9 * k, l2, 8, { bold: true, color: '#fde68a', anchor: 'm' });
    } else {
      // dense layouts (5+ legs or diagonal legs): one small table per approach
      var ex = legs.filter(function (g) { return g.id !== L.id; }).map(function (g) { return { leg: g, turn: turnOf(L.angle, g.angle), u: false }; }).sort(function (a, b) { return a.turn - b.turn; });
      ex.push({ leg: L, turn: 180, u: true });
      var bw = 132, rh = 12, bh = 26 + ex.length * rh + 14, bwU = bw * k, bhU = bh * k;
      var bc = { x: 500 + d.x * 450, y: 500 + d.y * 450 };
      bc.x = Math.max(bwU / 2 + 6, Math.min(994 - bwU / 2, bc.x)); bc.y = Math.max(bhU / 2 + 6, Math.min(994 - bhU / 2, bc.y));
      var x0 = bc.x - bwU / 2, y0 = bc.y - bhU / 2, X = function (p) { return x0 + p * k; }, Y = function (p) { return y0 + p * k; };
      D.rect(x0, y0, bwU, bhU, { fill: '#ffffff', stroke: '#334155', sw: 0.9, r: 6 * k });
      D.rect(x0, y0, bwU, 22 * k, { fill: '#0f172a', r: 6 * k });
      D.text(X(bw / 2), Y(9.5), fitTxt(L.name + ' (' + dirOf(L.angle).n + ')', 8, true, bw - 8), 8, { bold: true, color: '#ffffff', anchor: 'm' });
      D.text(X(bw / 2), Y(18.5), 'Approach total: ' + ent, 7, { bold: true, color: '#fde68a', anchor: 'm' });
      ex.forEach(function (x, j) {
        var mv = V.m[L.id + '>' + x.leg.id], vv = mv ? mv.car + mv.truck : 0, bk = mv ? mv.bike : 0, yc = 26 + j * rh + 6;
        drawArrow(D, { x: X(9), y: Y(yc) }, hd, uv(x.leg.angle), 3.6 * k, '#1e3a8a', x.u, 0.6);
        D.text(X(18), Y(yc + 2.6), x.u ? 'U-turn' : cap(turnLabel(x.turn).toLowerCase()), 7, { color: '#334155' });
        D.text(X(70), Y(yc + 3), String(vv), fitN(vv, 8.5, 24), { bold: true, color: '#0f172a', anchor: 'r' });
        D.text(X(73), Y(yc + 2.6), pctHeavy(mv), 5.9, { color: vv ? '#c2410c' : '#94a3b8' });
        iconBike(D, X(118), Y(yc), 8 * k, bk ? '#6d28d9' : '#a8a29e');
        D.text(X(123.5), Y(yc + 2.6), String(bk), 7, { bold: true, color: bk ? '#6d28d9' : '#a8a29e' });
      });
      var yp = 26 + ex.length * rh + 8;
      iconPed(D, X(9), Y(yp), 9 * k, '#115e59');
      var ptxt = 'Crossing, walking ' + nbs.map(function (pr) { return DIR_SHORT(walkDir(L.id, pr[0].id)) + ' ' + (V.p[L.id + '>' + pr[0].id] || 0); }).join(' · ');
      D.text(X(18), Y(yp + 2.6), fitTxt(ptxt, 6.6, false, bw - 22), 6.6, { color: '#0f172a' });
    }
  });
  D.poly([[48, 40], [60, 80], [48, 72], [36, 80]], { fill: '#0f172a' }); D.text(48, 108, 'N', 8, { bold: true, color: '#0f172a', anchor: 'm' });

  // the time period, in the middle of the junction
  var span = hhmm(M.bins[i0].start) + '–' + hhmm(M.bins[i1].start + BIN), cw0 = panel ? 250 : 230, ch0 = panel ? 140 : 150, top0 = -ch0 / 2 * sc;
  D.rect(500 - cw0 / 2, 500 - ch0 / 2, cw0, ch0, { fill: '#ffffff', stroke: '#0f172a', sw: 1, r: 12 });
  var cl = function (dy, txt, size, o) { D.text(500, 500 + dy * k, txt, size, o); };
  cl(top0 + 16, mode === 'full' ? 'FULL COUNT' : 'PEAK HOUR', 8, { color: '#64748b', bold: true, anchor: 'm' });
  cl(top0 + 38, span, Math.min(19, (cw0 * sc - 14) / tw(span, 1, true)), { bold: true, color: '#0f172a', anchor: 'm' });
  cl(top0 + 52, dayName(S.startedAt) + ' ' + ymd(S.startedAt), 7.5, { color: '#334155', anchor: 'm' });
  if (mode === 'peak' && M.pk && M.pk.phf != null) cl(top0 + 64, 'Peak hour factor ' + M.pk.phf.toFixed(3), 7.5, { color: '#334155', anchor: 'm' });
  if (mode === 'nopeak') cl(top0 + 64, 'Less than a full hour counted', 7, { color: '#c2410c', bold: true, anchor: 'm' });

  var ops = D.ops;
  pageHeader(ops, title, lines);
  legendOps(28, 98, 128).forEach(function (p) { ops.push(p); });
  if (S.legs.some(function (l) { return l.removed; })) ops.push({ t: 'text', x: PW - 28, y: 588, s: 'Movements on removed legs are not drawn.', size: 7, color: '#64748b', anchor: 'r' });
  return ops;
}
function volumesIn(M, i0, i1) {
  var m = {}, p = {}, tot = { car: 0, truck: 0, bike: 0, ped: 0 };
  for (var i = i0; i <= i1; i++) {
    var b = M.bins[i]; if (!b) continue;
    Object.keys(b.t).forEach(function (k) {
      var o = b.t[k], key = k.slice(1);
      if (k.charAt(0) === 'm') { var q = m[key] || (m[key] = { car: 0, truck: 0, bike: 0 }); q.car += o.car; q.truck += o.truck; q.bike += o.bike; tot.car += o.car; tot.truck += o.truck; tot.bike += o.bike; }
      else { p[key] = (p[key] || 0) + o.ped; tot.ped += o.ped; }
    });
  }
  return { m: m, p: p, tot: tot };
}

/* table pages: rows = intervals, columns = movements grouped by leg */
function tablePages(M, title, cols, valFn, rowTot) {
  var bins = M.bins, pk = M.pk, multiDay = bins.length && ymd(bins[0].start) !== ymd(bins[bins.length - 1].start);
  var rows = bins.map(function (b, i) {
    var vals = cols.map(function (c) { return valFn(b, c); }), tot = rowTot(b, vals);
    return { label: (multiDay ? ymd(b.start).slice(5) + ' ' : '') + hhmm(b.start) + '–' + hhmm(b.start + BIN), vals: vals, tot: tot, hi: !!(pk && i >= pk.i && i < pk.i + 4) };
  });
  var sum = function (sel) { return cols.map(function (c, j) { return sel.reduce(function (s, r) { return s + r.vals[j]; }, 0); }); };
  var tv = sum(rows), trow = { label: 'Total', vals: tv, tot: rows.reduce(function (s, r) { return s + r.tot; }, 0), bold: true };
  var all = rows.slice(); all.push(trow);
  if (pk) { var pr = rows.slice(pk.i, pk.i + 4); all.push({ label: 'Peak hour ' + hhmm(pk.start) + '–' + hhmm(pk.end), vals: sum(pr), tot: pr.reduce(function (s, r) { return s + r.tot; }, 0), bold: true, hi: true }); }
  var firstW = 92, totW = 40, avail = PW - 56 - firstW - totW, cw = Math.min(46, avail / Math.max(1, cols.length)), left = 28;
  var fs = Math.max(5, Math.min(9, cw / 3.4)), rh = 15, top = 108, perPage = Math.floor((PH - 52 - top) / rh);
  var pages = [], pi = 0;
  do {
    var chunk = all.slice(pi * perPage, (pi + 1) * perPage), ops = [], y = top;
    pageHeader(ops, title + (pi ? ' (continued)' : ''), [ymdw(S.startedAt) + (S.observer ? ' · ' + S.observer : '') + (S.weather ? ' · ' + S.weather : '') + (pk ? ' · shaded rows = peak hour ' + hhmm(pk.start) + '–' + hhmm(pk.end) : '')]);
    // group headers
    var gx = left + firstW, k = 0;
    while (k < cols.length) {
      var h1 = cols[k].h1, span = 1; while (k + span < cols.length && !cols[k + span].h1) span++;
      var wsp = span * cw;
      ops.push({ t: 'text', x: gx + wsp / 2, y: 78, s: fitTxt(h1 || '', 8, true, wsp - 4), size: 8, bold: true, color: '#0f172a', anchor: 'm' });
      ops.push({ t: 'line', x1: gx + 1, y1: 82, x2: gx + wsp - 1, y2: 82, stroke: '#64748b', sw: 1 });
      gx += wsp; k += span;
    }
    var hs = Math.min(fs, 8.5);
    cols.forEach(function (c, j) { var s = c.h2; while (tw(s, hs, true) > cw - 2 && s.length > 3) s = s.slice(0, -1); ops.push({ t: 'text', x: left + firstW + j * cw + cw / 2, y: 95, s: s, size: hs, bold: true, color: '#334155', anchor: 'm' }); });
    ops.push({ t: 'text', x: left, y: 95, s: 'Interval', size: 8.5, bold: true, color: '#334155' });
    ops.push({ t: 'text', x: left + firstW + cols.length * cw + totW - 4, y: 95, s: 'Total', size: 8.5, bold: true, color: '#334155', anchor: 'r' });
    ops.push({ t: 'line', x1: left, y1: 100, x2: left + firstW + cols.length * cw + totW, y2: 100, stroke: '#0f172a', sw: 1 });
    chunk.forEach(function (r) {
      if (r.hi) ops.push({ t: 'rect', x: left, y: y - 11, w: firstW + cols.length * cw + totW, h: rh, fill: '#fef3c7' });
      ops.push({ t: 'text', x: left + 2, y: y, s: r.label, size: 8.5, bold: r.bold, color: '#0f172a' });
      r.vals.forEach(function (v, j) { ops.push({ t: 'text', x: left + firstW + j * cw + cw / 2, y: y, s: String(v), size: fs, bold: r.bold, color: v ? '#0f172a' : '#94a3b8', anchor: 'm' }); });
      ops.push({ t: 'text', x: left + firstW + cols.length * cw + totW - 4, y: y, s: String(r.tot), size: 9, bold: true, color: '#0f172a', anchor: 'r' });
      ops.push({ t: 'line', x1: left, y1: y + 4, x2: left + firstW + cols.length * cw + totW, y2: y + 4, stroke: '#e2e8f0', sw: 0.5 });
      y += rh;
    });
    pages.push(ops); pi++;
  } while (pi * perPage < all.length);
  return pages;
}

function buildPdfPages() {
  var M = exportModel(), pk = M.pk, pages = [], n = M.bins.length;
  var span = hhmm(M.bins[0].start) + '–' + hhmm(M.bins[n - 1].start + BIN);
  var meta = ymdw(S.startedAt) + (S.observer ? ' · ' + S.observer : ''), foot = (S.site || 'Untitled count') + ' · ' + ymdw(S.startedAt) + (S.observer ? ' · ' + S.observer : '');
  var wx = S.weather ? 'Weather: ' + S.weather + ' · ' : '';
  pages.push(diagramPage(M, 0, n - 1, 'Full count — all volumes', [meta, wx + 'Counted ' + span], 'full'));
  if (pk) pages.push(diagramPage(M, pk.i, pk.i + 3, 'Peak hour — ' + hhmm(pk.start) + '–' + hhmm(pk.end), [meta, wx + 'Busiest four consecutive complete 15-minute intervals by cars + heavy vehicles (' + pk.vol + ' vehicles)'], 'peak'));
  else pages.push(diagramPage(M, 0, n - 1, 'Peak hour — not available', [meta, 'A peak hour needs four complete 15-minute intervals in a row; only ' + M.A.nFull + ' complete interval' + (M.A.nFull === 1 ? ' was' : 's were') + ' counted.', 'Showing everything counted (' + span + ') instead.'], 'nopeak'));
  var cell = function (cls) { return function (b, c) { var o = b.t[c.k]; return o ? o[cls] : 0; }; };
  var sumOf = function (v) { return v.reduce(function (s, x) { return s + x; }, 0); };
  [['Cars', 'car'], ['Heavy vehicles', 'truck'], ['Bicycles', 'bike']].forEach(function (t) { pages = pages.concat(tablePages(M, t[0] + ' by movement', M.mcols, cell(t[1]), function (b, v) { return sumOf(v); })); });
  pages = pages.concat(tablePages(M, 'Pedestrians by crosswalk', M.pcols, cell('ped'), function (b, v) { return sumOf(v); }));
  pages.forEach(function (ops, i) {
    ops.push({ t: 'text', x: 28, y: 603, s: foot, size: 8, color: '#94a3b8' });
    ops.push({ t: 'text', x: 764, y: 603, s: 'Page ' + (i + 1) + ' of ' + pages.length, size: 8, color: '#94a3b8', anchor: 'r' });
  });
  return pages;
}

/* ops -> SVG (preview) */
function pagesSVG(ops) {
  var f2 = function (v) { return Math.round(v * 100) / 100; };
  var o = '<svg width="' + PW + '" height="' + PH + '" viewBox="0 0 ' + PW + ' ' + PH + '" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif"><rect width="' + PW + '" height="' + PH + '" fill="#fff"/>';
  ops.forEach(function (p) {
    if (p.t === 'rect') o += '<rect x="' + f2(p.x) + '" y="' + f2(p.y) + '" width="' + f2(p.w) + '" height="' + f2(p.h) + '"' + (p.r ? ' rx="' + f2(p.r) + '"' : '') + ' fill="' + (p.fill || 'none') + '"' + (p.stroke ? ' stroke="' + p.stroke + '" stroke-width="' + (p.sw || 1) + '"' : '') + '/>';
    else if (p.t === 'line') o += '<line x1="' + f2(p.x1) + '" y1="' + f2(p.y1) + '" x2="' + f2(p.x2) + '" y2="' + f2(p.y2) + '" stroke="' + p.stroke + '" stroke-width="' + (p.sw || 1) + '"' + (p.dash ? ' stroke-dasharray="' + p.dash.join(' ') + '"' : '') + '/>';
    else if (p.t === 'poly') o += '<' + (p.close ? 'polygon' : 'polyline') + ' points="' + p.pts.map(function (q) { return f2(q[0]) + ',' + f2(q[1]); }).join(' ') + '" fill="' + (p.fill || 'none') + '"' + (p.stroke ? ' stroke="' + p.stroke + '" stroke-width="' + (p.sw || 1) + '" stroke-linejoin="round" stroke-linecap="round"' : '') + '/>';
    else if (p.t === 'text') o += '<text x="' + f2(p.x) + '" y="' + f2(p.y) + '" font-size="' + p.size + '"' + (p.bold ? ' font-weight="bold"' : '') + ' fill="' + (p.color || '#000') + '"' + (p.anchor === 'm' ? ' text-anchor="middle"' : p.anchor === 'r' ? ' text-anchor="end"' : '') + '>' + esc(p.s) + '</text>';
  });
  return o + '</svg>';
}

/* ops -> PDF file */
function pdfBlob(pages) {
  var f = function (v) { return (Math.round(v * 100) / 100).toString(); };
  var col = function (hex) { var h = (hex || '#000000').replace('#', ''); if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); return [0, 2, 4].map(function (i) { return f(parseInt(h.substr(i, 2), 16) / 255); }).join(' '); };
  var enc = function (s) {
    var o = ''; s = String(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s.charAt(i);
      if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch;
      else if (c < 32) o += ' ';
      else if (c < 127) o += ch;
      else if (c === 0x2013) o += '\\226'; else if (c === 0x2014) o += '\\227'; else if (c === 0x2026) o += '\\205'; else if (c === 0x00B7) o += '\\267';
      else if (c === 0x2192) o += '>'; else if (c === 0x2019) o += '\\222';
      else if (c >= 160 && c <= 255) o += '\\' + ('00' + c.toString(8)).slice(-3);
      else o += '?';
    }
    return o;
  };
  var rr = function (x, Y, w, h, r) {
    var k = 0.5523 * r;
    return f(x + r) + ' ' + f(Y) + ' m ' + f(x + w - r) + ' ' + f(Y) + ' l ' + f(x + w - r + k) + ' ' + f(Y) + ' ' + f(x + w) + ' ' + f(Y + r - k) + ' ' + f(x + w) + ' ' + f(Y + r) + ' c ' +
      f(x + w) + ' ' + f(Y + h - r) + ' l ' + f(x + w) + ' ' + f(Y + h - r + k) + ' ' + f(x + w - r + k) + ' ' + f(Y + h) + ' ' + f(x + w - r) + ' ' + f(Y + h) + ' c ' +
      f(x + r) + ' ' + f(Y + h) + ' l ' + f(x + r - k) + ' ' + f(Y + h) + ' ' + f(x) + ' ' + f(Y + h - r + k) + ' ' + f(x) + ' ' + f(Y + h - r) + ' c ' +
      f(x) + ' ' + f(Y + r) + ' l ' + f(x) + ' ' + f(Y + r - k) + ' ' + f(x + r - k) + ' ' + f(Y) + ' ' + f(x + r) + ' ' + f(Y) + ' c h ';
  };
  var paint = function (p) { return p.fill && p.stroke ? 'B' : p.fill ? 'f' : 'S'; };
  var streams = pages.map(function (ops) {
    var c = '';
    ops.forEach(function (p) {
      if (p.t === 'rect') {
        var Y = PH - (p.y + p.h);
        c += (p.fill ? col(p.fill) + ' rg ' : '') + (p.stroke ? col(p.stroke) + ' RG ' + f(p.sw || 1) + ' w ' : '') + (p.r > 0.5 ? rr(p.x, Y, p.w, p.h, Math.min(p.r, p.w / 2, p.h / 2)) : f(p.x) + ' ' + f(Y) + ' ' + f(p.w) + ' ' + f(p.h) + ' re ') + paint(p) + '\n';
      } else if (p.t === 'line') {
        c += col(p.stroke) + ' RG ' + f(p.sw || 1) + ' w ' + (p.dash ? '[' + p.dash.join(' ') + '] 0 d ' : '') + f(p.x1) + ' ' + f(PH - p.y1) + ' m ' + f(p.x2) + ' ' + f(PH - p.y2) + ' l S' + (p.dash ? ' [] 0 d' : '') + '\n';
      } else if (p.t === 'poly') {
        c += (p.fill ? col(p.fill) + ' rg ' : '') + (p.stroke ? col(p.stroke) + ' RG ' + f(p.sw || 1) + ' w 1 j 1 J ' : '') + p.pts.map(function (q, i) { return f(q[0]) + ' ' + f(PH - q[1]) + (i ? ' l ' : ' m '); }).join('') + (p.close ? 'h ' : '') + paint(p) + '\n';
      } else if (p.t === 'text') {
        var w = tw(p.s, p.size, p.bold), x = p.anchor === 'm' ? p.x - w / 2 : p.anchor === 'r' ? p.x - w : p.x;
        c += 'BT /' + (p.bold ? 'F2' : 'F1') + ' ' + f(p.size) + ' Tf ' + col(p.color) + ' rg ' + f(x) + ' ' + f(PH - p.y) + ' Td (' + enc(p.s) + ') Tj ET\n';
      }
    });
    return c;
  });
  var parts = [], offs = [], len = 0;
  var add = function (s) { parts.push(s); len += s.length; };
  var obj = function (id, s) { offs[id] = len; add(id + ' 0 obj\n' + s + '\nendobj\n'); };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  var kids = pages.map(function (p, i) { return (5 + 2 * i) + ' 0 R'; }).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  streams.forEach(function (c, i) {
    obj(5 + 2 * i, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + 2 * i) + ' 0 R >>');
    obj(6 + 2 * i, '<< /Length ' + c.length + ' >>\nstream\n' + c + 'endstream');
  });
  var nobj = 4 + 2 * pages.length, xo = len, x = 'xref\n0 ' + (nobj + 1) + '\n0000000000 65535 f \n';
  for (var i = 1; i <= nobj; i++) x += ('0000000000' + offs[i]).slice(-10) + ' 00000 n \n';
  add(x + 'trailer\n<< /Size ' + (nobj + 1) + ' /Root 1 0 R >>\nstartxref\n' + xo + '\n%%EOF');
  var all = parts.join(''), bytes = new Uint8Array(all.length);
  for (var j = 0; j < all.length; j++) bytes[j] = all.charCodeAt(j) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}

function svgToPng(svgStr, cb) {
  var img = new Image();
  img.onload = function () {
    try { var c = document.createElement('canvas'); c.width = PW * 2; c.height = PH * 2; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); cb(c.toDataURL('image/png')); } catch (e) { cb(null); }
  };
  img.onerror = function () { cb(null); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
}
function openPdfPreview() {
  var pages, blob, svgs;
  try { pages = buildPdfPages(); blob = pdfBlob(pages); svgs = pages.map(pagesSVG); } catch (e) { toast('Could not build the PDF: ' + (e && e.message || e)); return; }
  var it = { name: fileBase() + '_summary.pdf', mime: 'application/pdf', blob: blob };
  var can = canShareIt(it);
  var top = can ? '<div class="row"><button class="hb dark" data-a="share">Share / Save PDF</button>' + (CAN_DL ? '<a class="ghost lnk" target="_blank">Open</a>' : '') + '</div>'
    : '<p class="hint"><b>Saving the pages:</b> this iPad (iOS 12) cannot send PDF files from a Home Screen app. Touch and hold a page below, then tap <b>Save Image</b> (to Photos) or <b>Share</b> to email or AirDrop it. The Excel / CSV export has the same numbers as tables.</p>';
  openSheet('Summary PDF preview', top + svgs.map(function (sv, i) { return '<div class="pdfpg" data-pg="' + i + '">' + sv + '</div>'; }).join(''), function (box, sheet) {
    var sh = $('.sheet', sheet); if (sh) sh.classList.add('wide');
    var a = box.querySelector('a.lnk'); if (a) { try { a.href = URL.createObjectURL(blob); } catch (e) {} }
    box.addEventListener('click', function (e) { var b = e.target.closest('button[data-a]'); if (b) shareOne(it); });
    if (!can) svgs.forEach(function (sv, i) {   // pictures can be touched-and-held to save or share
      svgToPng(sv, function (url) { var d = box.querySelector('.pdfpg[data-pg="' + i + '"]'); if (url && d) d.innerHTML = '<img alt="Page ' + (i + 1) + '" src="' + url + '">'; });
    });
  });
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
  if (t.dataset.pv != null && t.dataset.pv !== '') { pvTab = +t.dataset.pv; return render(); }
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
    case 'exp1': exportExcel(); break;
    case 'exp2': exportCSVs(); break;
    case 'pdfbtn': openPdfPreview(); break;
    case 'newcount': if (confirm('Start a new count? This one is saved under Past counts.')) startNew(); break;
    case 'hist': openHistory(); break;
    case 'chkupd': toast('Checking…'); checkUpdate(true); break;
  }
});

/* ---------- self-update: no need to delete the app and re-add it ---------- */
var updShown = false;
function applyUpdate() {   // your counts live in local storage and are not touched
  var go = function () { location.reload(); };
  try { if (window.caches) caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).then(go, go); else go(); } catch (e) { go(); }
}
function checkUpdate(manual) {
  if (navigator.onLine === false) { if (manual) toast('No internet — try again when online'); return; }
  fetch('app.js', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
    var m = /APP_VERSION = '([^']+)'/.exec(t);
    if (!m) { if (manual) toast('Could not check right now'); return; }
    if (m[1] === APP_VERSION) { if (manual) toast('You have the latest version (' + APP_VERSION + ')'); return; }
    var tried = ''; try { tried = sessionStorage.getItem('tmc.upd') || ''; } catch (e) {}
    if (view !== 'count' && !$('#sheet') && tried !== m[1]) { try { sessionStorage.setItem('tmc.upd', m[1]); } catch (e) {} applyUpdate(); return; }
    if (updShown) return;
    updShown = true;
    var b = document.createElement('button');
    b.textContent = 'Update available (version ' + m[1].split(' ')[0] + ') — tap to install';
    b.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:60;background:#16a34a;color:#fff;border:0;border-radius:999px;padding:12px 20px;font:700 15px -apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35)';
    b.onclick = function () { try { sessionStorage.removeItem('tmc.upd'); } catch (e) {} applyUpdate(); };
    document.body.appendChild(b);
  }).catch(function () { if (manual) toast('Could not check right now'); });
}
document.addEventListener('visibilitychange', function () { if (!document.hidden) checkUpdate(); });
window.addEventListener('online', function () { checkUpdate(); });
setInterval(checkUpdate, 5 * 60000);
setTimeout(checkUpdate, 2500);

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
