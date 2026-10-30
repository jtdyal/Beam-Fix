#!/usr/bin/env python3
"""3D reference FE model of the notched / plated glulam beam (see CASE_SCHEMA.md).

Units: inch, lb, psi.  Quadratic (27-node) hexahedra from scikit-fem.
Wood: orthotropic, uncoupled (all Poisson ratios 0).  Steel plates: isotropic.
Plates are separate meshes joined to the wood ONLY by lumped fastener springs.
Run:  python3 reference/reference_fea.py   ->  reference/results.json
"""
import json, math, os, sys, time
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from skfem import (MeshHex, Basis, FacetBasis, ElementHex2, ElementVector,
                   BilinearForm, LinearForm)

HERE = os.path.dirname(os.path.abspath(__file__))
KZ_TIE = 1.0e8          # lb/in, z tie at fasteners
HX, HY = 4.0, 3.4       # max element sizes (in); A changes <0.2% when refined to 2.0/1.5
TRANSVERSE_RATIO = 1.0  # override Ey/E=Ez/E (None -> use cases.json). See README: Ey=E/20 adds ~2% bearing-crush
                        # deflection that a 1D beam model cannot represent.
TOL = 1e-6


def subdivide(bps, hmax):
    bps = sorted(set(round(float(v), 6) for v in bps))
    out = [bps[0]]
    for a, b in zip(bps[:-1], bps[1:]):
        n = max(1, int(math.ceil((b - a) / hmax - 1e-9)))
        out += [a + (b - a) * k / n for k in range(1, n + 1)]
    return np.array(out)


def comp_array(basis):
    comp = np.full(basis.N, -1, dtype=int)
    for arr in (basis.nodal_dofs, basis.edge_dofs, basis.facet_dofs, basis.interior_dofs):
        for c in range(arr.shape[0]):
            comp[arr[c]] = c
    assert (comp >= 0).all()
    return comp


def make_forms(Ex, Ey, Ez, Gxy, Gyz, Gxz, iso=None):
    """Bilinear form for a (diagonal-C orthotropic) or isotropic material."""
    if iso is None:
        @BilinearForm
        def a(u, v, w):
            gu, gv = u.grad, v.grad
            return (Ex * gu[0][0] * gv[0][0] + Ey * gu[1][1] * gv[1][1] + Ez * gu[2][2] * gv[2][2]
                    + Gxy * (gu[0][1] + gu[1][0]) * (gv[0][1] + gv[1][0])
                    + Gyz * (gu[1][2] + gu[2][1]) * (gv[1][2] + gv[2][1])
                    + Gxz * (gu[0][2] + gu[2][0]) * (gv[0][2] + gv[2][0]))
        return a
    E, nu = iso
    lam = E * nu / ((1 + nu) * (1 - 2 * nu))
    mu = E / (2 * (1 + nu))

    @BilinearForm
    def a(u, v, w):
        gu, gv = u.grad, v.grad
        tru = gu[0][0] + gu[1][1] + gu[2][2]
        trv = gv[0][0] + gv[1][1] + gv[2][2]
        e = 0.0
        for i in range(3):
            for j in range(3):
                e = e + (gu[i][j] + gu[j][i]) * (gv[i][j] + gv[j][i]) * 0.5
        return lam * tru * trv + mu * e
    return a


def find_dofs(loc, comp, x, y, z, c):
    m = (np.abs(loc[0] - x) < TOL) & (np.abs(loc[1] - y) < TOL) & (np.abs(loc[2] - z) < TOL) & (comp == c)
    idx = np.nonzero(m)[0]
    return int(idx[0]) if len(idx) else None


