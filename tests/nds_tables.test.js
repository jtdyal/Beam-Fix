'use strict';
// Checks the fastener model against reference lateral design values tabulated in the user's copy of NDS 2015
// (Tables 12D, 12I, 12K, 12P; Southern Pine G = 0.55, 1/4" A36 steel side plate unless noted).
const BF = require('../docs/engine.js');
let fail = 0, n = 0;
function check(label, got, want) {
  n++; const tol = Math.max(0.02 * want, 8);
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(44) + 'engine ' + got.toFixed(0).padStart(5) + '   table ' + String(want).padStart(5) + '   ' + (100 * (got - want) / want).toFixed(1) + '%');
}
const P = BF.defaults(); P.fast.G = 0.55;

// Table 12D: bolts, single shear, glulam main member 3" thick, 1/4" A36 side plate (Z|| , Z-perp)
{ const t = { '1/2': [860, 540], '5/8': [1260, 610], '3/4': [1610, 670], '7/8': [1880, 740], '1': [2150, 790] };
  Object.keys(t).forEach(d => { const Q = BF.clone(P); Q.fast.type = 'bolt'; Q.fast.size = d;
    const c = BF.fastenerCapacity(Q, { plateT: 0.25, double: false, lm: 3 });
    check('12D bolt ' + d + '" Z||', c.Zref, t[d][0]); check('12D bolt ' + d + '" Z-perp', c.ZrefPerp, t[d][1]); }); }
// Table 12I: bolts, double shear, main member 3", two 1/4" A36 side plates
{ const t = { '1/2': [1720, 1100], '5/8': [2510, 1220], '3/4': [3460, 1330], '7/8': [4040, 1440], '1': [4610, 1530] };
  Object.keys(t).forEach(d => { const Q = BF.clone(P); Q.fast.type = 'bolt'; Q.fast.size = d;
    const c = BF.fastenerCapacity(Q, { plateT: 0.25, double: true, lm: 3 });
    check('12I bolt ' + d + '" Z|| (double)', c.Zref, t[d][0]); check('12I bolt ' + d + '" Z-perp (double)', c.ZrefPerp, t[d][1]); }); }
// Table 12K: lag screws, single shear, 1/4" A36 side plate, penetration p = 8D (reduced-body diameters per Table L2)
{ const t = { '1/4': [220, 160], '5/16': [280, 200], '3/8': [290, 190], '7/16': [440, 280], '1/2': [540, 340], '5/8': [780, 470], '3/4': [1100, 640] };
  Object.keys(t).forEach(d => { const Q = BF.clone(P); Q.fast.type = 'lag'; Q.fast.size = d;
    const Dn = BF.LAGS[d].D;
    const c = BF.fastenerCapacity(Q, { plateT: 0.25, double: false, lm: 8 * Dn });
    check('12K lag ' + d + '" Z||', c.Zref, t[d][0]); check('12K lag ' + d + '" Z-perp', c.ZrefPerp, t[d][1]); }); }
// Table 12P: common nails, 0.105" (12 ga) ASTM A653 Gr.33 side plate (Fe = 61,850 psi), p = 10D, SP
{ const t = { '8d': 116, '10d': 137, '16d': 161, '20d': 189, '30d': 205, '40d': 223, '60d': 230 };
  Object.keys(t).forEach(k => { const Q = BF.clone(P); Q.fast.type = 'nail'; Q.fast.nail = k;
    const D = BF.NAILS[k].D;
    const c = BF.fastenerCapacity(Q, { plateT: 0.105, double: false, lm: 10 * D, fes: 61850 });
    check('12P nail ' + k + ' (' + D + '") Z', c.Zref, t[k]); }); }
console.log(fail ? fail + ' of ' + n + ' FAILED' : 'ALL ' + n + ' TABLE CHECKS PASSED');
process.exit(fail ? 1 : 0);
