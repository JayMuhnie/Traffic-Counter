(function () {
'use strict';
var TMC = window.TMC, analyze = TMC.analyze, binStart = TMC.binStart, BIN = TMC.BIN;

/* ---------- helpers ---------- */
var LS_CUR = 'tmc.current.v1', LS_HIS = 'tmc.history.v1';
var $ = function (s, r) { return (r || document).querySelector(s); };
var uid = function () { return Math.random().toString(36).slice(2, 10); };
var pad = function (n) { return String(n).padStart(2, '0'); };
var hhmm = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
var ymd = function (t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var pct = function (x) { return x == null ? '–' : (x * 100).toFixed(1) + '%'; };

function newStudy(prev) {
  var names = ['North', 'East', 'South', 'West'];
  return {
    id: uid(), site: prev ? prev.site : '', observer: prev ? prev.observer : '',
    created: Date.now(), startedAt: null, endedAt: null,
    legs: (prev ? prev.legs.filter(function (l) { return !l.removed; }).map(function (l) { return l.name; }) : names)
      .map(function (n) { return { id: uid(), name: n, removed: false }; }),
    events: [], notes: []
  };
}
function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v || def; } catch (e) { return def; } }
function persist() { try { localStorage.setItem(LS_CUR, JSON.stringify(S)); } catch (e) {} }
function persistHist() { try { localStorage.setItem(LS_HIS, JSON.stringify(H)); } catch (e) {} }

var S = load(LS_CUR, null) || newStudy();
var H = load(LS_HIS, []);
var mode = 'veh';          // 'veh' | 'b' | 'p'
var cls = 'car';           // car | truck | bus
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

/* ---------- leg editor (used in setup + sheet) ---------- */
function legEditor(box) {
  function draw() {
    var legs = activeLegs();
    box.innerHTML = legs.map(function (l, i) {
      return '<div class="legrow" data-id="' + l.id + '"><input class="ln" value="' + esc(l.name) + '" aria-label="Leg name">' +
        '<button data-a="up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button data-a="down"' + (i === legs.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button data-a="del" class="del"' + (legs.length <= 3 ? ' disabled' : '') + '>✕</button></div>';
    }).join('') +
      '<button data-a="add" class="ghost add">+ Add leg</button>' +
      '<p class="hint">Keep legs in clockwise order around the intersection. Minimum 3 legs.</p>';
  }
  box.addEventListener('input', function (e) {
    if (!e.target.classList.contains('ln')) return;
    var id = e.target.closest('.legrow').dataset.id;
    var l = S.legs.find(function (x) { return x.id === id; });
    if (l) { l.name = e.target.value; persist(); }
  });
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var a = b.dataset.a;
    if (a === 'add') {
      S.legs.push({ id: uid(), name: 'Leg ' + (activeLegs().length + 1), removed: false });
    } else {
      var id = b.closest('.legrow').dataset.id;
      var idx = S.legs.findIndex(function (x) { return x.id === id; });
      if (a === 'del') {
        var used = S.events.some(function (ev) { return ev.from === id || ev.to === id; });
        if (used && !confirm('"' + S.legs[idx].name + '" has recorded counts. They are kept in the data and exports, but the leg disappears from the count screen. Remove it?')) return;
        if (used) S.legs[idx].removed = true; else S.legs.splice(idx, 1);
      } else {
        var dir = a === 'up' ? -1 : 1, j = idx + dir;
        while (j >= 0 && j < S.legs.length && S.legs[j].removed) j += dir;
        if (j < 0 || j >= S.legs.length) return;
        var tmp = S.legs[idx]; S.legs[idx] = S.legs[j]; S.legs[j] = tmp;
      }
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
function render() {
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
    '<p class="foot">Works offline. Counts are saved on this iPad as you tap — export the CSV files after each count.<br>To install: Safari → Share → Add to Home Screen.</p></div>';
  legEditor($('#legs'));
  $('#site').addEventListener('input', function (e) { S.site = e.target.value; persist(); });
  $('#obs').addEventListener('input', function (e) { S.observer = e.target.value; persist(); });
  $('#align').addEventListener('change', function (e) { alignStart = e.target.checked; tick(); });
  tick();
}

function legTag(n, k) {  // right / through / left hints for standard 4-leg intersections
  if (n !== 4) return '';
  return ['Right', 'Through', 'Left'][k] || '';
}
function mvBtn(k, from, to, label, tag, u) {
  return '<button class="mv' + (u ? ' u' : '') + '" data-k="' + k + '" data-from="' + from + '" data-to="' + to + '">' +
    '<span class="tag">' + esc(tag) + '</span><span class="lbl">' + esc(label) + '</span>' +
    '<span class="n" data-key="' + k + '|' + from + '|' + to + '">0</span></button>';
}
function cardsHTML(legs) {
  var n = legs.length;
  return legs.map(function (L, i) {
    var title, inner = '';
    if (mode === 'p') {
      title = 'Crossing ' + L.name;
      [legs[(i - 1 + n) % n], legs[(i + 1) % n]].forEach(function (D) { inner += mvBtn('p', L.id, D.id, '→ toward ' + D.name, '', false); });
    } else {
      title = 'From ' + L.name;
      var k = mode === 'veh' ? 'v' : 'b';
      for (var j = 1; j < n; j++) {            // counter-clockwise from the approach: right, through, left
        var D = legs[(i - j + n) % n];
        inner += mvBtn(k, L.id, D.id, '→ ' + D.name, legTag(n, j - 1), false);
      }
      inner += mvBtn(k, L.id, L.id, 'U-turn', '', true);
    }
    return '<section class="leg"><div class="ct">' + esc(title) + '</div><div class="mvs">' + inner + '</div></section>';
  }).join('');
}

function renderCount() {
  var legs = activeLegs();
  var colour = mode === 'veh' ? 'var(--' + cls + ')' : mode === 'b' ? 'var(--bike)' : 'var(--ped)';
  app.innerHTML =
    '<header class="top"><div class="ti"><div class="site">' + esc(S.site || 'Untitled count') + '</div>' +
    '<div class="sub"><span id="clock"></span> · interval <b id="binlabel"></b></div></div>' +
    '<div class="tot"><span class="pill veh">Veh<b id="tv">0</b></span><span class="pill bike">Bike<b id="tb">0</b></span><span class="pill ped">Ped<b id="tp">0</b></span></div>' +
    '<div class="acts"><button id="notesbtn" class="hb">Notes</button><button id="legsbtn" class="hb">Legs</button><button id="resbtn" class="hb">Results</button><button id="snd" class="hb">' + (soundOn ? '🔊' : '🔇') + '</button><button id="stop" class="hb stop">Stop</button></div>' +
    '<div id="last" class="last"><div id="lasttxt" class="lt"></div><button id="undo" class="hb">↶ Undo</button><button id="recent" class="hb">Recent</button></div></header>' +
    '<div id="banner"></div>' +
    '<nav class="modes">' +
    [['veh', 'Vehicles'], ['b', 'Bicycles'], ['p', 'Pedestrians']].map(function (m) { return '<button data-mode="' + m[0] + '"' + (mode === m[0] ? ' class="on"' : '') + '>' + m[1] + '</button>'; }).join('') + '</nav>' +
    (mode === 'veh' ? '<nav class="classes">' + [['car', 'Car'], ['truck', 'Truck'], ['bus', 'Bus']].map(function (c) { return '<button data-cls="' + c[0] + '"' + (cls === c[0] ? ' class="on"' : '') + '>' + c[1] + '</button>'; }).join('') + '</nav>' : '') +
    '<main id="grid" class="grid" style="--c:' + colour + '">' + cardsHTML(legs) + '</main>';
  keepAwake();
  tick();
}

/* live counts for the current interval */
function binCounts() {
  var bs = binStart(Date.now()), m = {}, tot = { v: 0, b: 0, p: 0 };
  for (var i = S.events.length - 1; i >= 0; i--) {
    var e = S.events[i]; if (e.t < bs) break;
    var key = e.k + '|' + e.from + '|' + e.to;
    m[key] = (m[key] || 0) + 1; tot[e.k]++;
  }
  return { m: m, tot: tot, bs: bs };
}
function tick() {
  var now = Date.now(), ah = $('#alignhint');
  if (ah) ah.textContent = alignStart ? 'Counting will begin at ' + hhmm(nextMark()) + '. Tapping Start before then is fine.' : 'Counting begins the moment you tap Start (the first interval may be partial).';
  if (view !== 'count') return;
  var c = binCounts();
  app.querySelectorAll('.n').forEach(function (el) { el.textContent = c.m[el.dataset.key] || 0; });
  var d = new Date(now);
  $('#clock').textContent = hhmm(now) + ':' + pad(d.getSeconds());
  $('#binlabel').textContent = hhmm(c.bs) + '–' + hhmm(c.bs + BIN);
  $('#tv').textContent = c.tot.v; $('#tb').textContent = c.tot.b; $('#tp').textContent = c.tot.p;
  var left = S.startedAt - now;
  $('#banner').textContent = left > 0 ? 'Count starts at ' + hhmm(S.startedAt) + ' — in ' + Math.floor(left / 60000) + ':' + pad(Math.floor(left / 1000) % 60) : '';
  $('#undo').disabled = !S.events.length;
  updateLast(false);
}
setInterval(tick, 1000);

var hms = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
function kindLabel(e) { return e.k === 'v' ? cap(e.c) : e.k === 'b' ? 'Bike' : 'Pedestrian'; }
function chipCls(e) { return e.k === 'v' ? e.c : e.k === 'b' ? 'bike' : 'ped'; }
function routeLabel(st, e) {
  if (e.k === 'p') return 'Crossing ' + legNameOf(st, e.from) + ' → toward ' + legNameOf(st, e.to);
  return e.from === e.to ? legNameOf(st, e.from) + ' U-turn' : 'From ' + legNameOf(st, e.from) + ' → ' + legNameOf(st, e.to);
}
function describe(st, e) { return hhmm(e.t) + ' ' + kindLabel(e) + ' · ' + routeLabel(st, e); }

/* "last counted" bar */
function updateLast(pulse) {
  var el = $('#last'); if (!el) return;
  var e = S.events[S.events.length - 1], box = $('#lasttxt');
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
        (e.k === 'v' ? '<div class="cs">' + ['car', 'truck', 'bus'].map(function (c) { return '<button class="cb' + (e.c === c ? ' on' : '') + '" data-a="cls" data-c="' + c + '">' + cap(c) + '</button>'; }).join('') + '</div>' : '') +
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
  var ev = { t: now, k: btn.dataset.k, from: btn.dataset.from, to: btn.dataset.to };
  if (ev.k === 'v') ev.c = cls;
  S.events.push(ev); persist(); tick(); updateLast(true);
  sound(ev.k === 'v' ? ev.c : ev.k === 'b' ? 'bike' : 'ped');
  btn.classList.add('hit'); setTimeout(function () { btn.classList.remove('hit'); }, 110);
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
      var v = m ? m.total : 0, h = m ? m.truck + m.bus : 0;
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
  var tot = A.bins.reduce(function (s, b) { s.car += b.car; s.truck += b.truck; s.bus += b.bus; s.veh += b.veh; s.bike += b.bike; s.ped += b.ped; return s; }, { car: 0, truck: 0, bus: 0, veh: 0, bike: 0, ped: 0 });
  var warns = [];
  if (running) warns.push('Count still in progress — the current interval is incomplete.');
  if (binStart(S.startedAt) !== S.startedAt) warns.push('Count started at ' + hhmm(S.startedAt) + ', so the first interval is partial.');
  if (S.endedAt && Math.abs(binStart(S.endedAt) - S.endedAt) > 5000 && Math.abs(binStart(S.endedAt) + BIN - S.endedAt) > 5000) warns.push('Count stopped at ' + hhmm(S.endedAt) + ', so the last interval is partial.');
  if (!pk) warns.push('Peak hour needs at least four 15-minute intervals (one full hour).');

  var peakKpis = pk ?
    '<div class="kpi"><small>Peak hour</small><b>' + hhmm(pk.start) + '–' + hhmm(pk.end) + '</b></div>' +
    '<div class="kpi"><small>Peak-hour vehicles</small><b>' + pk.vol + '</b></div>' +
    '<div class="kpi"><small>Peak hour factor</small><b>' + (pk.phf == null ? '–' : pk.phf.toFixed(2)) + '</b></div>' +
    '<div class="kpi"><small>Heavy vehicles</small><b>' + pct(pk.heavyPct) + '</b><small>' + pk.truck + ' trucks · ' + pk.bus + ' buses</small></div>' +
    '<div class="kpi"><small>Bikes / peds in peak</small><b>' + pk.bike + ' / ' + pk.ped + '</b></div>' : '';

  var rows = A.bins.map(function (b, i) {
    var inPk = pk && i >= pk.i && i < pk.i + 4;
    return '<tr' + (inPk ? ' class="pk"' : '') + '><td>' + hhmm(b.start) + '–' + hhmm(b.start + BIN) + '</td><td>' + b.car + '</td><td>' + b.truck + '</td><td>' + b.bus + '</td><td><b>' + b.veh + '</b></td><td>' + b.bike + '</td><td>' + b.ped + '</td></tr>';
  }).join('');

  app.innerHTML =
    '<div class="page"><h1>' + esc(S.site || 'Untitled count') + '</h1>' +
    '<p class="hint">' + ymd(S.startedAt) + (S.observer ? ' · ' + esc(S.observer) : '') + '</p>' +
    warns.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') +
    '<div class="kpis">' + peakKpis + '</div>' +
    '<div class="card"><h2>15-minute intervals</h2><p class="hint">Highlighted rows are the peak hour.</p><div class="scroll"><table><thead><tr><th>Interval</th><th>Car</th><th>Truck</th><th>Bus</th><th>Vehicles</th><th>Bike</th><th>Ped</th></tr></thead><tbody>' + rows +
    '</tbody><tfoot><tr><td>Total</td><td>' + tot.car + '</td><td>' + tot.truck + '</td><td>' + tot.bus + '</td><td>' + tot.veh + '</td><td>' + tot.bike + '</td><td>' + tot.ped + '</td></tr></tfoot></table></div></div>' +
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
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
}
function exportIntervals() {
  var A = analyze(S), pk = A.peak;
  var rows = [['Site', 'Date', 'Observer', 'Interval start', 'Interval end', 'Cars', 'Trucks', 'Buses', 'Vehicles total', 'Bicycles', 'Pedestrians', 'In peak hour']];
  A.bins.forEach(function (b, i) {
    rows.push([S.site, ymd(b.start), S.observer, hhmm(b.start), hhmm(b.start + BIN), b.car, b.truck, b.bus, b.veh, b.bike, b.ped, pk && i >= pk.i && i < pk.i + 4 ? 'Y' : '']);
  });
  rows.push([]);
  if (pk) {
    rows.push(['Peak hour (all vehicles)', hhmm(pk.start) + '-' + hhmm(pk.end)]);
    rows.push(['Peak hour volume', pk.vol]);
    rows.push(['Peak hour factor', pk.phf == null ? '' : pk.phf.toFixed(3)]);
    rows.push(['Heavy vehicle share', pk.heavyPct == null ? '' : (pk.heavyPct * 100).toFixed(1) + '%']);
  } else rows.push(['Peak hour', 'n/a (fewer than 4 intervals)']);
  var ns = S.notes || [];
  if (ns.length) { rows.push([]); rows.push(['Notes']); rows.push(['Date', 'Time', 'Note']); ns.forEach(function (n) { rows.push([ymd(n.t), hhmm(n.t), n.text]); }); }
  share(fileBase() + '_intervals.csv', csv(rows));
}
function exportMovements() {
  var agg = {};
  S.events.forEach(function (e) {
    var bs = binStart(e.t), md = e.k === 'v' ? 'Vehicle' : e.k === 'b' ? 'Bicycle' : 'Pedestrian';
    var cl = e.k === 'v' ? cap(e.c) : '';
    var key = [bs, md, e.from, e.to, cl].join('|');
    agg[key] = (agg[key] || 0) + 1;
  });
  var rows = [['Site', 'Date', 'Interval start', 'Interval end', 'Mode', 'From leg (crosswalk leg for pedestrians)', 'To leg (walking toward, for pedestrians)', 'Class', 'Count']];
  Object.keys(agg).map(function (k) { return k.split('|'); })
    .sort(function (a, b) { return (a[0] - b[0]) || a[1].localeCompare(b[1]) || legNameOf(S, a[2]).localeCompare(legNameOf(S, b[2])) || legNameOf(S, a[3]).localeCompare(legNameOf(S, b[3])) || a[4].localeCompare(b[4]); })
    .forEach(function (p) {
      var bs = +p[0];
      rows.push([S.site, ymd(bs), hhmm(bs), hhmm(bs + BIN), p[1], legNameOf(S, p[2]), p[2] === p[3] ? 'U-turn' : legNameOf(S, p[3]), p[4], agg[p.join('|')]]);
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
  S = newStudy(S); persist(); mode = 'veh'; cls = 'car'; view = 'setup'; render();
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
  var t = e.target.closest('button'); if (!t) return;
  if (t.classList.contains('mv')) return tap(t);
  if (t.dataset.mode) { mode = t.dataset.mode; return render(); }
  if (t.dataset.cls) { cls = t.dataset.cls; return render(); }
  switch (t.id) {
    case 'start':
      if (activeLegs().length < 3) { toast('An intersection needs at least 3 legs'); return; }
      audio(); S.startedAt = alignStart ? nextMark() : Date.now(); S.endedAt = null;
      persist(); view = 'count'; render(); break;
    case 'undo': undo(); break;
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
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
