# Beam-Fix

Explore how a bottom-face notch in a 3.5" x 13.5" 1.8E Southern Pine glulam header changes its sag, and how much one or
two steel side plates (bolted, lagged or nailed) win back. The web app runs entirely in the browser (no install) and can be
hosted with GitHub Pages from `/docs`.

* **App:** `docs/index.html` (engine in `docs/engine.js`, UI in `docs/ui.js`)
* **Tests:** `node tests/engine.test.js` (closed-form beam theory, parallel-axis composite theory, equilibrium)
* **3-D reference model:** `reference/` (scikit-fem, quadratic hexes, orthotropic wood) and `node reference/compare.js`

> Exploration tool only. A tension-face notch in a structural glulam is a serious defect and a repair of a load-bearing
> member needs a licensed structural engineer.

## Defaults (your beam)
* 1.8E glulam, Southern Pine (G = 0.55), 3.5" x 13.5", 235" long, 3.5" bearing on each jack-stud pair, so the clear opening is 228" (19 ft) and the analysis span is 231.5".
* Load = uniform load that makes the *undamaged* beam sag exactly 5/8" (about 246 lb/ft with shear deflection). That is an upper bound, the real load may be lower.
* Notch 3" x 48" on the bottom, centred 70" from the left end.
* Plate 1 (outside) 3/16" x 13.5", 228" long, lag screws 1/2", 2 rows at 8". Plate 2 (inside) is off by default.
* Plate thickness 1/8"-1/2" (1/16" steps); height 6"-13.5" and bottom-edge location in 1/2" steps. Repair goal 1/4" or 5/8" (or custom).

## Model
Layered Timoshenko beam FE: the wood and each plate have their own axial DOF and share deflection and section rotation; fasteners
are slip springs (K = 270,000 D^1.5 per fastener). Fastener capacity uses the NDS yield-limit equations. See the "Model &
assumptions" panel in the app.

### About the NDS table numbers
The request cited NDS tables 8.2B, 9.3B, 12.3E and 12.3F. I could not map those to a published NDS edition, so the app uses the
underlying equations (yield limit Modes Im-IV, dowel bearing strengths, Rd terms) rather than looked-up table values. Values that
should be verified against your edition are marked in `docs/engine.js` (lag-screw Fyb = 45 ksi is conservative; nail Fyb by diameter;
slip modulus; Fes = 87 ksi). Fb and Fv in the UI are placeholders.

## Develop
```
node tests/engine.test.js
python3 -m http.server -d docs 8000      # then open http://localhost:8000
```
PowerShell on Windows:
```
node tests/engine.test.js
python -m http.server 8000 --directory docs
```

## Validation against the 3-D reference model
`python3 reference/reference_fea.py` builds a 3-D model (quadratic hexahedra, orthotropic wood, steel plates joined by discrete
fastener springs) for the five cases in `reference/cases.json`; `node reference/compare.js` compares the browser engine to the stored
`reference/results.json`. Memory note: the two-plate case needs about 6 GB at the default mesh, so `results.json` holds that case on a
coarser mesh (HX=8", HY=4.5"; the one-plate case moved only 0.09% when coarsened the same way).

| Case | 3-D model max sag | Browser engine | Difference |
|---|---|---|---|
| A undamaged | 0.659" | 0.658" | -0.2% |
| B notch only | 0.895" | 0.879" | -1.8% |
| C notch + 1 plate (3/16") | 0.407" | 0.407" | +0.1% |
| D notch + 2 plates (3/16") | 0.261" | 0.279" | +6.8% (engine conservative) |

Two calibrations were added after the first comparison (fitted to this default geometry only, so treat them as allowances):
* the notch is treated as 1.5 x its depth longer at each end ("end-effect allowance", adjustable); the plain 1-D beam under-predicted
  the notch's extra sag by about 5%;
* peak fastener force carries a 1.5 x local-peaking allowance, because smeared springs gave peaks 20-30% below the 3-D discrete springs.

Case E (fasteners made unphysically stiff) is only a sanity case for deflection; its fastener force is not comparable.
