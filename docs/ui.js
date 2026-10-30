(function () {
  'use strict';
  const BF = window.BeamFix;
  const $ = id => document.getElementById(id);
  let P = BF.defaults();

  /* ---------- persistence in URL hash ---------- */
  function fromHash() {
    try {
      if (location.hash.length > 1) {
        const o = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
        const d = BF.defaults();
        // shallow-merge each section so old links keep working
        Object.keys(d).forEach(k => {
          if (o[k] === undefined) return;
          if (Array.isArray(d[k])) d[k] = d[k].map((x, i) => Object.assign({}, x, o[k][i] || {}));
          else if (typeof d[k] === 'object') d[k] = Object.assign({}, d[k], o[k]);
          else d[k] = o[k];
        });
        return d;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function toHash() { return '#' + btoa(unescape(encodeURIComponent(JSON.stringify(P)))); }
  P = fromHash() || P;

  /* ---------- helpers ---------- */
  const get = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  const set = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };
  const fr16 = x => { const n = Math.round(x * 16); if (n % 16 === 0) return (n / 16) + '"'; const g = (a, b) => b ? g(b, a % b) : a; const d = g(n % 16, 16); const w = Math.floor(n / 16); return (w ? w + ' ' : '') + ((n % 16) / d) + '/' + (16 / d) + '"'; };
  const fin = (x, d) => x.toFixed(d === undefined ? 3 : d) + '"';
  const PLATE_T = [2, 3, 4, 5, 6, 7, 8].map(n => n / 16);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* ---------- input form ---------- */
  function numRow(path, label, min, max, step, unit) {
    const v = get(P, path);
    return `<div class="row"><label for="f_${path}">${label}${unit ? `<span class="u">${unit}</span>` : ''}</label>
      <input type="number" id="f_${path}" data-path="${path}" value="${v}" min="${min}" max="${max}" step="${step}"></div>`;
  }
  function chkRow(path, label) {
    return `<label class="chk"><input type="checkbox" data-path="${path}" data-kind="chk" ${get(P, path) ? 'checked' : ''}> ${label}</label>`;
  }
  function selRow(path, label, opts, kind) {
    const v = get(P, path);
    return `<div class="row sel"><label>${label}</label><select data-path="${path}" data-kind="${kind || 'sel'}">` +
      opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(v) ? 'selected' : ''}>${o[1]}</option>`).join('') + `</select></div>`;
  }
  function plateBlock(i) {
    const pre = `plates.${i}.`;
    const pl = P.plates[i];
    const hmax = P.beam.d, ybmax = Math.max(0, P.beam.d - pl.h);
    return `<fieldset><legend>${i === 0 ? 'Plate 1 (outside face)' : 'Plate 2 (inside face)'}</legend>` +
      chkRow(pre + 'on', 'Plate installed') +
      (pl.on ? selRow(pre + 't', 'Thickness', PLATE_T.map(t => [t, fr16(t)]), 'num') +
        numRow(pre + 'h', 'Height', 6, hmax, 0.5, 'in') +
        numRow(pre + 'yb', 'Bottom edge above beam bottom', 0, ybmax, 0.5, 'in') +
        numRow(pre + 'len', 'Length', 12, P.beam.Ltot, 1, 'in') +
        numRow(pre + 'offset', 'Shift from beam centre', -100, 100, 1, 'in') : '') +
      `</fieldset>`;
  }
  function renderInputs() {
    const f = P.fast;
    const sizeOpts = f.type === 'bolt' ? Object.keys(BF.BOLTS) : Object.keys(BF.LAGS);
    const tgt = [[0.25, '1/4"'], [0.625, '5/8"'], [0.5, '1/2"'], [0.375, '3/8"']];
    const clear = P.beam.Ltot - 2 * P.beam.bearing;
    $('inputs').innerHTML =
      `<fieldset><legend>Beam</legend>
        ${numRow('beam.b', 'Width', 1, 12, 0.125, 'in')}
        ${numRow('beam.d', 'Depth', 6, 30, 0.125, 'in')}
        ${numRow('beam.Ltot', 'Total length', 60, 600, 1, 'in')}
        ${numRow('beam.bearing', 'Bearing length each end', 1, 12, 0.25, 'in')}
        ${numRow('beam.E', 'Ex tabulated (24F-1.8E)', 500000, 3000000, 50000, 'psi')}
        <div class="hint">Clear opening = ${clear}" (${(clear / 12).toFixed(2)} ft); span used (clear + one bearing = centre-to-centre of bearings) = ${clear + P.beam.bearing}".</div>
        ${chkRow('beam.shear', 'Model shear explicitly: shear-free E = 1.05 x tabulated, G = E/16 (NDS App. F)')}
      </fieldset>
      <fieldset><legend>Load</legend>
        ${selRow('load.mode', 'Load basis', [['limit', 'Back-calculate from original limit'], ['manual', 'Enter uniform load']])}
        ${P.load.mode === 'limit' ? numRow('load.limit', 'Original sag limit', 0.05, 3, 0.0625, 'in') : numRow('load.w_plf', 'Uniform load', 1, 5000, 5, 'lb/ft')}
        <div class="hint">Uniform load over the span. Back-calc finds the load that sags the <em>undamaged</em> beam exactly to the limit (an upper bound on the real load).</div>
      </fieldset>
      <fieldset><legend>Damage: bottom notch</legend>
        ${chkRow('notch.enabled', 'Notch present')}
        ${P.notch.enabled ? numRow('notch.length', 'Length', 1, P.beam.Ltot, 0.5, 'in') + numRow('notch.depth', 'Depth', 0.5, P.beam.d - 1, 0.5, 'in') + numRow('notch.center', 'Centre from left end of beam', 0, P.beam.Ltot, 0.5, 'in') + numRow('notch.ext', 'End-effect allowance (x depth)', 0, 3, 0.5, '') : ''}
      </fieldset>
      ${plateBlock(0)}${plateBlock(1)}
      <fieldset><legend>Fasteners (steel plate to wood)</legend>
        ${selRow('fast.type', 'Type', [['lag', 'Lag screws'], ['bolt', 'Through bolts'], ['nail', 'Nails']], 'struct')}
        ${f.type === 'nail' ? selRow('fast.nail', 'Nail', Object.keys(BF.NAILS).map(k => [k, BF.NAILS[k].label])) : selRow('fast.size', 'Diameter', sizeOpts.map(k => [k, k + '"']))}
        ${numRow('fast.rows', 'Rows', 1, 6, 1, '')}
        ${numRow('fast.pitch', 'Spacing in row', 1, 36, 0.5, 'in')}
        ${numRow('fast.edge', 'Plate end to first fastener', 1, 100, 0.5, 'in')}
        ${f.type !== 'bolt' ? numRow('fast.pen', f.type === 'lag' ? 'Lag penetration into beam (incl. tip)' : 'Nail penetration into beam', 0.5, 8, 0.25, 'in') : ''}
        ${numRow('fast.G', 'Specific gravity G (SP glulam 0.55)', 0.3, 0.8, 0.01, '')}
        ${numRow('fast.CD', 'Load duration factor CD', 0.9, 2, 0.05, '')}
        ${chkRow('fast.useCg', 'Also apply NDS group-action factor Cg')}
        <div class="hint">Rows are spaced evenly in the plate, above the notch.</div>
      </fieldset>
      <fieldset><legend>Goal &amp; wood allowables</legend>
        ${selRow('target', 'Repair sag goal', tgt.map(o => [o[0], o[1]]), 'num')}
        ${numRow('target', 'or custom goal', 0.05, 2, 0.0625, 'in')}
        ${numRow('beam.Fb', 'Fbx+ (bottom in tension)', 500, 4000, 50, 'psi')}
        ${numRow('beam.Fv', 'Fvx (shear)', 100, 500, 10, 'psi')}
        <div class="hint">Defaults are NDS 2015 Supplement Table 5A stress class 24F-1.8E: Fbx+ 2400 psi (bottom in tension; Fbx- = 1450 psi if the beam is upside down), Fvx 300 psi for Southern Pine (fn. 3), Ex 1.8E6 psi. Check your beam's grade stamp.</div>
      </fieldset>`;
    bindInputs();
  }
  function bindInputs() {
    document.querySelectorAll('#inputs [data-path]').forEach(el => {
      const path = el.dataset.path, kind = el.dataset.kind;
      if (kind === 'chk') el.addEventListener('change', () => { set(P, path, el.checked); renderInputs(); update(); });
      else if (kind === 'sel') el.addEventListener('change', () => { set(P, path, el.value); renderInputs(); update(); });
      else if (kind === 'struct') el.addEventListener('change', () => {
        set(P, path, el.value);
        if (P.fast.type === 'bolt' && !BF.BOLTS[P.fast.size]) P.fast.size = '1/2';
        if (P.fast.type === 'lag' && !BF.LAGS[P.fast.size]) P.fast.size = '1/2';
        renderInputs(); update();
      });
      else if (kind === 'num') el.addEventListener('change', () => { set(P, path, parseFloat(el.value)); renderInputs(); update(); });
      else {
        el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v)) { set(P, path, v); update(); } });
        el.addEventListener('change', () => { clampAll(); renderInputs(); update(); });
      }
    });
  }
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function clampAll() {
    P.notch.length = clamp(P.notch.length, 1, P.beam.Ltot);
    P.notch.depth = clamp(P.notch.depth, 0.5, P.beam.d - 1);
    P.notch.center = clamp(P.notch.center, P.notch.length / 2, P.beam.Ltot - P.notch.length / 2);
    P.plates.forEach(pl => {
      pl.h = clamp(Math.round(pl.h * 2) / 2, 6, P.beam.d);
      pl.yb = clamp(Math.round(pl.yb * 2) / 2, 0, P.beam.d - pl.h);
      pl.len = clamp(pl.len, 12, P.beam.Ltot);
    });
    P.fast.rows = clamp(Math.round(P.fast.rows), 1, 6);
  }

  /* ---------- rendering helpers ---------- */
  function pill(ok, a, b) { return `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? a : b}</span>`; }

  function renderElevation(A) {
    const W = 960, m = 20, sx = (W - 2 * m) / P.beam.Ltot, sy = sx;
    const H = P.beam.d * sy + 78, y0 = 34;
    const X = x => m + x * sx, Y = y => y0 + (P.beam.d - y) * sy; // y from bottom
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Beam elevation">`;
    // load arrows
    const xs1 = P.beam.bearing / 2, xs2 = P.beam.Ltot - P.beam.bearing / 2;
    for (let x = xs1; x <= xs2 + 0.01; x += (xs2 - xs1) / 30) s += `<line x1="${X(x)}" y1="${y0 - 16}" x2="${X(x)}" y2="${y0 - 3}" stroke="#667085" stroke-width="1"/>`;
    s += `<text x="${X(xs2)}" y="${y0 - 20}" text-anchor="end">w = ${A.wPlf.toFixed(0)} lb/ft over the span</text>`;
    s += `<rect x="${X(0)}" y="${Y(P.beam.d)}" width="${P.beam.Ltot * sx}" height="${P.beam.d * sy}" fill="var(--wood)" stroke="#8b6a3a"/>`;
    if (P.notch.enabled) {
      const nx0 = P.notch.center - P.notch.length / 2;
      s += `<rect x="${X(nx0)}" y="${Y(P.notch.depth)}" width="${P.notch.length * sx}" height="${P.notch.depth * sy}" fill="#fff" stroke="#c0392b" stroke-dasharray="4 3"/>`;
      s += `<text x="${X(nx0)}" y="${Y(0) + 13}" fill="#c0392b">notch ${P.notch.length}" x ${P.notch.depth}" (centre ${P.notch.center}" from left end)</text>`;
    }
    A.repaired.plates.forEach((p, i) => {
      const inside = p.idx === 1;
      s += `<rect x="${X(p.px0)}" y="${Y(p.yb + p.h)}" width="${(p.px1 - p.px0) * sx}" height="${p.h * sy}" fill="${inside ? 'none' : 'var(--steel)'}" fill-opacity="0.45" stroke="#44546a" stroke-width="1.4" ${inside ? 'stroke-dasharray="6 3"' : ''}/>`;
      p.xsF.forEach(x => p.ys.forEach(y => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="1.6" fill="#1d2430"/>`; }));
      s += `<text x="${X(p.px0) + 2}" y="${Y(p.yb + p.h) - 3}">${inside ? 'inside' : 'outside'} plate ${fr16(p.t)} x ${p.h}" x ${(p.px1 - p.px0).toFixed(0)}"  (bottom at ${p.yb}")</text>`;
    });
    // supports
    [xs1, xs2].forEach(x => {
      s += `<rect x="${X(x - P.beam.bearing / 2)}" y="${Y(0)}" width="${P.beam.bearing * sx}" height="9" fill="#555"/>`;
      s += `<polygon points="${X(x)},${Y(0) + 9} ${X(x) - 7},${Y(0) + 22} ${X(x) + 7},${Y(0) + 22}" fill="#888"/>`;
    });
    s += `</svg><div class="hint">Drawn to scale. Dots = fastener positions (rows x spacing). Dashed outline = plate on the inside face.</div>`;
    $('elev').innerHTML = s;
  }

  function renderDefl(A) {
    const W = 960, Hh = 270, ml = 54, mr = 14, mt = 12, mb = 34;
    const lim = A.P.load.mode === 'limit' ? A.P.load.limit : A.baseline.maxSag;
    const ymax = Math.max(lim, A.damaged.maxSag, A.repaired.maxSag, P.target) * 1.12;
    const X = x => ml + x / P.beam.Ltot * (W - ml - mr), Y = v => mt + v / ymax * (Hh - mt - mb);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%">`;
    const step = ymax > 1.2 ? 0.25 : 0.125;
    for (let v = 0; v <= ymax; v += step) { s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eceff3"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(3)}</text>`; }
    for (let x = 0; x <= P.beam.Ltot; x += 40) s += `<text x="${X(x)}" y="${Hh - 16}" text-anchor="middle">${x}</text>`;
    s += `<text x="${(ml + W - mr) / 2}" y="${Hh - 2}" text-anchor="middle">distance from left end of beam (in)  |  sag downward (in)</text>`;
    const line = (res, col, dash) => { let d = ''; for (let k = 0; k < res.nn; k++) d += (k ? 'L' : 'M') + X(res.X[k]).toFixed(1) + ' ' + Y(res.defl[k]).toFixed(1); return `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.4" ${dash ? 'stroke-dasharray="' + dash + '"' : ''}/>`; };
    s += line(A.baseline, 'var(--base)') + line(A.damaged, 'var(--dam)') + line(A.repaired, 'var(--rep)');
    s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(lim)}" y2="${Y(lim)}" stroke="var(--base)" stroke-dasharray="3 4"/><text x="${W - mr - 4}" y="${Y(lim) - 4}" text-anchor="end">original limit ${fr16(lim)}</text>`;
    s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(P.target)}" y2="${Y(P.target)}" stroke="#7a3db8" stroke-dasharray="3 4"/><text x="${W - mr - 4}" y="${Y(P.target) - 4}" text-anchor="end" fill="#7a3db8">repair goal ${fr16(P.target)}</text>`;
    s += `</svg><div class="legend"><span><i style="background:var(--base)"></i>Undamaged</span><span><i style="background:var(--dam)"></i>Notched</span><span><i style="background:var(--rep)"></i>Notched + plate(s)</span></div>`;
    $('defl').innerHTML = s;
  }

  function renderFasteners(A) {
    const c = A.checks;
    if (!A.repaired.plates.length) { $('fast').innerHTML = '<p class="hint">No plate installed.</p>'; $('fastChart').innerHTML = ''; return; }
    const ft = P.fast.type;
    const desc = ft === 'nail' ? BF.NAILS[P.fast.nail].label : `${P.fast.size}" ${ft === 'lag' ? 'lag screw' : 'through bolt'}`;
    let h = `<table><tr><th>${esc(desc)}</th>` + c.fasteners.map(f => `<th>Plate ${f.plate + 1}</th>`).join('') + (c.doubleShear ? '<th>Bolt (double shear)</th>' : '') + '</tr>';
    const row = (lbl, fn, ds) => { h += `<tr><td>${lbl}</td>` + c.fasteners.map(f => `<td>${fn(f)}</td>`).join('') + (c.doubleShear ? `<td>${ds ? ds(c.doubleShear) : ''}</td>` : '') + '</tr>'; };
    const n0 = c.fasteners[0].cap;
    row('Rows x fasteners per row', f => `${f.rows} x ${f.n}`);
    row('Dowel bearing Fem (wood, || grain)', f => f.cap.Fem.toFixed(0) + ' psi');
    row('Bending yield Fyb', f => f.cap.Fyb.toFixed(0) + ' psi');
    row('Diameter in yield equations', f => f.cap.Dy.toFixed(3) + '"' + (f.cap.Dy !== f.cap.D ? ' (root dia., 12.3.7)' : ''));
    if (c.fasteners.some(f => f.cap.pen)) row('Penetration (excl. tip) / needed for full Z', f => f.cap.pen ? f.cap.pen.excl.toFixed(2) + '" / ' + f.cap.pen.need8D.toFixed(2) + '"' : '-');
    ['Im', 'Is', 'II', 'IIIm', 'IIIs', 'IV'].forEach(m => { if (f0has(m)) row('Mode ' + m + ' (lb)', f => f.cap.modes[m] !== undefined ? f.cap.modes[m].toFixed(0) : '-', d => d.cap.modes[m] !== undefined ? d.cap.modes[m].toFixed(0) : '-'); });
    function f0has(m) { return c.fasteners.some(f => f.cap.modes[m] !== undefined) || (c.doubleShear && c.doubleShear.cap.modes[m] !== undefined); }
    row('Reference Z (controlling mode)', f => f.cap.Zref.toFixed(0) + ' lb (' + f.cap.mode + ')', d => d.cap.Zref.toFixed(0) + ' lb (' + d.cap.mode + ')');
    row('Adjustment: CD x CM x Ct x penetration x C\u0394', f => f.cap.adj.toFixed(2) + ' (pen ' + f.cap.penFactor.toFixed(2) + ', C\u0394 ' + f.cap.Cdelta.toFixed(2) + ')' + (f.cap.Cg ? ' x Cg ' + f.cap.Cg.toFixed(2) : ''), d => d.cap.adj.toFixed(2));
    row("Adjusted Z' along grain", f => f.cap.Zadj.toFixed(0) + ' lb', d => d.cap.Zadj.toFixed(0) + ' lb');
    row('Peak fastener force (FE peak x ' + (P.fast.peak || 1) + ' local allowance)', f => f.demand.toFixed(0) + ' lb', d => d.demand.toFixed(0) + ' lb');
    row('Utilisation (shear flow)', f => pill(f.demand / f.cap.Zadj <= 1, (100 * f.demand / f.cap.Zadj).toFixed(0) + '%', (100 * f.demand / f.cap.Zadj).toFixed(0) + '%'), d => pill(d.demand / d.cap.Zadj <= 1, (100 * d.demand / d.cap.Zadj).toFixed(0) + '%', (100 * d.demand / d.cap.Zadj).toFixed(0) + '%'));
    row('Vertical load-transfer per fastener', f => f.Fy.toFixed(0) + ' lb (plate carries ' + (100 * f.share).toFixed(0) + '% of M)');
    row("Adjusted Z' perpendicular to grain", f => f.cap.ZadjPerp.toFixed(0) + ' lb');
    row('Combined (elliptical interaction)', f => { const u = Math.hypot(f.demand / f.cap.Zadj, f.Fy / f.cap.ZadjPerp); return pill(u <= 1, (100 * u).toFixed(0) + '%', (100 * u).toFixed(0) + '%'); });
    row('Slip modulus per fastener', f => (f.cap.K / 1000).toFixed(0) + ' kip/in');
    h += '</table>';
    $('fast').innerHTML = h;

    // chart of force along span
    const W = 960, Hh = 210, ml = 54, mr = 14, mt = 10, mb = 30;
    let fmax = 0; A.repaired.plates.forEach(p => p.F.forEach(f => fmax = Math.max(fmax, Math.abs(f))));
    const cap = Math.max(...c.fasteners.map(f => f.cap.Zadj));
    const ymax = Math.max(fmax, cap) * 1.1 || 1;
    const X = x => ml + x / P.beam.Ltot * (W - ml - mr), Y = v => mt + (1 - v / ymax) * (Hh - mt - mb);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="100%">`;
    const st = Math.pow(10, Math.floor(Math.log10(ymax))) / (ymax / Math.pow(10, Math.floor(Math.log10(ymax))) > 5 ? 1 : 2);
    for (let v = 0; v <= ymax; v += st) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eceff3"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`;
    for (let x = 0; x <= P.beam.Ltot; x += 40) s += `<text x="${X(x)}" y="${Hh - 14}" text-anchor="middle">${x}</text>`;
    s += `<text x="${(ml + W - mr) / 2}" y="${Hh - 1}" text-anchor="middle">position along beam (in)  |  force per fastener (lb)</text>`;
    const cols = ['#1f5fbf', '#a35a00'];
    A.repaired.plates.forEach((p, i) => {
      s += p.xsF.map((x, j) => `<line x1="${X(x)}" x2="${X(x)}" y1="${Y(0)}" y2="${Y(Math.abs(p.F[j]))}" stroke="${cols[i]}" stroke-width="3" stroke-opacity="0.8"/>`).join('');
      s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(c.fasteners[i].cap.Zadj)}" y2="${Y(c.fasteners[i].cap.Zadj)}" stroke="${cols[i]}" stroke-dasharray="4 3"/>`;
    });
    s += `</svg><div class="legend"><span><i style="background:#1f5fbf"></i>Plate ${A.repaired.plates[0].idx + 1} fastener force</span>${A.repaired.plates[1] ? '<span><i style="background:#a35a00"></i>Plate 2 fastener force</span>' : ''}<span>dashed = adjusted capacity Z′</span></div>`;
    $('fastChart').innerHTML = s;
  }

  function renderSweep(A) {
    let h = '<table><tr><th>Plate thickness (each)</th>' + A.sweep.map(s => `<th>${fr16(s.t)}</th>`).join('') + '</tr><tr><td>Max sag</td>';
    h += A.sweep.map(s => `<td ${Math.abs(s.t - P.plates[0].t) < 1e-6 ? 'style="background:#eef4ff;font-weight:700"' : ''}>${fin(s.sag)}</td>`).join('') + '</tr><tr><td>Meets goal ' + fr16(P.target) + '</td>';
    h += A.sweep.map(s => `<td>${pill(s.sag <= P.target + 1e-9, 'yes', 'no')}</td>`).join('') + '</tr></table>';
    $('sweep').innerHTML = h;
  }

  function renderWood(A) {
    const w = A.wood, Fb = w.FbAdj;
    const r = (lbl, s) => `<tr><td>${lbl}</td><td>${s.tens.toFixed(0)} psi</td><td>${pill(s.tens <= Fb, (100 * s.tens / Fb).toFixed(0) + '% of Fb′', (100 * s.tens / Fb).toFixed(0) + '% of Fb′')}</td><td>${s.comp.toFixed(0)} psi</td><td>@ ${s.tensX.toFixed(0)}"</td></tr>`;
    const u = (V, Vr) => `<td>${V.toFixed(0)} lb</td><td>${Vr.toFixed(0)} lb</td><td>${pill(V <= Vr, (100 * V / Vr).toFixed(0) + '%', (100 * V / Vr).toFixed(0) + '%')}</td>`;
    let h = `<table><tr><th>Bending</th><th>Peak tension (bending + axial)</th><th>vs Fb′ = Fbx+ x CD x CV = ${Fb.toFixed(0)}</th><th>Peak compression</th><th>Where</th></tr>
      ${r('Undamaged', w.base)}${r('Notched', w.dam)}${r('Notched + plate(s)', w.rep)}</table>
      <table style="margin-top:8px"><tr><th>Shear (NDS 3.4.3)</th><th>Actual V</th><th>Allowable V′</th><th>Ratio</th></tr>
      <tr><td>At d from support face, full section (3.4.3.1; Fv′ = ${w.Fv.toFixed(0)} psi)</td>${u(w.vEnd * (2 / 3) * P.beam.b * P.beam.d, w.Fv * (2 / 3) * P.beam.b * P.beam.d)}</tr>`;
    if (w.shearNotch) h += `<tr><td>At the notch, tension face (Eq. 3.4-3, Fv′ x Cvr 0.72 = ${w.FvR.toFixed(0)} psi, dn = ${w.shearNotch.dn}")</td>${u(w.shearNotch.V, w.shearNotch.Vr)}</tr>`;
    if (w.shearConn) h += `<tr><td>At the bolt/lag connection (3.4.3.3, de = ${w.shearConn.de.toFixed(1)}", ${w.shearConn.within5d ? 'within 5d of the end' : 'beyond 5d'}, Cvr 0.72)</td>${u(w.shearConn.V, w.shearConn.Vr)}</tr>`;
    h += `</table><p class="hint">Stresses come from the 1-D layered model: no stress concentration at notch corners, CL = 1.0 assumed (compression edge braced), bearing at the jack studs not checked. CV = ${w.Cv.toFixed(3)} (Southern Pine, x = 20). Shear checks ignore the plates' contribution.</p>`;
    $('wood').innerHTML = h;
  }

  function renderNotes(A) {
    const clear = P.beam.Ltot - 2 * P.beam.bearing;
    $('notes').innerHTML = `<ul>
      <li><b>Geometry</b>: ${P.beam.b}" x ${P.beam.d}" x ${P.beam.Ltot}" beam bearing ${P.beam.bearing}" on each jack-stud pair; clear opening ${clear}"; span for analysis ${clear + P.beam.bearing}" (clear + one bearing length).</li>
      <li><b>Load</b>: uniform line load between the bearing centres. ${P.load.mode === 'limit' ? `Back-calculated so the undamaged beam sags exactly ${fr16(P.load.limit)} (= ${A.wPlf.toFixed(1)} lb/ft). Real load is probably lower, since the limit is a ceiling, not a measurement.` : 'Entered manually.'}</li>
      <li><b>Model</b>: Timoshenko beam elements (&le;1" long). Wood and each plate have their own axial displacement; all share deflection and section rotation. Fasteners are linear slip springs between wood and plate (smeared along the fastener zone). The notch reduces the wood section and shifts its centroid.</li>
      <li><b>NDS edition</b>: your NDS 2015 copy. Fastener capacities follow Table 12.3.1A (yield limit equations), 12.3.1B (Rd), 12.3.3 / 12.3.3A (dowel bearing; G = 0.55 for Southern Pine glulam per Supplement Table 5A fn. 10), 11.3.6 (group action Cg and 270,000 D<sup>1.5</sup> slip modulus), 12.5.1B/D/F (spacing, rows, glulam row spread). The engine reproduces the tabulated Z values of Tables 12D and 12I (bolts, glulam, 1/4" steel plate, single and double shear), 12K (lag screws, reduced-body diameter, p = 8D) and 12P (nails) to within 2% (see <code>tests/nds_tables.test.js</code>). Lag screw Fyb 70/60/45 ksi by size, nails 100/90/80/70 ksi by diameter, bolts 45 ksi, steel Fe = 87,000 psi (A36).</li>
      <li><b>Glulam values</b>: Supplement Table 5A, stress class 24F-1.8E. The tabulated Ex is an apparent modulus that already includes shear deflection; with shear modelled explicitly the engine uses the shear-free E = 1.05 Ex and G = E/16 (App. F.3.1), so the undamaged sag matches 5wL<sup>4</sup>/384EI to about 0.2%.</li>
      <li><b>Not modelled</b>: stress concentration at the notch corners, crack growth, bolt-hole oversize slip, creep, lateral-torsional buckling, bearing at supports, plate local buckling, fire.</li>
      <li><b>Calibration vs the 3-D model</b>: the 1-D beam alone under-predicts the extra sag from a notch (about 5%), so the notch is treated as ${P.notch.ext === undefined ? 1.5 : P.notch.ext} x its depth longer at each end (end-effect allowance); fastener peaks from smeared springs run 20-30% below the 3-D discrete-spring peaks, so peak fastener force carries a 1.5x allowance. Both are adjustable/disclosed and were fitted to the default geometry only.</li>
      <li><b>Validation</b>: automated tests check closed-form beam and parallel-axis composite theory; a separate 3-D finite-element model (quadratic hexes, discrete fastener springs) agrees on sag within 2% undamaged / notched / one plate and is 7% higher than the 3-D result with two plates (see repository).</li></ul>`;
  }

  function renderWarnings(A) {
    let h = '';
    A.warn.forEach(w => { h += `<div class="w">${esc(w)}</div>`; });
    $('warnings').innerHTML = h;
  }

  function renderCards(A) {
    const lim = P.load.mode === 'limit' ? P.load.limit : A.baseline.maxSag;
    const red = (1 - A.repaired.maxSag / A.damaged.maxSag) * 100;
    const fu = A.checks.fasteners.length ? Math.max(...A.checks.fasteners.map(f => Math.hypot(f.demand / f.cap.Zadj, f.Fy / f.cap.ZadjPerp))) : 0;
    const okGoal = A.repaired.maxSag <= P.target + 1e-9;
    $('cards').innerHTML = `
      <div class="card"><h3>Uniform load</h3><div class="big">${A.wPlf.toFixed(0)} <span style="font-size:15px">lb/ft</span></div><div class="small">${P.load.mode === 'limit' ? 'back-calculated from ' + fr16(P.load.limit) + ' limit' : 'entered'}; total ${(A.w * (P.beam.Ltot - P.beam.bearing) / 1000).toFixed(2)} kip</div></div>
      <div class="card"><h3>Undamaged</h3><div class="big" style="color:var(--base)">${fin(A.baseline.maxSag)}</div><div class="small">max sag</div></div>
      <div class="card"><h3>Notched</h3><div class="big" style="color:var(--dam)">${fin(A.damaged.maxSag)}</div><div class="small">${(100 * (A.damaged.maxSag / A.baseline.maxSag - 1)).toFixed(0)}% more than undamaged ${pill(A.damaged.maxSag <= lim + 1e-9, 'within limit', 'exceeds limit')}</div></div>
      <div class="card"><h3>Notched + plate(s)</h3><div class="big" style="color:var(--rep)">${A.repaired.plates.length ? fin(A.repaired.maxSag) : '-'}</div><div class="small">${A.repaired.plates.length ? red.toFixed(0) + '% less than notched ' + pill(okGoal, 'meets ' + fr16(P.target) + ' goal', 'misses ' + fr16(P.target) + ' goal') : 'no plate installed'}</div></div>
      <div class="card"><h3>Fasteners</h3><div class="big">${A.repaired.plates.length ? (100 * fu).toFixed(0) + '%' : '-'}</div><div class="small">worst utilisation (shear flow + vertical transfer) ${A.repaired.plates.length ? pill(fu <= 1, 'OK', 'overstressed') : ''}</div></div>`;
  }

  /* ---------- main update ---------- */
  function update() {
    let A;
    try { A = BF.analyze(P); } catch (e) { $('cards').innerHTML = `<div class="w err" style="padding:12px">Calculation error: ${esc(e.message)}</div>`; return; }
    renderCards(A); renderWarnings(A); renderElevation(A); renderDefl(A); renderFasteners(A); renderSweep(A); renderWood(A); renderNotes(A);
    history.replaceState(null, '', toHash());
  }

  $('btnReset').addEventListener('click', () => { P = BF.defaults(); renderInputs(); update(); });
  $('btnLink').addEventListener('click', () => {
    const url = location.href.split('#')[0] + toHash();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { $('btnLink').textContent = 'Link copied'; setTimeout(() => $('btnLink').textContent = 'Copy share link', 1500); }, () => { prompt('Copy this link:', url); });
  });
  clampAll(); renderInputs(); update();
})();
