"""Twist check: 3-D reference model, case C_notch_1plate (default mesh HX=4, HY=3.4).
theta(x) = mean over wood y-levels of [uy(x,y,z=0) - uy(x,y,z=b)] / b   (positive: plate-side face z=0 sags LESS).
Writes reference/twist_3d.json.  Run: python3 reference/twist_check.py"""
import json, os, re, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "reference_fea.py")).read()
hook = '''    uw = u[:wb.N]
    # ---- twist hook (twist_check.py)
    _sel = (compw == 1)
    _pts = {}
    for _x, _y, _z, _v in zip(locw[0][_sel], locw[1][_sel], locw[2][_sel], uw[_sel]):
        _pts[(round(float(_x), 5), round(float(_y), 5), round(float(_z), 5))] = float(_v)
    _by = {}
    for (_x, _y, _z), _v in _pts.items():
        _by.setdefault((_x, _y), {})[_z] = _v
    _th = {}
    for (_x, _y), _d in _by.items():
        if 0.0 in _d and round(float(b), 5) in _d:
            _th.setdefault(_x, []).append((_d[0.0] - _d[round(float(b), 5)]) / b)
    _xs = sorted(_th)
    TWIST_OUT["x"] = _xs
    TWIST_OUT["theta_rad"] = [float(np.mean(_th[_x])) for _x in _xs]
    TWIST_OUT["n_levels"] = [len(_th[_x]) for _x in _xs]
    _mx = round(float((xs1 + xs2) / 2), 5)
    _lv = [(_y, _d) for (_x, _y), _d in _by.items() if _x == _mx and 0.0 in _d and round(float(b), 5) in _d]
    TWIST_OUT["mid_uy_diff_by_y"] = {str(_y): _d[0.0] - _d[round(float(b), 5)] for _y, _d in sorted(_lv)}
    TWIST_OUT["mid_uy_z0_bottom"] = _by.get((_mx, 0.0), {}).get(0.0)
'''
assert src.count("    uw = u[:wb.N]\n") == 1
src = src.replace("    uw = u[:wb.N]\n", hook)
ns = {"__name__": "ref_mod", "__file__": os.path.join(HERE, "reference_fea.py"), "TWIST_OUT": {}}
exec(compile(src, "reference_fea_patched", "exec"), ns)
ns["HX"], ns["HY"] = 4.0, 3.4
cases = {c["name"]: c for c in json.load(open(os.path.join(HERE, "cases.json")))["cases"]}
t0 = time.time()
out = ns["run_case"](cases["C_notch_1plate"])
res = dict(ns["TWIST_OUT"]); res["summary"] = out; res["runtime_s"] = round(time.time() - t0, 1)
json.dump(res, open(os.path.join(HERE, "twist_3d.json"), "w"))
print("done", res["runtime_s"], "s; delta_mid", out["delta_mid"])
