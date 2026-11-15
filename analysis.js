/* Pure counting/analysis logic — no DOM access, so it can be tested in Node. */
(function (root) {
  'use strict';
  var BIN = 15 * 60000;

  // Start (ms) of the clock-aligned 15-minute interval containing t, in local time.
  function binStart(t) {
    var d = new Date(t);
    d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
    return d.getTime();
  }

  // Event shapes:
  //  vehicle:    {t, k:'v', from, to, c:'car'|'truck'|'bus'}   (to === from means U-turn)
  //  bicycle:    {t, k:'b', from, to}
  //  pedestrian: {t, k:'p', from (crosswalk leg), to (neighbouring leg walked toward)}
  function analyze(S, now) {
    if (!S || !S.startedAt) return null;
    var evs = S.events || [];
    var lastT = S.endedAt ? S.endedAt - 1 : (now || Date.now());
    if (lastT < S.startedAt) lastT = S.startedAt;
    for (var q = 0; q < evs.length; q++) if (evs[q].t > lastT) lastT = evs[q].t;

    var first = binStart(S.startedAt), last = binStart(lastT);
    var bins = [], byStart = {};
    for (var b = first; b <= last; b += BIN) {
      var o = { start: b, car: 0, truck: 0, bus: 0, bike: 0, ped: 0, veh: 0 };
      bins.push(o); byStart[b] = o;
    }
    evs.forEach(function (e) {
      var bin = byStart[binStart(e.t)];
      if (!bin) return;
      if (e.k === 'v') bin[e.c]++;
      else if (e.k === 'b') bin.bike++;
      else if (e.k === 'p') bin.ped++;
    });
    bins.forEach(function (x) { x.veh = x.car + x.truck + x.bus; });

    // Peak hour: best 4 consecutive intervals by total vehicles (cars + trucks + buses).
    var peak = null;
    if (bins.length >= 4) {
      for (var i = 0; i + 4 <= bins.length; i++) {
        var vol = bins[i].veh + bins[i + 1].veh + bins[i + 2].veh + bins[i + 3].veh;
        if (!peak || vol > peak.vol) peak = { i: i, vol: vol };
      }
      var w = bins.slice(peak.i, peak.i + 4);
      var sum = function (key) { return w.reduce(function (s, x) { return s + x[key]; }, 0); };
      var maxBin = Math.max.apply(null, w.map(function (x) { return x.veh; }));
      peak.start = w[0].start;
      peak.end = w[3].start + BIN;
      peak.phf = maxBin > 0 ? peak.vol / (4 * maxBin) : null;
      peak.car = sum('car'); peak.truck = sum('truck'); peak.bus = sum('bus');
      peak.bike = sum('bike'); peak.ped = sum('ped');
      peak.heavyPct = peak.vol > 0 ? (peak.truck + peak.bus) / peak.vol : null;
      peak.matrix = {};
      evs.forEach(function (e) {
        if (e.k !== 'v' || e.t < peak.start || e.t >= peak.end) return;
        var key = e.from + '>' + e.to;
        var m = peak.matrix[key] || (peak.matrix[key] = { car: 0, truck: 0, bus: 0, total: 0 });
        m[e.c]++; m.total++;
      });
    }
    return { bins: bins, peak: peak, first: first, last: last };
  }

  var api = { BIN: BIN, binStart: binStart, analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TMC = api;
})(typeof window !== 'undefined' ? window : this);
