/* On-device test tools. Everything here is checked against numbers worked out independently (in Python) and written down as constants,
   so the app's own counting code never grades itself. */
(function () {
'use strict';
var TMC = window.TMC, BIN = TMC.BIN, binStart = TMC.binStart, analyze = TMC.analyze;
var pad = function (n) { return String(n).padStart(2, '0'); };
var hhmm = function (t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

/* ---- 1. demo count: 183 taps over 07:00-08:15 made by a fixed pseudo-random recipe; the answer key comes from a separate Python program ---- */
var DEMO = { bins: [[22, 3, 1, 2], [37, 7, 4, 5], [25, 8, 1, 4], [20, 3, 5, 2], [22, 8, 1, 3]],   // per 15 min: cars, heavy, bikes, peds
  peakIdx: 1, peakVol: 130, phf: 0.7386, peakTruck: 26, tot: [126, 29, 12, 16], n: 183 };
var LEGS = [{ id: 'n', name: 'North', angle: 0 }, { id: 'e', name: 'East', angle: 90 }, { id: 's', name: 'South', angle: 180 }, { id: 'w', name: 'West', angle: 270 }];
function demoStart() { return new Date(2026, 2, 3, 7, 0, 0, 0).getTime(); }
function demoStudy() {
  var s = 20261117, ids = ['n', 'e', 's', 'w'], t0 = demoStart(), ev = [];
  var nx = function () { s = (s * 16807) % 2147483647; return s; };
  for (var b = 0; b < 5; b++) {
    var n = 25 + nx() % 30;
    for (var i = 0; i < n; i++) {
      var t = t0 + b * BIN + nx() % BIN, r = nx() % 100, f = ids[nx() % 4], k, c = null, to;
      if (r < 72) { k = 'v'; c = 'car'; } else if (r < 86) { k = 'v'; c = 'truck'; } else if (r < 93) k = 'b'; else k = 'p';
      if (k === 'p') to = ids[(ids.indexOf(f) + (nx() % 2 ? 1 : 3)) % 4];
      else { var u = nx() % 100; if (u < 3) to = f; else { var o = ids.filter(function (x) { return x !== f; }); to = o[nx() % 3]; } }
      var e = { t: t, k: k, from: f, to: to }; if (k === 'v') e.c = c; ev.push(e);
    }
  }
  ev.sort(function (a, b) { return a.t - b.t; });
  return { id: 'demo' + Date.now(), site: 'TEST — demo count', observer: 'Test', weather: 'Overcast, 4°C', created: Date.now(), startedAt: t0, endedAt: t0 + 5 * BIN,
    legs: LEGS.map(function (l) { return { id: l.id, name: l.name, angle: l.angle, removed: false }; }), events: ev, notes: [], test: { kind: 'demo', shift: 0 } };
}

/* ---- 2. time-jump recipe: what to tap in each interval (from leg, to leg, class, how many) ---- */
var JR = [
  [['N', 'S', 'car', 5], ['N', 'E', 'car', 2], ['E', 'W', 'car', 3], ['S', 'N', 'truck', 1], ['W', 'E', 'bike', 2], ['pN', 'E', 'ped', 1]],
  [['N', 'S', 'car', 4], ['S', 'N', 'car', 6], ['S', 'W', 'car', 1], ['E', 'W', 'truck', 2], ['W', 'N', 'car', 3], ['S', 'N', 'bike', 1], ['pE', 'S', 'ped', 2]],
  [['N', 'S', 'car', 7], ['E', 'W', 'car', 5], ['W', 'E', 'car', 4], ['N', 'W', 'car', 2], ['S', 'N', 'truck', 1], ['N', 'S', 'bike', 1], ['pW', 'N', 'ped', 1]],
  [['N', 'S', 'car', 3], ['S', 'N', 'car', 3], ['E', 'S', 'car', 2], ['W', 'E', 'truck', 2], ['E', 'W', 'car', 4], ['pS', 'W', 'ped', 2], ['E', 'W', 'bike', 2]],
  []
];
var NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }, ANG = { N: 0, E: 90, S: 180, W: 270 };
function turnName(f, t) { var d = (ANG[t] - ANG[f] + 360) % 360; return d === 0 ? 'U-turn' : d === 90 ? 'Left' : d === 180 ? 'Thru' : 'Right'; }
function jumpExpected() {
  var bins = JR.map(function (iv) { var o = [0, 0, 0, 0]; iv.forEach(function (r) { o[r[2] === 'car' ? 0 : r[2] === 'truck' ? 1 : r[2] === 'bike' ? 2 : 3] += r[3]; }); return o; });
  return summarise(bins, 1);
}
function summarise(bins, lastPartial) {   // answer key arithmetic: peak = best 4 complete intervals in a row
  var veh = bins.map(function (b) { return b[0] + b[1]; }), best = -1, bv = -1, nfull = bins.length - (lastPartial || 0);
  for (var i = 0; i + 4 <= nfull; i++) { var v = veh[i] + veh[i + 1] + veh[i + 2] + veh[i + 3]; if (v > bv) { bv = v; best = i; } }
  var o = { bins: bins, peakIdx: best, peakVol: bv, tot: [0, 0, 0, 0] };
  bins.forEach(function (b) { for (var j = 0; j < 4; j++) o.tot[j] += b[j]; });
  if (best >= 0) { var w = bins.slice(best, best + 4), mx = Math.max.apply(null, w.map(function (b) { return b[0] + b[1]; })); o.phf = bv / (4 * mx); o.peakTruck = w.reduce(function (s, b) { return s + b[1]; }, 0); }
  return o;
}
function recipeHTML() {
  var h = '<p class="hint">Tap exactly this in each interval. Heavy vehicle and Bike: pick the class first, then tap the movement. Pedestrians: tap the crosswalk arrow on that leg.</p>';
  JR.forEach(function (iv, i) {
    if (!iv.length) { h += '<p><b>Interval 5:</b> tap <b>+15</b>, then <b>Stop</b> immediately (nothing to count).</p>'; return; }
    h += '<p><b>Interval ' + (i + 1) + (i ? ' (after tapping +15)' : '') + ':</b><br>' + iv.map(function (r) {
      if (r[2] === 'ped') return r[3] + '× pedestrians on the ' + NAMES[r[0].charAt(1)] + ' crosswalk walking toward ' + NAMES[r[1]];
      return r[3] + '× ' + (r[2] === 'car' ? 'Car' : r[2] === 'truck' ? 'Heavy vehicle' : 'Bike') + ' from ' + NAMES[r[0]] + ' — ' + turnName(r[0], r[1]) + ' (to ' + NAMES[r[1]] + ')';
    }).join('<br>') + '</p>';
  });
  return h;
}

/* ---- 3. comparison card shown on the results page of a test count ---- */
function compare(S, expected, lastPartial) {
  var A = analyze(S, S.endedAt || Date.now()), rows = [], allOk = true, ok = function (b) { if (!b) allOk = false; return b ? '✓' : '✗ MISMATCH'; };
  var names = ['Cars', 'Heavy', 'Bikes', 'Peds'], n = expected.bins.length;
  rows.push(['Number of intervals', n, A.bins.length, ok(A.bins.length === n)]);
  A.bins.forEach(function (b, i) {
    var got = [b.car, b.truck, b.bike, b.ped], e = expected.bins[i] || [0, 0, 0, 0];
    rows.push([hhmm(b.start) + ' · ' + names.join('/'), e.join(' / '), got.join(' / '), ok(got.join() === e.join())]);
  });
  rows.push(['Totals · ' + names.join('/'), expected.tot.join(' / '), [0, 1, 2, 3].map(function (j) { return A.bins.reduce(function (s, b) { return s + [b.car, b.truck, b.bike, b.ped][j]; }, 0); }).join(' / '), null]);
  rows[rows.length - 1][3] = ok(rows[rows.length - 1][1] === rows[rows.length - 1][2]);
  var pk = A.peak;
  if (expected.peakIdx >= 0) {
    rows.push(['Peak hour starts', hhmm(binStart(S.startedAt) + expected.peakIdx * BIN), pk ? hhmm(pk.start) : 'none', ok(!!pk && pk.start === binStart(S.startedAt) + expected.peakIdx * BIN)]);
    rows.push(['Vehicles in peak hour', expected.peakVol, pk ? pk.vol : '–', ok(!!pk && pk.vol === expected.peakVol)]);
    rows.push(['Peak hour factor', expected.phf.toFixed(2), pk && pk.phf != null ? pk.phf.toFixed(2) : '–', ok(!!pk && pk.phf != null && Math.abs(pk.phf - expected.phf) < 0.0001)]);
    rows.push(['Heavy vehicles in peak hour', expected.peakTruck, pk ? pk.truck : '–', ok(!!pk && pk.truck === expected.peakTruck)]);
  } else rows.push(['Peak hour', 'none', pk ? 'found' : 'none', ok(!pk)]);
  var h = '<div class="card tcheck"><h2>Test check — ' + (allOk ? '<span style="color:#15803d">ALL MATCH ✓</span>' : '<span style="color:#b91c1c">MISMATCH ✗</span>') + '</h2>' +
    '<p class="hint">' + (S.test.kind === 'jump' ? 'Compares your taps with what the recipe says the answer must be. A mismatch means a missed/extra tap (check Recent) or an app error.' : 'The demo count was generated automatically, so any mismatch is an app error.') + ' This test count is not saved in Past counts.</p>' +
    '<table class="xpv"><tr><th>Check</th><th>Expected</th><th>App shows</th><th></th></tr>' +
    rows.map(function (r) { return '<tr' + (String(r[3]).charAt(0) === '✗' ? ' style="background:#fee2e2"' : '') + '><td style="text-align:left">' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>'; }).join('') + '</table></div>';
  return h;
}
function checkCard(S) {
  if (!S || !S.test) return '';
  if (S.test.kind === 'demo') return compare(S, summarise(DEMO.bins, 0), 0);
  if (S.test.kind === 'jump') return compare(S, jumpExpected(), 1);
  return '';
}

/* ---- 4. automatic self-test, run by this iPad's own JavaScript engine ---- */
function runSelf(I) {
  var out = [], T = function (name, cond, info) { out.push({ name: name, ok: !!cond, info: info || '' }); };
  try {
    var d = new Date(2026, 2, 3, 7, 14, 59, 999).getTime(), d2 = new Date(2026, 2, 3, 7, 15, 0, 0).getTime();
    T('Interval boundary 07:14:59.999 is in the 07:00 interval', binStart(d) === new Date(2026, 2, 3, 7, 0, 0, 0).getTime());
    T('Interval boundary 07:15:00.000 starts the 07:15 interval', binStart(d2) === d2);
    T('Midnight: 23:59:59.999 stays in the 23:45 interval', binStart(new Date(2026, 2, 3, 23, 59, 59, 999).getTime()) === new Date(2026, 2, 3, 23, 45, 0, 0).getTime());
    var st = demoStudy(), A = analyze(st), E = summarise(DEMO.bins, 0);
    T('Demo count has ' + DEMO.n + ' taps', st.events.length === DEMO.n, st.events.length);
    T('5 intervals found', A.bins.length === 5, A.bins.length);
    var binsOk = A.bins.every(function (b, i) { return [b.car, b.truck, b.bike, b.ped].join() === DEMO.bins[i].join(); });
    T('Cars / heavy / bikes / peds correct in every interval', binsOk, A.bins.map(function (b) { return [b.car, b.truck, b.bike, b.ped].join('/'); }).join('  '));
    var pk = A.peak;
    T('Peak hour is 07:15–08:15', pk && hhmm(pk.start) === '07:15' && hhmm(pk.end) === '08:15', pk && hhmm(pk.start));
    T('Peak hour vehicles = ' + DEMO.peakVol, pk && pk.vol === DEMO.peakVol, pk && pk.vol);
    T('Peak hour factor = ' + DEMO.phf.toFixed(2), pk && Math.abs(pk.phf - DEMO.phf) < 1e-4, pk && pk.phf);
    T('Heavy vehicles in peak hour = ' + DEMO.peakTruck, pk && pk.truck === DEMO.peakTruck, pk && pk.truck);
    var sheets = I.withStudy(st, function () { return I.buildSheets(); });
    T('4 export tables (Cars, Heavy vehicles, Bikes, Pedestrians)', sheets.length === 4 && sheets.map(function (s) { return s.name; }).join() === 'Cars,Heavy vehicles,Bikes,Pedestrians', sheets.map(function (s) { return s.name; }).join());
    sheets.forEach(function (sh, j) {
      var rows = sh.rows, last = rows[rows.length - 1], body = rows.slice(3, rows.length - 1);
      T(sh.name + ': 5 interval rows', body.length === 5, body.length);
      T(sh.name + ': grand total = ' + DEMO.tot[j], last[last.length - 1] === DEMO.tot[j], last[last.length - 1]);
      T(sh.name + ': every row adds up to its interval total', body.every(function (r, i) { return r[r.length - 1] === DEMO.bins[i][j]; }));
      var t = 0; for (var c = 3; c < last.length - 1; c++) if (rows[2][c] !== 'Total') t += last[c];
      T(sh.name + ': movement columns add up to the grand total', t === DEMO.tot[j], t);
    });
    var xb = I.withStudy(st, function () { return I.xlsxBlob(sheets); });
    T('Excel file built', xb && xb.size > 1500, xb && xb.size + ' bytes');
    var cv = I.csv(sheets[0].rows);
    T('CSV text built', cv.split('\n').length >= 7, cv.split('\n').length + ' lines');
    var pages = I.withStudy(st, function () { return I.buildPdfPages(); });
    T('Summary PDF has 6 pages', pages.length === 6, pages.length);
    var pb = I.pdfBlob(pages);
    T('PDF file built', pb && pb.size > 3000, pb && pb.size + ' bytes');
    var st2 = demoStudy(); st2.endedAt = st2.startedAt + 3 * BIN - 120000;   // stopped two minutes early: last interval partial, no full hour
    var A2 = analyze(st2);
    T('A short count has no peak hour (needs 4 complete intervals)', A2.peak === null && A2.nFull === 2, 'complete intervals: ' + A2.nFull);
    T('Local time zone offset reads sensibly', Math.abs(new Date().getTimezoneOffset()) <= 840, new Date().getTimezoneOffset() + ' min');
  } catch (e) { T('Self-test crashed', false, (e && e.message) || String(e)); }
  return out;
}

window.TMC_T = { demoStudy: demoStudy, recipeHTML: recipeHTML, checkCard: checkCard, runSelf: runSelf, DEMO: DEMO };
})();
