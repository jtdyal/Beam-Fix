'use strict';
const BF = require('../docs/engine.js');
let fail = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-12);

const P = BF.defaults();
const b = P.beam, L = b.Ltot - b.bearing, E = b.E, I = b.b * Math.pow(b.d, 3) / 12, A = b.b * b.d;
const none = { notch: false, plates: [false, false] };

// 1. baseline vs Timoshenko closed form
{
  const w = 20;
  const r = BF.solve(P, w, none);
  const Eb = BF.Ebend(P), G = Eb * b.GoverE;   // shear-free E = 1.05 x tabulated (NDS App. F.3.1)
  const exact = 5 * w * Math.pow(L, 4) / (384 * Eb * I) + w * L * L / (8 * (5 / 6) * G * A);
  ok('baseline UDL deflection = Timoshenko closed form', close(r.maxSag, exact, 0.002), r.maxSag.toFixed(5) + ' vs ' + exact.toFixed(5));
  const app = 5 * w * Math.pow(L, 4) / (384 * E * I);
  ok('apparent-E check: modelled sag ~ 5wL^4/384EI with tabulated E (within 1%)', close(r.maxSag, app, 0.01), r.maxSag.toFixed(5) + ' vs ' + app.toFixed(5));
  const Mmax = r.el.reduce((m, e) => Math.max(m, e.Mtot), 0);
  ok('internal moment equals static M (midspan)', close(Mmax, w * L * L / 8, 0.005), Mmax.toFixed(0) + ' vs ' + (w * L * L / 8).toFixed(0));
  const Q = BF.clone(P); Q.beam.shear = false;
  const r2 = BF.solve(Q, w, none);
  ok('shear off -> Euler-Bernoulli', close(r2.maxSag, 5 * w * Math.pow(L, 4) / (384 * E * I), 0.002));
}
// 2. stiff fasteners, centred full-height plate -> transformed EI
{
  const Q = BF.clone(P); Q.notch.enabled = false; Q.fast.slipMult = 1e5; Q.fast.pitch = 4; Q.fast.edge = 2; Q.beam.shear = false;
  const t = 0.25; Q.plates[0].t = t; Q.plates[0].len = 228;
  const w = 20;
  const r = BF.solve(Q, w, {});
  const EIt = E * I + Q.steel.E * t * Math.pow(Q.beam.d, 3) / 12 + Q.steel.E * 0 ;
  // plate sits beside beam, same neutral axis: EI = E I + Es I_p
  const exact = 5 * w * Math.pow(L, 4) / (384 * EIt);
  // plate only spans 228 (supports at 231.5 apart) so compare approx
  ok('rigid fasteners: full composite EI (within 3%, finite plate length)', close(r.maxSag, exact, 0.03), r.maxSag.toFixed(5) + ' vs ' + exact.toFixed(5));
}
// 2b. eccentric plate, stiff fasteners -> parallel-axis composite EI
{
  const Q = BF.clone(P); Q.notch.enabled = false; Q.fast.slipMult = 1e5; Q.fast.pitch = 4; Q.fast.edge = 1; Q.beam.shear = false;
  Q.plates[0].t = 0.5; Q.plates[0].h = 6; Q.plates[0].yb = 0; Q.plates[0].len = 231.5;
  Q.fast.rows = 1;
  const w = 20, Es = Q.steel.E, t = 0.5, h = 6;
  const Ap = t * h, Ip = t * h * h * h / 12, Aw = A, e = (h / 2) - Q.beam.d / 2;
  const EIc = E * I + Es * Ip + (E * Aw) * (Es * Ap) / (E * Aw + Es * Ap) * e * e;
  const r = BF.solve(Q, w, {});
  const exact = 5 * w * Math.pow(L, 4) / (384 * EIc);
  ok('eccentric plate, rigid fasteners: parallel-axis EI (within 3%)', close(r.maxSag, exact, 0.03), r.maxSag.toFixed(5) + ' vs ' + exact.toFixed(5));
  const Q2 = BF.clone(Q); Q2.fast.slipMult = 1e-9;
  const r2 = BF.solve(Q2, w, {});
  ok('eccentric plate, no slip transfer: EI = EIw + EsIp', close(r2.maxSag, 5 * w * Math.pow(L, 4) / (384 * (E * I + Es * Ip)), 0.01), r2.maxSag.toFixed(5));
}
// 3. no fasteners at all: plate shares curvature only (E_s I_p parallel)
{
  const Q = BF.clone(P); Q.notch.enabled = false; Q.fast.rows = 0; Q.beam.shear = false;
  Q.plates[0].len = 231.5; Q.plates[0].t = 0.25;
  Q.fast.rows = 1; Q.fast.slipMult = 1e-9; // essentially no slip transfer
  const w = 20;
  const r = BF.solve(Q, w, {});
  const EIt = E * I + Q.steel.E * 0.25 * Math.pow(13.5, 3) / 12;
  ok('no slip transfer: EI = EI_wood + Es*Ip', close(r.maxSag, 5 * w * Math.pow(L, 4) / (384 * EIt), 0.01), r.maxSag.toFixed(5));
}
// 4. notch increases deflection, plate decreases it
{
  const a = BF.analyze(P);
  ok('notch increases sag', a.damaged.maxSag > a.baseline.maxSag, a.baseline.maxSag.toFixed(4) + ' -> ' + a.damaged.maxSag.toFixed(4));
  ok('plate reduces sag vs damaged', a.repaired.maxSag < a.damaged.maxSag, a.repaired.maxSag.toFixed(4));
  ok('baseline sag equals 5/8" limit by construction', close(a.baseline.maxSag, 0.625, 1e-6));
  console.log('  w =', a.wPlf.toFixed(1), 'plf');
  console.log('  sag baseline/damaged/repaired =', a.baseline.maxSag.toFixed(4), a.damaged.maxSag.toFixed(4), a.repaired.maxSag.toFixed(4));
  console.log('  max fastener force =', a.checks.fasteners.map(f => f.demand.toFixed(0) + ' lb vs Zadj ' + f.cap.Zadj.toFixed(0) + ' (mode ' + f.cap.mode + ')'));
}
// 5. fastener capacity sanity (1/2" bolt in 3.5" SP w/ 1/4" steel, single shear)
{
  const Q = BF.clone(P); Q.fast.type = 'bolt'; Q.fast.size = '1/2';
  const c = BF.fastenerCapacity(Q, { plateT: 0.25, double: false });
  console.log('  1/2" bolt single shear Z =', c.Zref.toFixed(0), 'mode', c.mode);
  ok('bolt Z in plausible range (800-1600 lb)', c.Zref > 800 && c.Zref < 1600);
  const d = BF.fastenerCapacity(Q, { plateT: 0.25, double: true });
  console.log('  1/2" bolt double shear Z =', d.Zref.toFixed(0), 'mode', d.mode);
  ok('double shear > single shear', d.Zref > c.Zref);
}
// 6. equilibrium with plates + notch
{
  const r = BF.solve(P, 20, {});
  let worst = 0;
  r.el.forEach((e, i) => { const me = r.Mexact[i]; if (me > 1000) worst = Math.max(worst, Math.abs(e.Mtot - me) / me); });
  ok('moment equilibrium with notch + plate (<3%)', worst < 0.03, (worst * 100).toFixed(2) + '%');
}
console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
process.exit(fail ? 1 : 0);
