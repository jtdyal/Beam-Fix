'use strict';
// Compare the browser engine against the 3-D reference results (reference/results.json).
// Run:  node reference/compare.js
const fs = require('fs'), path = require('path');
const BF = require('../docs/engine.js');
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'))).cases;
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json')));
const refBy = Array.isArray(ref) ? Object.fromEntries(ref.map(r => [r.name, r])) : (ref.cases || ref);

function toParams(c) {
  const P = BF.defaults();
  P.beam.b = c.beam.b; P.beam.d = c.beam.d; P.beam.Ltot = c.beam.Ltot; P.beam.bearing = c.beam.bearing;
  P.beam.E = c.beam.E; P.beam.GoverE = c.beam.G_over_E; P.beam.shear = true;
  P.notch = Object.assign({}, c.notch);
  P.plates.forEach(p => p.on = false);
  c.plates.forEach((p, i) => {
    Object.assign(P.plates[i], { on: true, t: p.t, h: p.h, yb: p.yb, len: p.x1 - p.x0, offset: (p.x0 + p.x1) / 2 - c.beam.Ltot / 2 });
  });
  P.fast = Object.assign(P.fast, { type: 'bolt', size: '1/2', rows: 2, pitch: 8, edge: 4 });
  if (c.plates.length) P.fast.slipMult = c.plates[0].K_x / BF.slipModulus(0.5);
  return P;
}
let worst = 0;
console.log('case'.padEnd(24), 'sag_mid js/ref', '   js-vs-ref%', ' sag_max js/ref', '   js-vs-ref%', '  Fmax(FE smeared)/ref');
cases.forEach(c => {
  const P = toParams(c);
  const r = BF.solve(P, c.load.w_lb_per_in, { notch: c.notch.enabled, plates: [c.plates.length > 0, c.plates.length > 1] });
  const R = refBy[c.name]; if (!R) { console.log(c.name, 'no reference result'); return; }
  const dm = 100 * (r.midSag - R.delta_mid) / R.delta_mid, dx = 100 * (r.maxSag - R.delta_max) / R.delta_max;
  const fmax = r.plates.length ? Math.max(...r.plates.map(p => p.Fmax)) : 0;
  worst = Math.max(worst, Math.abs(dm), Math.abs(dx));
  console.log(c.name.padEnd(24), r.midSag.toFixed(4) + '/' + R.delta_mid.toFixed(4), dm.toFixed(2).padStart(7), ' ', r.maxSag.toFixed(4) + '/' + R.delta_max.toFixed(4), dx.toFixed(2).padStart(7), '  ', fmax.toFixed(0) + '/' + (R.max_spring_force_x !== undefined ? Number(R.max_spring_force_x).toFixed(0) : '?'));
});
console.log('worst deflection difference: ' + worst.toFixed(2) + '%');