def run_case(cs):
    t0 = time.time()
    bm, st, ld, nt = dict(cs["beam"]), cs["steel"], cs["load"], cs["notch"]
    if TRANSVERSE_RATIO is not None:
        bm["Ey_over_E"] = bm["Ez_over_E"] = TRANSVERSE_RATIO
    b, d, Lt, bear = bm["b"], bm["d"], bm["Ltot"], bm["bearing"]
    E = bm["E"]
    xs1, xs2 = bear / 2, Lt - bear / 2
    w = ld["w_lb_per_in"]
    plates = cs["plates"]
    nx0, nx1 = nt["center"] - nt["length"] / 2, nt["center"] + nt["length"] / 2
    ndep = nt["depth"] if nt["enabled"] else 0.0

    # ---- breakpoints
    bx = [0, xs1, xs2, Lt, (xs1 + xs2) / 2]
    by = [0, d]
    if nt["enabled"]:
        bx += [nx0, nx1]
        by += [ndep]
    for p in plates:
        bx += [p["x0"], p["x1"]] + list(p["fastener_x"])
        by += [p["yb"], p["yb"] + p["h"]] + list(p["fastener_y"])
    X = subdivide(bx, HX)
    Y = subdivide(by, HY)
    Zw = np.array([0, b / 2, b])

    # ---- wood
    mesh = MeshHex.init_tensor(X, Y, Zw)
    if nt["enabled"]:
        c = mesh.p[:, mesh.t].mean(axis=1)
        kill = np.nonzero((c[0] > nx0) & (c[0] < nx1) & (c[1] < ndep))[0]
        mesh = mesh.remove_elements(kill)
    elem = ElementVector(ElementHex2())
    wb = Basis(mesh, elem)
    Gxy = E * bm["G_over_E"]
    Aw = make_forms(E, E * bm["Ey_over_E"], E * bm["Ez_over_E"], Gxy, Gxy / 10, Gxy)
    Kw = Aw.assemble(wb)
    # load: traction on top face between supports
    fac = mesh.facets_satisfying(lambda p: (np.abs(p[1] - d) < TOL) & (p[0] > xs1 - TOL) & (p[0] < xs2 + TOL))
    fb = FacetBasis(mesh, elem, facets=fac)
    p_area = w / b

    @LinearForm
    def load(v, _):
        return -p_area * v.value[1]
    fw = load.assemble(fb)
    locw, compw = wb.doflocs, comp_array(wb)

    # ---- plates
    blocks = [Kw]
    rhs = [fw]
    offs = [0]
    pdata = []
    ntot = wb.N
    steel_form = make_forms(None, None, None, None, None, None, iso=(st["E"], st["nu"]))
    for p in plates:
        xs = X[(X > p["x0"] - TOL) & (X < p["x1"] + TOL)]
        ys = Y[(Y > p["yb"] - TOL) & (Y < p["yb"] + p["h"] + TOL)]
        z0 = -p["t"] if p["side"] == "outside" else b
        pm = MeshHex.init_tensor(xs, ys, np.array([z0, z0 + p["t"]]))
        pb = Basis(pm, elem)
        Kp = steel_form.assemble(pb)
        blocks.append(Kp)
        rhs.append(np.zeros(pb.N))
        offs.append(ntot)
        pdata.append(dict(basis=pb, off=ntot, loc=pb.doflocs, comp=comp_array(pb), side=p["side"], p=p))
        ntot += pb.N
    K = sp.block_diag(blocks, format="lil")
    f = np.concatenate(rhs)

    # ---- springs
    springs = []   # (plate_idx, ix_plate, ix_wood, Kx)
    for ip, pd in enumerate(pdata):
        p = pd["p"]
        zf_w = 0.0 if pd["side"] == "outside" else b
        zf_p = 0.0 if pd["side"] == "outside" else b
        nskip = 0
        for fx in p["fastener_x"]:
            for fy in p["fastener_y"]:
                if nt["enabled"] and nx0 - TOL < fx < nx1 + TOL and fy < ndep - TOL:
                    nskip += 1
                    continue
                dw = {c: find_dofs(locw, compw, fx, fy, zf_w, c) for c in range(3)}
                dp = {c: find_dofs(pd["loc"], pd["comp"], fx, fy, zf_p, c) for c in range(3)}
                assert None not in dw.values() and None not in dp.values(), (fx, fy)
                for c, k in ((0, p["K_x"]), (1, p["K_y"]), (2, KZ_TIE)):
                    i, j = pd["off"] + dp[c], dw[c]
                    K[i, i] += k; K[j, j] += k; K[i, j] -= k; K[j, i] -= k
                    if c == 0:
                        springs.append((ip, i, j, k))
    K = K.tocsr()

    # ---- boundary conditions
    fixed = []
    m = ((np.abs(locw[0] - xs1) < TOL) | (np.abs(locw[0] - xs2) < TOL)) & (np.abs(locw[1]) < TOL) & (compw == 1)
    fixed += list(np.nonzero(m)[0])
    fixed.append(find_dofs(locw, compw, xs1, 0.0, 0.0, 0))
    fixed.append(find_dofs(locw, compw, xs1, 0.0, 0.0, 2))
    fixed = np.array(sorted(set(fixed)))
    free = np.setdiff1d(np.arange(ntot), fixed)
    u = np.zeros(ntot)
    Kff = K[free][:, free].tocsc()
    u[free] = spla.spsolve(Kff, f[free])
    uw = u[:wb.N]

    # ---- outputs
    xmid = (xs1 + xs2) / 2
    mm = (np.abs(locw[0] - xmid) < TOL) & (np.abs(locw[1]) < TOL) & (compw == 1)
    delta_mid = -float(uw[mm].mean())
    # delta_max: top-face (y=d) wood nodes, z-averaged
    mb = (np.abs(locw[1] - d) < TOL) & (compw == 1)   # top face: exists everywhere (also over the notch)
    xb = locw[0][mb]; ub = uw[mb]
    xu = np.unique(np.round(xb, 6))
    prof = np.array([ub[np.abs(xb - xv) < TOL].mean() for xv in xu])
    k = int(np.argmin(prof))
    out = dict(delta_mid=delta_mid, delta_max=-float(prof[k]), x_at_max=float(xu[k]))
    fm = {}
    for ip, i, j, kx in springs:
        F = float(abs(kx * (u[i] - u[j])))
        fm[ip] = max(fm.get(ip, 0.0), F)
    if fm:
        ipm = max(fm, key=fm.get)
        out["max_spring_force_x"] = fm[ipm]
        out["max_spring_force_plate"] = plates[ipm]["side"]
        out["max_spring_force_by_plate"] = {plates[i]["side"]: v for i, v in fm.items()}
        out["n_springs"] = len(springs) // max(1, len(pdata))
    else:
        out["max_spring_force_x"] = None
        out["max_spring_force_plate"] = None
    out["Ey_over_E_used"] = bm["Ey_over_E"]
    out["nodes_wood"] = int(wb.N // 3)
    out["dofs_total"] = int(ntot)
    out["elements"] = int(mesh.t.shape[1] + sum(pd["basis"].mesh.t.shape[1] for pd in pdata))
    out["runtime_s"] = round(time.time() - t0, 1)
    return out


def closed_form(cs):
    bm = cs["beam"]; b, d, E = bm["b"], bm["d"], bm["E"]
    L = bm["Ltot"] - bm["bearing"]
    I = b * d ** 3 / 12; A = b * d; G = E * bm["G_over_E"]; w = cs["load"]["w_lb_per_in"]
    return 5 * w * L ** 4 / (384 * E * I) + w * L ** 2 / (8 * (5 / 6) * G * A)


def transformed_EI(cs):
    """Full-composite theory (plates rigidly connected, plate centroid offset ignored for interface)."""
    bm = cs["beam"]; b, d, Ew = bm["b"], bm["d"], bm["E"]; Es = cs["steel"]["E"]
    # layers: (E, A, I, ycentroid)
    layers = [(Ew, b * d, b * d ** 3 / 12, d / 2)]
    for p in cs["plates"]:
        layers.append((Es, p["t"] * p["h"], p["t"] * p["h"] ** 3 / 12, p["yb"] + p["h"] / 2))
    EA = sum(l[0] * l[1] for l in layers)
    yb = sum(l[0] * l[1] * l[3] for l in layers) / EA
    return sum(l[0] * (l[2] + l[1] * (l[3] - yb) ** 2) for l in layers)


def _job(job):
    global TRANSVERSE_RATIO
    name, cs, ratio = job
    if ratio is not None:
        TRANSVERSE_RATIO = ratio
    return name, run_case(cs)


def main():
    cases = json.load(open(os.path.join(HERE, "cases.json")))["cases"]
    only = sys.argv[1:]
    res = {}
    T0 = time.time()
    sel = [cs for cs in cases if not only or cs["name"][0] in only or cs["name"] in only]
    jobs = [(cs["name"], cs, None) for cs in sel]
    if not only or "A" in only:   # diagnostic: baseline with the cases.json transverse modulus (Ey=Ez=E/20)
        a = next(c for c in cases if c["name"].startswith("A"))
        jobs.append(("A_baseline_diag_Ey_E_over_20", a, a["beam"]["Ey_over_E"]))
    jobs.sort(key=lambda j: -len(j[1]["plates"]))   # heavy first
    import multiprocessing as mp
    with mp.Pool(2, maxtasksperchild=1) as pool:
        for name, r in pool.imap_unordered(_job, jobs):
            res[name] = r
            print(name, json.dumps(r), flush=True)
    A = next((c for c in cases if c["name"].startswith("A")), None)
    summary = {}
    if A and "A_baseline" in res:
        cf = closed_form(A)
        summary["A_closed_form_timoshenko"] = cf
        summary["A_error_pct_mid"] = 100 * (res["A_baseline"]["delta_mid"] - cf) / cf
        # bending-only for reference
        bm = A["beam"]; L = bm["Ltot"] - bm["bearing"]; I = bm["b"] * bm["d"] ** 3 / 12
        summary["A_bending_only"] = 5 * A["load"]["w_lb_per_in"] * L ** 4 / (384 * bm["E"] * I)
    Ecase = next((c for c in cases if c["name"].startswith("E")), None)
    if Ecase and "E_notch_1plate_stiff" in res:
        # sanity: beam without notch, full-composite EI, uniform section (ignores notch) -> lower bound on delta
        EI = transformed_EI(Ecase)
        L = Ecase["beam"]["Ltot"] - Ecase["beam"]["bearing"]
        summary["E_full_composite_unnotched_bending_delta"] = 5 * Ecase["load"]["w_lb_per_in"] * L ** 4 / (384 * EI)
    res["_summary"] = summary
    res["_total_runtime_s"] = round(time.time() - T0, 1)
    if not only:
        json.dump(res, open(os.path.join(HERE, "results.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))
    print("total runtime", res["_total_runtime_s"], "s")


if __name__ == "__main__":
    main()
