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
  /* Fastener catalogue  (NDS 2015: Appendix L tables L2/L4, Table 12K/12P notes) */
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
  // Lag screws: nominal D, root diameter Dr (Table L2), tapered-tip length E (Table L2), Fyb (Table 12K note 2),
  // reduced = true: Table 12K / 12J note 2 tabulates all sizes as "reduced body diameter" lag screws (root diameter used in the yield equations).
  const LAGS = {
    '1/4':  { D: 0.25,   Dr: 0.173, E: 5 / 32,  Fyb: 70000, reduced: true },
    '5/16': { D: 0.3125, Dr: 0.227, E: 3 / 16,  Fyb: 60000, reduced: true },
    '3/8':  { D: 0.375,  Dr: 0.265, E: 7 / 32,  Fyb: 45000, reduced: true },
    '7/16': { D: 0.4375, Dr: 0.328, E: 9 / 32,  Fyb: 45000, reduced: true },
    '1/2':  { D: 0.5,    Dr: 0.371, E: 5 / 16,  Fyb: 45000, reduced: true },
    '5/8':  { D: 0.625,  Dr: 0.471, E: 13 / 32, Fyb: 45000, reduced: true },
    '3/4':  { D: 0.75,   Dr: 0.579, E: 1 / 2,   Fyb: 45000, reduced: true },
  };
  const BOLTS = { '1/4': 0.25, '3/8': 0.375, '1/2': 0.5, '5/8': 0.625, '3/4': 0.75, '7/8': 0.875, '1': 1.0 };

  // nominal diameter (spacing, slip modulus, group action)
  function fastenerD(f) {
    if (f.type === 'nail') return NAILS[f.nail].D;
    if (f.type === 'lag') return LAGS[f.size].D;
    return BOLTS[f.size];
  }
  // diameter used in the yield limit equations (12.3.7.1: root/reduced-body diameter for reduced-body lag screws)
  function fastenerDy(f) {
    if (f.type === 'lag') { const l = LAGS[f.size]; return l.reduced ? l.Dr : l.D; }
    return fastenerD(f);
  }
  // Bending yield strength Fyb (psi): Tables 12B-12K, 12N-12R notes
  function fastenerFyb(f) {
    if (f.type === 'nail') {
      const D = NAILS[f.nail].D;
      if (D <= 0.142) return 100000;
      if (D <= 0.177) return 90000;
      if (D <= 0.236) return 80000;
      return 70000;
    }
    if (f.type === 'lag') return LAGS[f.size].Fyb;
    return 45000;
  }

  /* ------------------------------------------------------------------ */
  /* NDS yield limit model  (NDS 2015 Tables 12.3.1A, 12.3.1B, 12.3.3)    */
  /* ------------------------------------------------------------------ */
  // Reduction term Rd, Table 12.3.1B.  thr = threaded fastener with D>=0.25" nominal but root diameter < 0.25" (note 1)
  function Rd(D, mode, theta, thr) {
    const Kth = 1 + 0.25 * (theta / 90);
    const KD = D <= 0.17 ? 2.2 : (D < 0.25 ? 10 * D + 0.5 : 1);
    if (thr) return KD * Kth;
    if (D < 0.25) return KD;
    if (mode === 'Im' || mode === 'Is') return 4 * Kth;
    if (mode === 'II') return 3.6 * Kth;
    return 3.2 * Kth;
  }

  // Dowel bearing strength Fe of the wood (Table 12.3.3 equations: values in the table are these, rounded)
  function FeWood(f, G, Dn, theta) {
    if (Dn < 0.25) return 16600 * Math.pow(G, 1.84);
    const par = 11200 * G, perp = 6100 * Math.pow(G, 1.45) / Math.sqrt(Dn);
    if (!theta) return par;
    const t = theta * Math.PI / 180; // Hankinson (12.3-11)
    return par * perp / (par * Math.pow(Math.sin(t), 2) + perp * Math.pow(Math.cos(t), 2));
  }
  const FES_STEEL = 87000; // ASTM A36 (Tables 12B, 12D, 12I, 12K note 2)

  // Table 12.3.1A single shear
  function zSingle(D, lm, ls, fem, fes, fyb, theta, thr) {
    const Re = fem / fes, Rt = lm / ls, R = m => Rd(D, m, theta, thr);
    const modes = {};
    modes.Im = D * lm * fem / R('Im');
    modes.Is = D * ls * fes / R('Is');
    const k1 = (Math.sqrt(Re + 2 * Re * Re * (1 + Rt + Rt * Rt) + Rt * Rt * Re * Re * Re) - Re * (1 + Rt)) / (1 + Re);
    modes.II = k1 * D * ls * fes / R('II');
    const k2 = -1 + Math.sqrt(2 * (1 + Re) + 2 * fyb * (1 + 2 * Re) * D * D / (3 * fem * lm * lm));
    modes.IIIm = k2 * D * lm * fem / ((1 + 2 * Re) * R('IIIm'));
    const k3 = -1 + Math.sqrt(2 * (1 + Re) / Re + 2 * fyb * (2 + Re) * D * D / (3 * fem * ls * ls));
    modes.IIIs = k3 * D * ls * fem / ((2 + Re) * R('IIIs'));
    modes.IV = D * D / R('IV') * Math.sqrt(2 * fem * fyb / (3 * (1 + Re)));
    return modes;
  }
  // Table 12.3.1A double shear (wood main member lm, two steel side members ls each)
  function zDouble(D, lm, ls, fem, fes, fyb, theta, thr) {
    const Re = fem / fes, R = m => Rd(D, m, theta, thr);
    const modes = {};
    modes.Im = D * lm * fem / R('Im');
    modes.Is = 2 * D * ls * fes / R('Is');
    const k3 = -1 + Math.sqrt(2 * (1 + Re) / Re + 2 * fyb * (2 + Re) * D * D / (3 * fem * ls * ls));
    modes.IIIs = 2 * k3 * D * ls * fem / ((2 + Re) * R('IIIs'));
    modes.IV = 2 * D * D / R('IV') * Math.sqrt(2 * fem * fyb / (3 * (1 + Re)));
    return modes;
  }

  function minMode(modes) {
    let best = Infinity, key = '';
    for (const k in modes) if (modes[k] < best) { best = modes[k]; key = k; }
    return { Z: best, mode: key };
  }

  // Load/slip modulus, wood-to-metal dowel-type fastener (11.3.6): 270,000 D^1.5, lb/in
  function slipModulus(D) { return 270000 * Math.pow(D, 1.5); }

  // Group action factor Cg, Eq. 11.3-1 (steel side plates).  n = fasteners in a row, s = spacing in row.
  function groupCg(n, s, D, Em, Am, Es, As) {
    if (n <= 1 || D < 0.25) return 1;
    const gamma = slipModulus(D);
    const u = 1 + gamma * (s / 2) * (1 / (Em * Am) + 1 / (Es * As));
    const m = u - Math.sqrt(u * u - 1);
    const REA = Math.min(Es * As / (Em * Am), Em * Am / (Es * As));
    const mn = Math.pow(m, n), m2n = Math.pow(m, 2 * n);
    const cg = (m * (1 - m2n)) / (n * ((1 + REA * mn) * (1 + m) - 1 + m2n)) * ((1 + REA) / (1 - m));
    return Math.min(1, cg);
  }

  /**
   * Lateral capacity of one fastener, steel side plate to glulam main member.
   * opts: { plateT, double, lm (override main-member dowel length, for table checks), fes (override), pitch }
   */
  function fastenerCapacity(P, opts) {
    opts = opts || {};
    const f = P.fast, b = P.beam.b, ts = opts.plateT;
    const Dn = fastenerD(f), Dy = fastenerDy(f), fyb = fastenerFyb(f);
    const fes = opts.fes || FES_STEEL;
    const fem = FeWood(f, f.G, Dn, 0), femP = FeWood(f, f.G, Dn, 90);
    const thr = f.type === 'lag' && Dn >= 0.25 && Dy < 0.25;
    const out = { D: Dn, Dy, Fem: fem, FemPerp: femP, Fes: fes, Fyb: fyb, K: slipModulus(Dn) * (f.slipMult || 1), notes: [], thr };
    const dbl = !!opts.double && f.type === 'bolt';
    let lm, pf = 1;
    if (f.type === 'bolt') {
      lm = b;
    } else if (f.type === 'lag') {
      const L = LAGS[f.size];
      const ptot = Math.min(f.pen, b - 0.25);                 // penetration into the beam, including the tip
      const pex = ptot - L.E;                                  // excluding the tapered tip
      lm = ptot - L.E / 2;                                     // dowel bearing length, 12.3.5.3
      if (pex < 4 * Dn - 1e-9) { pf = 0; out.notes.push('Lag screw penetration (not counting the tip) is ' + pex.toFixed(2) + '", less than the 4D = ' + (4 * Dn).toFixed(2) + '" minimum (12.1.4.6): not permitted.'); }
      else pf = Math.min(1, pex / (8 * Dn));                   // Table 12K note 3
      out.pen = { total: ptot, excl: pex, need8D: 8 * Dn };
    } else {
      const E = 2 * Dn;
      const ptot = Math.min(f.pen, NAILS[f.nail].L - ts, b);
      lm = ptot - E / 2;
      if (ptot < 6 * Dn - 1e-9) { pf = 0; out.notes.push('Nail penetration ' + ptot.toFixed(2) + '" is less than 6D = ' + (6 * Dn).toFixed(2) + '": not permitted (Table 12P note 3).'); }
      else pf = Math.min(1, ptot / (10 * Dn));                 // Table 12P note 3
      out.pen = { total: ptot, excl: ptot, need8D: 10 * Dn };
    }
    if (opts.lm) lm = opts.lm;
    const modes = dbl ? zDouble(Dy, lm, ts, fem, fes, fyb, 0, thr) : zSingle(Dy, lm, ts, fem, fes, fyb, 0, thr);
    const modesP = dbl ? zDouble(Dy, lm, ts, femP, fes, fyb, 90, thr) : zSingle(Dy, lm, ts, femP, fes, fyb, 90, thr);
    const mm = minMode(modes), mp = minMode(modesP);
    out.modes = modes; out.mode = mm.mode; out.Zref = mm.Z; out.ZrefPerp = mp.Z; out.double = dbl; out.lm = lm;
    // geometry factor for spacing in a row (Table 12.5.1B): full value at 4D, linear down to 3D
    let cd = 1;
    const pitch = opts.pitch !== undefined ? opts.pitch : f.pitch;
    if (Dn >= 0.25 && pitch !== undefined) {
      if (pitch < 3 * Dn - 1e-9) { cd = 0; out.notes.push('Spacing in a row is less than the 3D minimum (Table 12.5.1B): not permitted.'); }
      else cd = Math.min(1, pitch / (4 * Dn));
    }
    out.penFactor = pf; out.Cdelta = cd;
    const adj = (f.CD || 1) * (f.CM || 1) * (f.Ct || 1) * pf * cd;
    out.adj = adj; out.Zadj = mm.Z * adj; out.ZadjPerp = mp.Z * adj; out.Zadj_noCg = out.Zadj;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Defaults                                                             */
  /* ------------------------------------------------------------------ */
  function defaults() {
    return {
      beam: { b: 3.5, d: 13.5, Ltot: 235, bearing: 3.5, E: 1.8e6, shearFree: 1.05, GoverE: 1 / 16, shear: true, Fb: 2400, Fv: 300, CD: 1.0 },
      load: { mode: 'limit', limit: 0.625, w_plf: 250 },
      target: 0.25, check: 1, plate2same: true,
      notch: { enabled: true, length: 48, depth: 3, center: 70, ext: 1.5 },
      steel: { E: 29e6, G: 11.2e6, Fy: 36000 },
      plates: [
        { on: true, t: 0.1875, h: 13.5, yb: 0, len: 228, offset: 0 },
        { on: false, t: 0.1875, h: 13.5, yb: 0, len: 228, offset: 0 },
      ],
      fast: { peak: 1.5, type: 'lag', size: '1/2', nail: '16d', rows: 2, pitch: 8, edge: 4, pen: 3.0, G: 0.55,
              CD: 1.0, CM: 1.0, Ct: 1.0, useCg: false, slipMult: 1.0 },
    };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // Tabulated glulam E is an apparent value that already includes shear deflection (NDS App. F.3.1); shear-free
  // E = 1.05 x tabulated for glulam.  When shear is modelled explicitly the shear-free E is used with G = E/16.
  function Ebend(P) { return P.beam.E * (P.beam.shear ? (P.beam.shearFree === undefined ? 1.05 : P.beam.shearFree) : 1); }

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
    hi = Math.min(hi, P.beam.d - ey);
    const n = Math.max(1, Math.round(P.fast.rows));
    if (hi < lo) return [];
    const cap = P.fast.type === 'lag' ? 6 : (P.fast.type === 'bolt' ? 10 : Infinity); // Table 12.5.1F (glulam, <16% MC)
    if (hi - lo > cap) { const mid = (lo + hi) / 2; lo = mid - cap / 2; hi = mid + cap / 2; }
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
    const E = Ebend(P), G = E * bm.GoverE, kappa = 5 / 6;
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
      const kx0 = xsF.length ? xsF[0] - P.fast.pitch / 2 : 0, kx1 = xsF.length ? xsF[xsF.length - 1] + P.fast.pitch / 2 : 0;
      const fastened = xsF.length && ys.length;
      plates.push({
        // x0/x1: structurally active extent (only where fasteners tie the plate to the beam); px0/px1: physical plate
        idx: i, t: pl.t, h: g.h, yb: g.yb, px0: r.x0, px1: r.x1,
        x0: fastened ? Math.max(r.x0, kx0) : r.x0, x1: fastened ? Math.min(r.x1, kx1) : r.x1, xsF, ys, K,
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
      r.xm = E_.xm; r.curv = ph; r.eps0 = eps0;
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
        r.plate.push({ N: N_, M: M_, sBot, sTop, eps0: ep, Marm: M_ - (p.yc - ym) * N_ });
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
  /* Torsion from a one-sided plate (first-order).  Each layer carries a share of the vertical shear equal to its share of the
     bending moment; the plate's share acts at the plate offset from the load line (wood centreline), giving a distributed
     torque m = w * z_sc.  Wood + plate torsional stiffness resist it with twist restrained at both bearings. */
  function twistOf(P, res, w) {
    const bm = P.beam, ne = res.ne, nn = res.nn, X = res.X;
    const G = Ebend(P) * bm.GoverE, Gs = P.steel.G;
    const J = (a, c) => { const bb = Math.min(a, c), dd = Math.max(a, c); return dd * Math.pow(bb, 3) / 3 * (1 - 0.63 * bb / dd * (1 - Math.pow(bb, 4) / (12 * Math.pow(dd, 4)))); };
    const k = new Float64Array(ne), m = new Float64Array(ne), zs = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
      const el = res.el[e], le = X[e + 1] - X[e];
      let GJ = G * J(bm.b, bm.d - el.yn), zsc = 0;
      res.plates.forEach((p, i) => {
        const pp = el.plate[i]; if (!pp) return;
        GJ += Gs * J(p.t, p.h);
        const z = (p.idx === 0 ? -1 : 1) * (bm.b / 2 + p.t / 2);   // outside plate at -z, inside plate at +z
        if (Math.abs(el.Mtot) > 1) zsc += (pp.Marm / el.Mtot) * z;
      });
      zs[e] = zsc; k[e] = GJ / le;
      m[e] = (el.xm > res.xs1 && el.xm < res.xs2) ? -w * zsc * le / 2 : 0;   // nodal torque contribution (each end)
    }
    const a = new Float64Array(nn), d = new Float64Array(nn), c = new Float64Array(nn), r = new Float64Array(nn);
    for (let e = 0; e < ne; e++) {
      d[e] += k[e]; d[e + 1] += k[e]; c[e] -= k[e]; a[e + 1] -= k[e]; r[e] += m[e]; r[e + 1] += m[e];
    }
    const fix = x => { let bi = 0, bd = Infinity; for (let i = 0; i < nn; i++) { const q = Math.abs(X[i] - x); if (q < bd) { bd = q; bi = i; } } return bi; };
    [fix(res.xs1), fix(res.xs2)].forEach(i => { a[i] = 0; c[i] = 0; d[i] = 1; r[i] = 0; if (i > 0) c[i - 1] = 0; if (i < nn - 1) a[i + 1] = 0; });
    // Thomas algorithm
    for (let i = 1; i < nn; i++) { const f = a[i] / d[i - 1]; d[i] -= f * c[i - 1]; r[i] -= f * r[i - 1]; }
    const th = new Float64Array(nn);
    th[nn - 1] = r[nn - 1] / d[nn - 1];
    for (let i = nn - 2; i >= 0; i--) th[i] = (r[i] - c[i] * th[i + 1]) / d[i];
    let mx = 0, xm = 0; for (let i = 0; i < nn; i++) if (Math.abs(th[i]) > Math.abs(mx)) { mx = th[i]; xm = X[i]; }
    const zscMax = zs.reduce((q, v) => Math.abs(v) > Math.abs(q) ? v : q, 0);
    return { theta: th, X, max: mx, xMax: xm, deg: mx * 180 / Math.PI, zsc: zscMax,
             lateralTop: Math.abs(mx) * bm.d / 2 };
  }

  function analyze(P0) {
    const P = clone(P0);
    if (P.plate2same !== false) { const a = P.plates[0]; Object.assign(P.plates[1], { t: a.t, h: a.h, yb: a.yb, len: a.len, offset: a.offset }); }
    const warn = [];
    const W = (t, d) => warn.push({ t, d });
    // unit-load baseline (no notch, no plates)
    const u = solve(P, 1, { notch: false, plates: [false, false] });
    const dUnit = u.maxSag;
    let w;
    if (P.load.mode === 'limit') w = P.load.limit / dUnit; else w = P.load.w_plf / 12;
    const baseline = solve(P, w, { notch: false, plates: [false, false] });
    const damaged = solve(P, w, { notch: P.notch.enabled, plates: [false, false] });
    const single = solve(P, w, { plates: [true, false] });
    const dbl = solve(P, w, { plates: [true, true] });
    const check = P.check === 2 ? 2 : 1;
    const repaired = check === 2 ? dbl : single;
    const scen = [baseline, damaged, single, dbl];
    const twist = scen.map(r => twistOf(P, r, w));

    // plate thickness sweep (one plate and two plates)
    const sweep = [];
    [2, 3, 4, 5, 6, 7, 8].map(n => n / 16).forEach(t => {
      const Q = clone(P); Q.plates[0].t = t; Q.plates[1].t = t;
      sweep.push({ t, sag: solve(Q, w, { plates: [true, false] }).maxSag, sag2: solve(Q, w, { plates: [true, true] }).maxSag });
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
    const sB = stress(baseline), sD = stress(damaged), sS = stress(single), sT = stress(dbl), sR = stress(repaired);
    // ---- wood checks (NDS 2015 3.4.3, 5.3.6, 5.3.10, 5.4.5)
    const bm = P.beam, CDw = bm.CD || 1, Cvr = 0.72;
    const Vat = x => repaired.R - w * (x - repaired.xs1);
    const xface = repaired.xs1 + bm.bearing / 2;               // face of the support
    const Fv = bm.Fv * CDw;                                    // Fv' without Cvr
    const FvR = bm.Fv * CDw * Cvr;                             // Fv' x Cvr (notches, connections: 5.3.10)
    const Vd = Math.abs(Vat(xface + bm.d));                     // 3.4.3.1: V at d from the support face
    const vEnd = 1.5 * Vd / (bm.b * bm.d);
    // volume factor CV, Southern Pine x = 20 (5.3.6); CL = 1.0 assumed (compression edge braced)
    const Lft = (bm.Ltot - bm.bearing) / 12;
    const Cv = Math.min(1, Math.pow(21 / Lft, 1 / 20) * Math.pow(12 / bm.d, 1 / 20) * Math.pow(5.125 / bm.b, 1 / 20));
    const FbAdj = bm.Fb * CDw * Cv;
    let shearNotch = null, shearConn = null;
    if (P.notch.enabled) {
      const nx0 = P.notch.center - P.notch.length / 2, nx1 = P.notch.center + P.notch.length / 2;
      const dn = bm.d - P.notch.depth;
      const V = Math.max(Math.abs(Vat(nx0)), Math.abs(Vat(nx1)));
      const Vr = (2 / 3) * FvR * bm.b * dn * Math.pow(dn / bm.d, 2);   // Eq. 3.4-3 (tension-face notch)
      shearNotch = { V, Vr, dn };
    }
    if (P.fast.type !== 'nail' && active.length) {
      // 3.4.3.3: bolts / lag screws in a bending member: de = depth less distance from the unloaded edge to the fastener centre
      let xmin = Infinity, ylow = Infinity, yhigh = -Infinity;
      active.forEach(p => { if (p.xsF.length && p.ys.length) { xmin = Math.min(xmin, p.xsF[0]); ylow = Math.min(ylow, p.ys[0]); yhigh = Math.max(yhigh, p.ys[p.ys.length - 1]); } });
      if (isFinite(xmin)) {
        const de = Math.min(bm.d - ylow, yhigh);             // conservative: try each edge as the "unloaded" edge
        const within5d = xmin < 5 * bm.d;
        const Vr = within5d ? (2 / 3) * FvR * bm.b * de * Math.pow(de / bm.d, 2) : (2 / 3) * FvR * bm.b * de;
        shearConn = { V: Math.abs(Vat(xface)), Vr, de, within5d, xmin };
      }
    }

    // warnings: short title (t) + detail (d), shown collapsed in the UI
    const D = fastenerD(P.fast);
    if (shearConn && shearConn.V > shearConn.Vr) W('End shear at the connection is too high', 'NDS 3.4.3.3: bolts or lag screws within 5d (' + (5 * bm.d).toFixed(1) + '") of the beam end cut the allowable shear to ' + shearConn.Vr.toFixed(0) + ' lb, against ' + shearConn.V.toFixed(0) + ' lb at the support face. Start the fasteners at least 5d from the end (raise "Plate end to first fastener"), or have the end shear checked by an engineer.');
    if (P.notch.enabled) {
      W('The notch is damage the code does not allow', 'NDS 5.4.5.1 does not permit notching the tension side of a glulam bending member except at the ends for bearing, and then only to the lesser of 1/10 of the depth or 3". This notch is existing damage, so the repair is outside the code and needs an engineer\'s judgement. Stress concentration at the notch corners and crack growth (NDS 3.2.3.1) are not captured by the beam model.');
      W('Blocking in the notch', 'The plate ignores the notch and is fastened into blocking that fills it. The model lets those fasteners carry load as if in sound wood but gives the blocking no bending stiffness, so the beam stays notched. The blocking must be firmly attached to the beam for this to hold.');
    }
    if (P.fast.type !== 'nail') {
      if (P.fast.pitch < 4 * D) W('Fastener spacing is tight', 'Spacing in a row (' + P.fast.pitch + '") is under 4D = ' + (4 * D).toFixed(2) + '": geometry factor CΔ = pitch/4D applies (Table 12.5.1B); under 3D is not permitted.');
      const ysP = active.length ? active[0].ys : [];
      if (ysP.length > 1 && ysP[1] - ysP[0] < 1.5 * D) W('Rows are too close', 'Row spacing is less than 1.5D = ' + (1.5 * D).toFixed(2) + '" (Table 12.5.1D).');
      const capSpread = P.fast.type === 'lag' ? 6 : 10;
      W('Row spread limit', 'Table 12.5.1F limits the distance across the grain between the outermost ' + (P.fast.type === 'lag' ? 'lag screws' : 'bolts') + ' in glulam to ' + capSpread + '". Rows are placed within it.');
      W('Hole clearance not modelled', 'Initial slip before bearing (holes are 1/32" to 1/16" oversize, NDS 12.1.3.2) is not modelled; the real stiffness gain will be lower if the holes are loose.');
    } else {
      W('Nailing through steel', 'Nails through steel plate need pre-punched or pre-drilled holes, and spacing, end and edge distances for D < 1/4" must prevent splitting (NDS 12.1.1, 12.5.1.1). Reference Z for nails assumes A653 Grade 33 plate in gauge thicknesses; this tool uses A36 bearing (87,000 psi).');
    }
    if (P.fast.type === 'nail' && active.some(p => p.t > 0.25)) W('Nails through thick plate', 'Nailing through plate thicker than 1/4" is generally impractical.');
    active.forEach(p => { if (!p.ys.length) W('No room for fasteners', 'Plate ' + (p.idx + 1) + ': no room for fastener rows between the plate edges and the beam edges.'); });
    if (P.fast.type !== 'bolt' && nPl === 2) W('Stagger the fasteners', 'With two plates and lag screws or nails, stagger the fasteners from the two faces so screws from opposite sides do not meet inside the 3.5" beam.');
    checks.fasteners.forEach(f => f.cap.notes.forEach(n => { if (!warn.some(x => x.d === n)) W('Fastener not permitted', n); }));
    const twistNote = Math.abs(twist[2].deg) > 0.001 ? 'A single plate stiffens one side, so the beam twists slightly. Estimated peak twist ' + Math.abs(twist[2].deg).toFixed(2) + '° with the ends held; plates on both faces cancel it.' : null;

    return {
      P, w, wPlf: w * 12, dUnit, baseline, damaged, single, double: dbl, scen, twist, check, repaired, sweep, checks, warn, twistNote,
      wood: { base: sB, dam: sD, single: sS, double: sT, rep: sR, vEnd, Fv, FvR, Cv, FbAdj, shearNotch, shearConn },
    };
  }

  return {
    defaults, clone, solve, analyze, NAILS, LAGS, BOLTS,
    fastenerD, fastenerFyb, fastenerCapacity, slipModulus, groupCg, zSingle, zDouble, minMode,
    plateRange, plateClampedGeom, rowsY, fastenerXs, FES_STEEL, FeWood, fastenerDy, Ebend, twistOf,
  };
});
