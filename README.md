# Beam-Fix

Explore how a bottom-face notch in a 3.5" x 13.5" 1.8E Southern Pine glulam header changes its sag, and how much one or
two steel side plates (bolted, lagged or nailed) win back. The web app runs entirely in the browser (no install) and can be
hosted with GitHub Pages from `/docs`.

* **App:** `docs/index.html` (engine in `docs/engine.js`, UI in `docs/ui.js`)
* **Tests:** `node tests/engine.test.js` (closed-form beam theory, parallel-axis composite theory, equilibrium) and `node tests/nds_tables.test.js` (41 values from NDS Tables 12D/12I/12K/12P)
* **3-D reference model:** `reference/` (scikit-fem, quadratic hexes, orthotropic wood) and `node reference/compare.js`

> Exploration tool only. A tension-face notch in a structural glulam is a serious defect and a repair of a load-bearing
> member needs a licensed structural engineer.

## Defaults (your beam)
* 1.8E glulam, Southern Pine (G = 0.55), 3.5" x 13.5", 235" long, 3.5" bearing on each jack-stud pair, so the clear opening is 228" (19 ft) and the analysis span is 231.5".
* Load = uniform load that makes the *undamaged* beam sag exactly 5/8" (about 258 lb/ft). That is an upper bound, the real load may be lower.
* Notch 3" x 48" on the bottom, centred 70" from the left end.
* Plate 1 (outside) 3/16" x 13.5", 228" long, lag screws 1/2" (3" penetration), 2 rows at 8". Plate 2 (inside) is off by default.
* Plate thickness 1/8"-1/2" (1/16" steps); height 6"-13.5" and bottom-edge location in 1/2" steps. Repair goal 1/4" or 5/8" (or custom).

## Model
Layered Timoshenko beam FE: the wood and each plate have their own axial DOF and share deflection and section rotation; fasteners
are slip springs (K = 270,000 D^1.5 per fastener). Fastener capacity uses the NDS yield-limit equations. See the "Model &
assumptions" panel in the app.

### NDS provisions used (NDS 2015 edition, plus the 2015 Supplement)
Glulam values: Supplement **Table 5A**, stress class **24F-1.8E** (Fbx+ 2400 psi, Fvx 300 psi for Southern Pine per footnote 3, Ex 1.8E6 psi;
G = 0.55 for fastener design per footnote 10). The tabulated E is an *apparent* modulus that already includes shear deflection (Appendix F.3.1), so
with shear modelled explicitly the engine uses shear-free E = 1.05 Ex and G = E/16.

Connections (Chapter 11 and 12):
* **Table 12.3.1A / 12.3.1B** yield limit equations (single and double shear) and reduction term Rd; **Table 12.3.3** dowel bearing Fe;
  Fes = 87,000 psi for A36 plate.
* **Tables 12D, 12I** (bolts, glulam main member, 1/4" A36 plate, single / double shear), **12K** (lag screws, steel side plate, reduced-body diameter
  Dr from Appendix **Table L2**, penetration factor p/8D, minimum 4D), **12P** (nails, steel side plate, penetration p/10D, minimum 6D).
  `tests/nds_tables.test.js` checks 41 tabulated values; all agree within 2%.
* **11.3.6** group action factor Cg (optional in the app; off by default because the FE already captures non-uniform fastener load) and slip modulus
  270,000 D^1.5; **Table 12.5.1B/D/F** spacing, row spacing and the glulam limit on the distance between outer rows (lag screws 6", bolts 10").
* **3.4.3.2 / 3.4.3.3 / 5.3.10** shear at the notch (Eq. 3.4-3) and at bolt/lag connections within 5d of the end, with Cvr = 0.72; **5.3.6** volume factor.
* **5.4.5.1**: the tension side of a glulam bending member may not be notched except at the ends for bearing (depth <= the lesser of d/10 or 3").
  The damage in this project is outside that rule, so the app always flags it.

Assumptions still to be confirmed: plate steel is A36 (Fe 87 ksi), lag screws are reduced-body, rows of fasteners are staggered/spaced so that screws from
opposite faces do not meet, and CL = 1.0 (compression edge braced).

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
