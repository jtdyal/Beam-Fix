/*
 * Beam-Fix engine  (units: inch, lb, psi)
 *
 * 1) Layered Timoshenko beam FE model of a glulam beam with optional notch (bottom face)
 *    and up to two bolted/lagged/nailed steel side plates.  Wood and each plate carry their own
 *    axial DOF; they share deflection and section rotation; fasteners are interlayer slip springs.
 * 2) NDS yield-limit-model lateral capacity for nails, lag screws and bolts in steel-to-wood
 *    connections (single and double shear) plus slip modulus and optional group-action factor.
 *
 * Preliminary-design / exploration tool.  NOT a substitute for a licensed engineer's design.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BeamFix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Fastener catalogue                                                   */
  /* ------------------------------------------------------------------ */
  const NAILS = {
    '8d':  { label: '8d common (0.131" x 2-1/2")',  D: 0.131, L: 2.5 },
    '10d': { label: '10d common (0.148" x 3")',     D: 0.148, L: 3.0 },
    '12d': { label: '12d common (0.148" x 3-1/4")', D: 0.148, L: 3.25 },
    '16d': { label: '16d common (0.162" x 3-1/2")', D: 0.162, L: 3.5 },
    '20d': { label: '20d common (0.192" x 4")',     D: 0.192, L: 4.0 },
    '30d': { label: '30d common (0.207" x 4-1/2")', D: 0.207, L: 4.5 },
    '40d': { label: '40d common (0.225" x 5")',     D: 0.225, L: 5.0 },
    '60d': { label: '60d common (0.244" x 5-1/2")', D: 0.244, L: 5.5 },
  };
  const LAGS = {
    '1/4': 0.25, '5/16': 0.3125, '3/8': 0.375, '7/16': 0.4375, '1/2': 0.5, '5/8': 0.625, '3/4': 0.75,
  };
  const BOLTS = {
    '1/4': 0.25, '3/8': 0.375, '1/2': 0.5, '5/8': 0.625, '3/4': 0.75, '7/8': 0.875, '1': 1.0,
  };

  function fastenerD(f) {
    if (f.type === 'nail') return NAILS[f.nail].D;
    if (f.type === 'lag') return LAGS[f.size];
    return BOLTS[f.size];
  }
  // Bending yield strength Fyb (psi).  Nails: by diameter band.  Bolts: 45 ksi.  Lag screws: 45 ksi (conservative).
  function fastenerFyb(f) {
    if (f.type === 'nail') {
      const D = NAILS[f.nail].D;
      if (D <= 0.142) return 100000;
      if (D <= 0.177) return 90000;
      if (D <= 0.236) return 80000;
      return 70000;
    }
    return 45000;
  }

  /* ------------------------------------------------------------------ */
  /* NDS yield limit model                                                */
  /* ------------------------------------------------------------------ */
  function Rd(D, mode, theta) {
    const Kth = 1 + 0.25 * (theta / 90);
    if (D < 0.25) {
      if (D <= 0.17) return 2.2;
      return 10 * D + 0.5;
    }
    if (mode === 'Im') return 4 * Kth;
    if (mode === 'Is') return 3.6 * Kth;
    return 3.2 * Kth;
  }

  // Dowel bearing strength of wood, parallel to grain (theta=0), psi
  function Fem(f, G) {
    const D = fastenerD(f);
    if (D < 0.25) return 16600 * Math.pow(G, 1.84);
    return 11200 * G;
  }
  const FES_STEEL = 87000; // 1.5 * Fu (A36, Fu = 58 ksi)

  // Single shear: wood main member (effective length lm) / steel side member (thickness ls)
  function zSingle(D, lm, ls, fem, fes, fyb, theta) {
    const Re = fem / fes, Rt = lm / ls;
    const modes = {};
    modes.Im = D * lm * fem / Rd(D, 'Im', theta);
    modes.Is = D * ls * fes / Rd(D, 'Is', theta);
    const k1 = (Math.sqrt(Re + 2 * Re * Re * (1 + Rt + Rt * Rt) + Rt * Rt * Re * Re * Re) - Re * (1 + Rt)) / (1 + Re);
    modes.II = k1 * D * ls * fes / Rd(D, 'II', theta);
    const k2 = -1 + Math.sqrt(2 * (1 + Re) + 2 * fyb * (1 + 2 * Re) * D * D / (3 * fem * lm * lm));
    modes.IIIm = k2 * D * lm * fem / ((1 + 2 * Re) * Rd(D, 'IIIm', theta));
    const k3 = -1 + Math.sqrt(2 * (1 + Re) / Re + 2 * fyb * (2 + Re) * D * D / (3 * fem * ls * ls));
    modes.IIIs = k3 * D * ls * fem / ((2 + Re) * Rd(D, 'IIIs', theta));
    modes.IV = D * D / Rd(D, 'IV', theta) * Math.sqrt(2 * fem * fyb / (3 * (1 + Re)));
    return modes;
  }
  // Double shear: wood main member (lm) with two steel side members (ls each)
  function zDouble(D, lm, ls, fem, fes, fyb, theta) {
    const Re = fem / fes;
    const modes = {};
    modes.Im = D * lm * fem / Rd(D, 'Im', theta);
    modes.Is = 2 * D * ls * fes / Rd(D, 'Is', theta);
    const k3 = -1 + Math.sqrt(2 * (1 + Re) / Re + 2 * fyb * (2 + Re) * D * D / (3 * fem * ls * ls));
    modes.IIIs = 2 * k3 * D * ls * fem / ((2 + Re) * Rd(D, 'IIIs', theta));
    modes.IV = 2 * D * D / Rd(D, 'IV', theta) * Math.sqrt(2 * fem * fyb / (3 * (1 + Re)));
    return modes;
  }
  // NDS: sheet-metal side-plate uses Is = 1.0*..., keep generic.  Note Mode Is in NDS single-shear steel-side
  // case governs rarely; we keep all modes and take the minimum.

  function minMode(modes) {
    let best = Infinity, key = '';
    for (const k in modes) if (modes[k] < best) { best = modes[k]; key = k; }
    return { Z: best, mode: key };
  }

  // Slip modulus per shear plane (lb/in), wood-to-metal
  function slipModulus(D) { return 270000 * Math.pow(D, 1.5); }

  // NDS group action factor Cg (steel side plates).  n = fasteners in a row, s = spacing in row.
  function groupCg(n, s, D, Em, Am, Es, As) {
    if (n <= 1) return 1;
    const gamma = slipModulus(D);
    const u = 1 + gamma * (s / 2) * (1 / (Em * Am) + 1 / (Es * As));
    const m = u - Math.sqrt(u * u - 1);
    const REA = Math.min(Es * As / (Em * Am), Em * Am / (Es * As));
    const mn = Math.pow(m, n), m2n = Math.pow(m, 2 * n);
    const cg = (m * (1 - m2n)) / (n * ((1 + REA * mn) * (1 + m) - 1 + m2n)) * ((1 + REA) / (1 - m));
    return Math.min(1, cg);
  }

  /**
   * Lateral capacity of one fastener (per connection, single or double shear).
   * Returns reference Z, controlling mode, adjusted Z' (CD, CM, Ct, penetration reduction; optional Cg).
   */
  function fastenerCapacity(P, opts) {
    opts = opts || {};
    const f = P.fast, b = P.beam.b;
    const D = fastenerD(f), fem = Fem(f, f.G), fes = FES_STEEL, fyb = fastenerFyb(f);
    const ts = opts.plateT;
    const out = { D, Fem: fem, Fes: fes, Fyb: fyb, K: slipModulus(D) * (f.slipMult || 1), notes: [] };
    let modes, lm;
    const dbl = !!opts.double && f.type === 'bolt';
    if (f.type === 'bolt') {
      lm = b;
      modes = dbl ? zDouble(D, lm, ts, fem, fes, fyb, 0) : zSingle(D, lm, ts, fem, fes, fyb, 0);
    } else {
      let p = f.pen;
      if (f.type === 'nail') p = Math.min(p, NAILS[f.nail].L - ts);
      if (opts.twoPlates) p = Math.min(p, b / 2);
      lm = p;
      modes = zSingle(D, lm, ts, fem, fes, fyb, 0);
      if (f.type === 'lag') {
        if (p < 4 * D) out.notes.push('Lag screw penetration is less than 4D (' + (4 * D).toFixed(2) + '"): not permitted by NDS.');
      }
    }
    const mm = minMode(modes);
    out.modes = modes; out.mode = mm.mode; out.Zref = mm.Z; out.double = dbl; out.lm = lm;
    // perpendicular-to-grain capacity (for the vertical load-transfer component)
    const femP = D < 0.25 ? fem : 6100 * Math.pow(f.G, 1.45) / Math.sqrt(D);
    const modesP = dbl ? zDouble(D, lm, ts, femP, fes, fyb, 90) : zSingle(D, lm, ts, femP, fes, fyb, 90);
    out.FemPerp = femP; out.ZrefPerp = minMode(modesP).Z;
    let pf = 1;
    if (f.type === 'lag' && lm < 8 * D) pf = Math.max(0, lm / (8 * D));
    out.penFactor = pf;
    const adj = (f.CD || 1) * (f.CM || 1) * (f.Ct || 1) * pf;
    out.Zadj = mm.Z * adj;
    out.ZadjPerp = out.ZrefPerp * adj;
    out.Zadj_noCg = out.Zadj;
    out.adj = adj;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Defaults                                                             */
  /* ------------------------------------------------------------------ */
  function defaults() {
    return {
      beam: { b: 3.5, d: 13.5, Ltot: 235, bearing: 3.5, E: 1.8e6, GoverE: 1 / 16, shear: true, Fb: 2400, Fv: 300, CD: 1.0 },
      load: { mode: 'limit', limit: 0.625, w_plf: 250 },
      target: 0.25,
      notch: { enabled: true, length: 48, depth: 3, center: 70, ext: 1.5 },
      steel: { E: 29e6, G: 11.2e6, Fy: 36000 },
      plates: [
        { on: true, t: 0.1875, h: 13.5, yb: 0, len: 228, offset: 0 },
        { on: false, t: 0.1875, h: 13.5, yb: 0, len: 228, offset: 0 },
      ],
      fast: { peak: 1.5, type: 'lag', size: '1/2', nail: '16d', rows: 2, pitch: 8, edge: 4, pen: 2.5, G: 0.55,
              CD: 1.0, CM: 1.0, Ct: 1.0, useCg: false, slipMult: 1.0 },
    };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ */
  /* Geometry helpers                                                     */
  /* ------------------------------------------------------------------ */
  function plateRange(P, pl) {
    const c = P.beam.Ltot / 2 + (pl.offset || 0);
    return { x0: Math.max(0, c - pl.len / 2), x1: Math.min(P.beam.Ltot, c + pl.len / 2) };
  }
  function plateClampedGeom(P, pl) {
    const d = P.beam.d;
    const h = Math.min(Math.max(pl.h, 0.5), d);
    const yb = Math.min(Math.max(pl.yb, 0), d - h);
    return { h, yb };
  }
  function rowsY(P, pl) {
    const D = fastenerD(P.fast);
    const ey = Math.max(1.5 * D, 1.0);
    const g = plateClampedGeom(P, pl);
    let lo = g.yb + ey, hi = g.yb + g.h - ey;
    if (P.notch.enabled) lo = Math.max(lo, P.notch.depth + ey);
    hi = Math.min(hi, P.beam.d - ey);
    const n = Math.max(1, Math.round(P.fast.rows));
    if (hi < lo) return [];
    if (n === 1) return [(lo + hi) / 2];
    const ys = [];
    for (let i = 0; i < n; i++) ys.push(lo + (hi - lo) * i / (n - 1));
    return ys;
  }
  function fastenerXs(P, pl) {
    const r = plateRange(P, pl);
    const e = P.fast.edge, s = P.fast.pitch;
    const Leff = r.x1 - r.x0 - 2 * e;
    if (Leff < 0) return [];
    const n = Math.floor(Leff / s + 1e-9) + 1;
    const off = (Leff - (n - 1) * s) / 2;
    const xs = [];
    for (let j = 0; j < n; j++) xs.push(r.x0 + e + off + j * s);
    return xs;
  }

  /* ------------------------------------------------------------------ */
  /* Banded Cholesky                                                      */
  /* ------------------------------------------------------------------ */
  function bandSolve(Lb, n, hb, rhs) {
    const w = hb + 1;
    const at = (i, j) => Lb[i * w + (i - j)];
    for (let i = 0; i < n; i++) {
      const jmin = Math.max(0, i - hb);
      for (let j = jmin; j <= i; j++) {
        let s = Lb[i * w + (i - j)];
        const kmin = Math.max(jmin, j - hb);
        for (let k = kmin; k < j; k++) s -= at(i, k) * at(j, k);
        if (i === j) {
          if (!(s > 0)) throw new Error('Stiffness matrix not positive definite at dof ' + i);
          Lb[i * w] = Math.sqrt(s);
        } else Lb[i * w + (i - j)] = s / Lb[j * w];
      }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = rhs[i];
      for (let k = Math.max(0, i - hb); k < i; k++) s -= at(i, k) * y[k];
      y[i] = s / Lb[i * w];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k <= Math.min(n - 1, i + hb); k++) s -= at(k, i) * x[k];
      x[i] = s / Lb[i * w];
    }
    return x;
  }

  /* ------------------------------------------------------------------ */
  /* Core solver                                                          */
  /* ------------------------------------------------------------------ */
  /**
   * Solve one configuration under UDL w (lb/in) applied between the bearing centres.
   * cfg: { notch:bool, plates:[bool,bool] }  -- which features are active.
   */
  function solve(P, w, cfg) {
    cfg = cfg || {};
    const useNotch = cfg.notch !== undefined ? cfg.notch : P.notch.enabled;
    const bm = P.beam, nt = P.notch;
    const E = bm.E, G = bm.E * bm.GoverE, kappa = 5 / 6;
    const Es = P.steel.E;
    const ym = bm.d / 2;
    const xs1 = bm.bearing / 2, xs2 = bm.Ltot - bm.bearing / 2;
    const extN = (nt.ext === undefined ? 1.5 : nt.ext) * nt.depth; // end-effect allowance (calibrated to the 3-D reference)
    const nx0 = Math.max(0, nt.center - nt.length / 2 - extN), nx1 = Math.min(bm.Ltot, nt.center + nt.length / 2 + extN);

    // active plates
    const plates = [];
    for (let i = 0; i < 2; i++) {
      const pl = P.plates[i];
      const on = cfg.plates ? !!cfg.plates[i] : pl.on;
      if (!on) continue;
      const g = plateClampedGeom(P, pl);
      const r = plateRange(P, pl);
      const xsF = fastenerXs(P, pl);
      const ys = rowsY(P, pl);
      const K = slipModulus(fastenerD(P.fast)) * (P.fast.slipMult || 1);
      plates.push({
        idx: i, t: pl.t, h: g.h, yb: g.yb, x0: r.x0, x1: r.x1, xsF, ys, K,
        yc: g.yb + g.h / 2,
        kx0: xsF.length ? xsF[0] - P.fast.pitch / 2 : 0,
        kx1: xsF.length ? xsF[xsF.length - 1] + P.fast.pitch / 2 : 0,
        kPerLen: xsF.length && ys.length ? ys.length * K / P.fast.pitch : 0,
      });
    }
    const nL = 1 + plates.length;
    const ND = 2 + nL; // w, phi, u0, u1, u2

    // breakpoints
    const bp = new Set([0, bm.Ltot, xs1, xs2, (xs1 + xs2) / 2]);
    if (useNotch) { [nx0, nx1].forEach(x => { if (x > 0 && x < bm.Ltot) bp.add(x); }); }
    plates.forEach(p => { bp.add(p.x0); bp.add(p.x1); if (p.kPerLen) { bp.add(Math.max(0, p.kx0)); bp.add(Math.min(bm.Ltot, p.kx1)); } });
    const keys = Array.from(bp).map(x => Math.round(x * 1e6) / 1e6).sort((a, b) => a - b);
    const xsU = [];
    for (let i = 0; i < keys.length; i++) {
      xsU.push(keys[i]);
      if (i < keys.length - 1) {
        const L = keys[i + 1] - keys[i];
        const n = Math.max(1, Math.ceil(L / 1.0 - 1e-9));
        for (let j = 1; j < n; j++) xsU.push(keys[i] + L * j / n);
      }
    }
    const X = xsU.filter((x, i) => i === 0 || x - xsU[i - 1] > 1e-9);
    const nn = X.length, ne = nn - 1;
    const N = nn * ND, hb = 2 * ND - 1, wB = hb + 1;
    const Lb = new Float64Array(N * wB);
    const F = new Float64Array(N);

    const elems = [];
    const addK = (ia, ja, v) => { // add v at global (ia,ja), ia>=ja
      if (ia < ja) { const t = ia; ia = ja; ja = t; }
      Lb[ia * wB + (ia - ja)] += v;
    };

    for (let e = 0; e < ne; e++) {
      const xa = X[e], xb = X[e + 1], le = xb - xa, xm = (xa + xb) / 2;
      const yn = (useNotch && xm > nx0 && xm < nx1) ? Math.min(nt.depth, bm.d - 0.5) : 0;
      const Aw = bm.b * (bm.d - yn), ycw = (yn + bm.d) / 2, ecc = ycw - ym;
      const Bw = Aw * ecc, Iw = bm.b * Math.pow(bm.d - yn, 3) / 12 + Aw * ecc * ecc;
      const layers = [{ EA: E * Aw, EB: E * Bw, EI: E * Iw }];
      const act = [true];
      plates.forEach(p => {
        const inside = xm > p.x0 && xm < p.x1;
        act.push(inside);
        layers.push(inside ? { EA: Es * p.t * p.h, EB: 0, EI: Es * p.t * p.h * p.h * p.h / 12 } : { EA: 0, EB: 0, EI: 0 });
      });
      const nd = 2 * ND;
      const Ke = new Float64Array(nd * nd);
      const add = (v1, v2, c) => { for (let i = 0; i < nd; i++) { if (!v1[i]) continue; for (let j = 0; j < nd; j++) if (v2[j]) Ke[i * nd + j] += c * v1[i] * v2[j]; } };
      const V = () => new Float64Array(nd);
      const dof = (node, loc) => node * ND + loc; // local (0/1 node) version below
      const L = (n, loc) => n * ND + loc;
      // curvature vector
      const vphi = V(); vphi[L(0, 1)] = -1 / le; vphi[L(1, 1)] = 1 / le;
      for (let li = 0; li < nL; li++) {
        const ly = layers[li];
        const vu = V(); vu[L(0, 2 + li)] = -1 / le; vu[L(1, 2 + li)] = 1 / le;
        add(vu, vu, ly.EA * le);
        if (ly.EB) { add(vu, vphi, -ly.EB * le); add(vphi, vu, -ly.EB * le); }
        add(vphi, vphi, ly.EI * le);
      }
      // shear (wood only), reduced integration
      let GA = kappa * G * Aw;
      if (!bm.shear) GA = 1e6 * layers[0].EI / (le * le);
      const vg = V(); vg[L(0, 0)] = -1 / le; vg[L(1, 0)] = 1 / le; vg[L(0, 1)] = -0.5; vg[L(1, 1)] = -0.5;
      add(vg, vg, GA * le);
      // slip springs
      const ks = new Array(nL).fill(0);
      plates.forEach((p, i) => {
        if (act[i + 1] && p.kPerLen && xm > p.kx0 && xm < p.kx1) {
          ks[i + 1] = p.kPerLen;
          const c = p.yc - ym;
          const va = V(), vb = V();
          va[L(0, 2 + i + 1)] = 1; va[L(0, 2)] = -1; va[L(0, 1)] = c;
          vb[L(1, 2 + i + 1)] = 1; vb[L(1, 2)] = -1; vb[L(1, 1)] = c;
          const k = p.kPerLen * le;
          add(va, va, k / 3); add(vb, vb, k / 3); add(va, vb, k / 6); add(vb, va, k / 6);
        }
      });
      // assemble lower triangle
      for (let i = 0; i < nd; i++) for (let j = 0; j <= i; j++) {
        const v = Ke[i * nd + j];
        if (v !== 0) {
          const gi = (i < ND ? e : e + 1) * ND + (i % ND), gj = (j < ND ? e : e + 1) * ND + (j % ND);
          addK(gi, gj, v);
        }
      }
      // load
      if (xm > xs1 && xm < xs2) { F[e * ND] -= w * le / 2; F[(e + 1) * ND] -= w * le / 2; }
      elems.push({ xa, xb, le, xm, yn, Aw, ycw, ecc, Bw, Iw, act });
    }

    // constraints
    const fixed = new Set();
    const nodeAt = x => { let bi = 0, bd = Infinity; for (let i = 0; i < nn; i++) { const d = Math.abs(X[i] - x); if (d < bd) { bd = d; bi = i; } } return bi; };
    const n1 = nodeAt(xs1), n2 = nodeAt(xs2);
    fixed.add(n1 * ND); fixed.add(n2 * ND); fixed.add(n1 * ND + 2);
    plates.forEach((p, i) => {
      for (let k = 0; k < nn; k++) if (X[k] < p.x0 - 1e-9 || X[k] > p.x1 + 1e-9) fixed.add(k * ND + 3 + i);
    });
    // plate nodes with no spring anywhere would float: tie lightly
    plates.forEach((p, i) => { if (!p.kPerLen) { for (let k = 0; k < nn; k++) addK(k * ND + 3 + i, k * ND + 3 + i, 1e-3); } });
    fixed.forEach(i => {
      for (let j = Math.max(0, i - hb); j < i; j++) Lb[i * wB + (i - j)] = 0;
      for (let m = i + 1; m <= Math.min(N - 1, i + hb); m++) Lb[m * wB + (m - i)] = 0;
      Lb[i * wB] = 1; F[i] = 0;
    });
    // floating-layer guard: unused layer dofs inside plate but with no stiffness are not possible (EA>0)
    const sol = bandSolve(Lb, N, hb, F);

    // ---- post-process
    const res = { X, nn, ne, ND, plates, nL, w, useNotch, xs1, xs2, nx0, nx1 };
    res.defl = new Float64Array(nn); // downward positive (sag)
    for (let k = 0; k < nn; k++) res.defl[k] = -sol[k * ND];
    let maxSag = -Infinity, xMax = 0;
    for (let k = 0; k < nn; k++) if (res.defl[k] > maxSag) { maxSag = res.defl[k]; xMax = X[k]; }
    res.maxSag = maxSag; res.xMax = xMax;
    res.midSag = res.defl[nodeAt((xs1 + xs2) / 2)];

    // element results
    const el = [];
    for (let e = 0; e < ne; e++) {
      const E_ = elems[e], le = E_.le;
      const ph = (sol[(e + 1) * ND + 1] - sol[e * ND + 1]) / le; // curvature
      const u = li => (sol[(e + 1) * ND + 2 + li] - sol[e * ND + 2 + li]) / le;
      const eps0 = u(0);
      const r = {};
      r.xm = E_.xm; r.curv = ph;
      // wood
      const sb = E * (eps0 - (E_.yn - ym) * ph), st = E * (eps0 - (bm.d - ym) * ph);
      r.woodBot = sb; r.woodTop = st; r.woodN = E * (E_.Aw * eps0 - E_.Bw * ph);
      r.woodM = E * (E_.Iw * ph - E_.Bw * eps0);
      r.yn = E_.yn;
      // plates
      r.plate = [];
      let Mtot = r.woodM;
      plates.forEach((p, i) => {
        if (!E_.act[i + 1]) { r.plate.push(null); return; }
        const ep = u(i + 1);
        const A = p.t * p.h, Ip = p.t * Math.pow(p.h, 3) / 12;
        const N_ = Es * A * ep, M_ = Es * Ip * ph;
        const sBot = Es * (ep - (p.yb - p.yc) * ph), sTop = Es * (ep - (p.yb + p.h - p.yc) * ph);
        r.plate.push({ N: N_, M: M_, sBot, sTop });
        Mtot += M_ - (p.yc - ym) * N_;
      });
      r.Mtot = Mtot;
      el.push(r);
    }
    res.el = el;
    // exact static moment at element midpoints for comparison
    const R = w * (xs2 - xs1) / 2;
    res.Mexact = el.map(r => (r.xm <= xs1 || r.xm >= xs2) ? 0 : R * (r.xm - xs1) - w * (r.xm - xs1) * (r.xm - xs1) / 2);
    res.R = R;

    // fastener forces at actual fastener positions
    const interp = (arr, x) => { // arr per node
      let k = 0; while (k < nn - 2 && X[k + 1] < x) k++;
      const t = (x - X[k]) / (X[k + 1] - X[k]); return arr[k] * (1 - t) + arr[k + 1] * t;
    };
    plates.forEach((p, i) => {
      const slip = new Float64Array(nn);
      const c = p.yc - ym;
      for (let k = 0; k < nn; k++) slip[k] = sol[k * ND + 3 + i] - sol[k * ND + 2] + c * sol[k * ND + 1];
      p.slip = slip;
      p.F = p.xsF.map(x => p.K * interp(slip, x)); // per fastener (each row has same slip)
      p.Fmax = p.F.reduce((m, f) => Math.max(m, Math.abs(f)), 0);
      p.Fsum = p.F.reduce((m, f) => m + Math.abs(f), 0);
      p.Ftotal = p.F.map(f => f * p.ys.length); // total shear flow x pitch
    });
    res.sol = sol;
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* Full analysis                                                        */
  /* ------------------------------------------------------------------ */
  function analyze(P) {
    const warn = [];
    // unit-load baseline (no notch, no plates)
    const u = solve(P, 1, { notch: false, plates: [false, false] });
    const dUnit = u.maxSag;
    let w;
    if (P.load.mode === 'limit') w = P.load.limit / dUnit; else w = P.load.w_plf / 12;
    const baseline = solve(P, w, { notch: false, plates: [false, false] });
    const damaged = solve(P, w, { notch: P.notch.enabled, plates: [false, false] });
    const repaired = solve(P, w, {});

    // plate thickness sweep
    const sweep = [];
    const ts = [2, 3, 4, 5, 6, 7, 8].map(n => n / 16);
    ts.forEach(t => {
      const Q = clone(P); Q.plates[0].t = t; if (Q.plates[1].on) Q.plates[1].t = t;
      const cfg = {};
      const r = solve(Q, w, cfg);
      sweep.push({ t, sag: r.maxSag });
    });

    // fastener checks
    const active = repaired.plates;
    const checks = { fasteners: [] };
    const nPl = active.length;
    active.forEach((p, i) => {
      const cap = fastenerCapacity(P, { plateT: p.t, double: false, twoPlates: nPl === 2 });
      // share of bending carried by this plate's own stiffness -> vertical load that must be transferred by the fasteners
      let share = 0;
      repaired.el.forEach(e => { const pp = e.plate[i]; if (pp && Math.abs(e.Mtot) > 1000) share = Math.max(share, Math.abs(pp.M) / Math.abs(e.Mtot)); });
      const Fy = p.ys.length ? share * w * P.fast.pitch / p.ys.length : 0;
      checks.fasteners.push({ plate: p.idx, cap, demand: p.Fmax * (P.fast.peak || 1), n: p.xsF.length, rows: p.ys.length, share, Fy });
    });
    // double-shear bolts: both plates on the same bolts?
    if (P.fast.type === 'bolt' && nPl === 2) {
      const a = active[0], b = active[1];
      const same = a.xsF.length === b.xsF.length && a.xsF.every((x, j) => Math.abs(x - b.xsF[j]) < 1e-6);
      if (same) {
        const sumMax = a.F.reduce((m, f, j) => Math.max(m, Math.abs(f) + Math.abs(b.F[j])), 0);
        const cap = fastenerCapacity(P, { plateT: Math.min(a.t, b.t), double: true, twoPlates: true });
        checks.doubleShear = { cap, demand: sumMax * (P.fast.peak || 1), n: a.xsF.length };
      }
    }
    // group action
    if (P.fast.useCg && P.fast.type !== 'nail') {
      checks.fasteners.forEach((f, i) => {
        const p = active[i];
        const cg = groupCg(p.xsF.length, P.fast.pitch, f.cap.D, P.beam.E, P.beam.b * P.beam.d, P.steel.E, p.t * p.h);
        f.cap.Cg = cg; f.cap.Zadj = f.cap.Zadj_noCg * cg;
      });
      if (checks.doubleShear) {
        const f0 = checks.fasteners[0];
        checks.doubleShear.cap.Cg = f0.cap.Cg; checks.doubleShear.cap.Zadj *= (f0.cap.Cg || 1);
      }
    }

    // wood stress / shear checks
    const stress = function (r) {
      let tens = 0, comp = 0, tensX = 0;
      r.el.forEach(e => {
        // positive stress = tension. bottom fiber tension in sagging
        [e.woodBot, e.woodTop].forEach(s => { if (s > tens) { tens = s; tensX = e.xm; } if (-s > comp) comp = -s; });
      });
      return { tens, comp, tensX };
    };
    const sB = stress(baseline), sD = stress(damaged), sR = stress(repaired);
    const Vat = x => { const R = repaired.R; return R - w * (x - repaired.xs1); };
    const xd = repaired.xs1 + P.beam.bearing / 2 + P.beam.d; // d from face of support
    const Vcrit = Math.abs(Vat(xd));
    const vEnd = 1.5 * Vcrit / (P.beam.b * P.beam.d);
    let vNotch = 0;
    if (P.notch.enabled) {
      const en = (P.notch.ext === undefined ? 1.5 : P.notch.ext) * P.notch.depth;
      const nx0 = P.notch.center - P.notch.length / 2 - en, nx1 = P.notch.center + P.notch.length / 2 + en;
      const Vn = Math.max(Math.abs(Vat(nx0)), Math.abs(Vat(nx1)));
      vNotch = 1.5 * Vn / (P.beam.b * (P.beam.d - P.notch.depth));
    }

    // warnings
    const D = fastenerD(P.fast);
    if (P.fast.type !== 'nail') {
      if (P.fast.pitch < 4 * D) warn.push('Fastener spacing in a row (' + P.fast.pitch + '") is less than 4D = ' + (4 * D).toFixed(2) + '".');
      if (P.fast.rows > 1) {
        const ysP = active.length ? active[0].ys : [];
        if (ysP.length > 1 && ysP[1] - ysP[0] < 1.5 * D) warn.push('Row spacing is less than 1.5D = ' + (1.5 * D).toFixed(2) + '".');
      }
    } else {
      warn.push('Nails through steel plate need pre-drilled/ pre-punched plate holes; verify nail spacing per NDS 12.5 for your layout.');
    }
    if (P.fast.type === 'nail' && active.some(p => p.t > 0.25)) warn.push('Nailing through plate thicker than 1/4" is generally impractical.');
    active.forEach(p => { if (!p.ys.length) warn.push('Plate ' + (p.idx + 1) + ': no room for fastener rows between the plate edges, notch top and beam edges.'); });
    if (P.fast.type !== 'bolt' && nPl === 2 && P.fast.pen > P.beam.b / 2) warn.push('Two plates: lag/nail penetration limited to half the beam width (' + (P.beam.b / 2) + '") in the capacity calc.');
    if (P.notch.enabled) warn.push('Tension-face notch: stress concentration at the notch corners and crack-like behaviour are NOT modelled by the beam FE; glulam tension-face notches are generally prohibited by code. Have a licensed engineer review.');
    if (P.fast.type !== 'nail') warn.push('Bolt/lag hole clearance (initial slip before bearing) is not modelled; real stiffness gain will be lower if holes are oversized.');

    return {
      P, w, wPlf: w * 12, dUnit, baseline, damaged, repaired, sweep, checks, warn,
      wood: { base: sB, dam: sD, rep: sR, vEnd, vNotch },
    };
  }

  return {
    defaults, clone, solve, analyze, NAILS, LAGS, BOLTS,
    fastenerD, fastenerFyb, fastenerCapacity, slipModulus, groupCg, zSingle, zDouble, minMode,
    plateRange, plateClampedGeom, rowsY, fastenerXs, FES_STEEL, Fem,
  };
});
