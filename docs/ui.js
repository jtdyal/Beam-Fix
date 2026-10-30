(function () {
  'use strict';
  const BF = window.BeamFix;
  const $ = id => document.getElementById(id);
  const DEF = BF.defaults();
  let P = BF.defaults();
  let A = null;
  let stressMode = 'wood';

  /* ---------- compact share link: only the inputs that differ from the defaults ---------- */
  function flat(o, pre, out) {
    out = out || {};
    Object.keys(o).forEach(k => { const v = o[k], p = pre ? pre + '.' + k : k; if (v !== null && typeof v === 'object') flat(v, p, out); else out[p] = v; });
    return out;
  }
  const get = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
  const set = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };
  function toHash() {
    const f = flat(P), d = flat(DEF), parts = [];
    const mirror = P.plate2same !== false;
    Object.keys(f).forEach(k => { if (mirror && /^plates\.1\.(t|h|yb|len|offset)$/.test(k)) return; if (f[k] !== d[k]) parts.push(k + '=' + encodeURIComponent(f[k])); });
    return parts.length ? '#' + parts.join('&') : '';
  }
  function fromHash() {
    if (location.hash.length < 2) return;
    location.hash.slice(1).split('&').forEach(kv => {
      const i = kv.indexOf('='); if (i < 0) return;
      const k = kv.slice(0, i), raw = decodeURIComponent(kv.slice(i + 1)), dv = get(DEF, k);
      if (dv === undefined) return;
      let v = raw;
      if (typeof dv === 'number') { v = parseFloat(raw); if (!isFinite(v)) return; }
      else if (typeof dv === 'boolean') v = raw === 'true';
      try { set(P, k, v); } catch (e) { /* ignore bad key */ }
    });
  }

  /* ---------- helpers ---------- */
  const fr16 = x => { const n = Math.round(x * 16); if (n % 16 === 0) return (n / 16) + '"'; const g = (a, b) => b ? g(b, a % b) : a; const d = g(n % 16, 16); const w = Math.floor(n / 16); return (w ? w + ' ' : '') + ((n % 16) / d) + '/' + (16 / d) + '"'; };
  const fin = (x, d) => x.toFixed(d === undefined ? 2 : d) + '"';
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const PLATE_T = [2, 3, 4, 5, 6, 7, 8].map(n => n / 16);
  const GOALS = [[0.25, '1/4"'], [0.375, '3/8"'], [0.5, '1/2"'], [0.625, '5/8"']];
  const SC = ['var(--s0)', 'var(--s1)', 'var(--s2)', 'var(--s3)'];
  const SNAME = ['Original', 'Notched', '1 plate', '2 plates'];
  const pill = (ok, txt) => `<span class="pill ${ok ? 'ok' : 'bad'}">${txt}</span>`;

  /* ---------- inputs ---------- */
  const numRow = (path, label, min, max, step, unit) => `<div class="row"><label for="f_${path}">${label}${unit ? `<span class="u">${unit}</span>` : ''}</label>
      <input type="number" inputmode="decimal" id="f_${path}" data-path="${path}" value="${get(P, path)}" min="${min}" max="${max}" step="${step}"></div>`;
  const chkRow = (path, label) => `<label class="chk"><input type="checkbox" data-path="${path}" data-kind="chk" ${get(P, path) ? 'checked' : ''}> ${label}</label>`;
  const selRow = (path, label, opts, kind) => `<div class="row sel"><label>${label}</label><select data-path="${path}" data-kind="${kind || 'sel'}">` +
    opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(get(P, path)) ? 'selected' : ''}>${o[1]}</option>`).join('') + `</select></div>`;
  const acc = (title, body, open, sub) => `<details class="acc" ${open ? 'open' : ''}><summary><span>${title}${sub ? `<small>${sub}</small>` : ''}</span></summary><div class="body">${body}</div></details>`;

  // keep accordions open across re-renders
  const openSet = new Set(['Repair']);
  function keepOpen() { /* open state is tracked by toggle events */ }

  function plateFields(i) {
    const pre = `plates.${i}.`, pl = P.plates[i];
    return numRow(pre + 'h', 'Height', 6, P.beam.d, 0.5, 'in') +
      numRow(pre + 'yb', 'Bottom edge above beam bottom', 0, Math.max(0, P.beam.d - pl.h), 0.5, 'in') +
      numRow(pre + 'len', 'Length', 12, P.beam.Ltot, 1, 'in') +
      numRow(pre + 'offset', 'Shift from beam centre', -100, 100, 1, 'in') +
      selRow(pre + 't', 'Thickness', PLATE_T.map(t => [t, fr16(t)]), 'num');
  }
  function renderControls() {
    const f = P.fast;
    const sizeOpts = f.type === 'bolt' ? Object.keys(BF.BOLTS) : Object.keys(BF.LAGS);
    const clear = P.beam.Ltot - 2 * P.beam.bearing;
    const repair =
      selRow('target', 'Sag goal', GOALS, 'num') +
      selRow('plates.0.t', 'Plate thickness', PLATE_T.map(t => [t, fr16(t)]), 'plate') +
      numRow('plates.0.h', 'Plate height', 6, P.beam.d, 0.5, 'in') +
      numRow('plates.0.yb', 'Plate bottom edge height', 0, Math.max(0, P.beam.d - P.plates[0].h), 0.5, 'in') +
      selRow('fast.type', 'Fasteners', [['lag', 'Lag screws'], ['bolt', 'Through bolts'], ['nail', 'Nails']], 'struct') +
      (f.type === 'nail' ? selRow('fast.nail', 'Nail', Object.keys(BF.NAILS).map(k => [k, BF.NAILS[k].label])) : selRow('fast.size', 'Diameter', sizeOpts.map(k => [k, k + '"']))) +
      `<div class="hint">One plate is on the outside face; two plates add the same plate on the inside face.</div>`;
    const damage = chkRow('notch.enabled', 'Damage present') + (P.notch.enabled ?
      numRow('notch.length', 'Length', 1, P.beam.Ltot, 0.5, 'in') + numRow('notch.depth', 'Depth', 0.5, P.beam.d - 1, 0.5, 'in') +
      numRow('notch.center', 'Centre from left end', 0, P.beam.Ltot, 0.5, 'in') +
      `<div class="hint">Notch is on the bottom face. The plate runs past it and is fastened into blocking that fills the notch.</div>` +
      numRow('notch.ext', 'Stress-disturbed zone (x depth)', 0, 3, 0.5, '') : '');
    const plates = `<div class="sub">Plate 1 (outside)</div>` + numRow('plates.0.len', 'Length', 12, P.beam.Ltot, 1, 'in') + numRow('plates.0.offset', 'Shift from beam centre', -100, 100, 1, 'in') +
      chkRow('plate2same', 'Plate 2 (inside) same as plate 1') +
      (P.plate2same === false ? `<div class="sub">Plate 2 (inside)</div>` + plateFields(1) : '');
    const fasteners = numRow('fast.rows', 'Rows', 1, 6, 1, '') + numRow('fast.pitch', 'Spacing in row', 1, 36, 0.5, 'in') +
      numRow('fast.edge', 'Plate end to first fastener', 1, 100, 0.5, 'in') +
      (f.type !== 'bolt' ? numRow('fast.pen', f.type === 'lag' ? 'Lag penetration into beam (with tip)' : 'Nail penetration', 0.5, 8, 0.25, 'in') : '') +
      numRow('fast.G', 'Specific gravity G', 0.3, 0.8, 0.01, '') + numRow('fast.CD', 'Load duration factor CD', 0.9, 2, 0.05, '') +
      chkRow('fast.useCg', 'Also apply NDS group-action factor Cg');
    const beam = numRow('beam.b', 'Width', 1, 12, 0.125, 'in') + numRow('beam.d', 'Depth', 6, 30, 0.125, 'in') + numRow('beam.Ltot', 'Total length', 60, 600, 1, 'in') +
      numRow('beam.bearing', 'Bearing length each end', 1, 12, 0.25, 'in') + numRow('beam.E', 'Ex tabulated (24F-1.8E)', 500000, 3000000, 50000, 'psi') +
      `<div class="hint">Clear opening ${clear}" (${(clear / 12).toFixed(1)} ft). Span used ${clear + P.beam.bearing}".</div>` +
      chkRow('beam.shear', 'Model shear explicitly (shear-free E = 1.05 x tabulated)') +
      numRow('beam.Fb', 'Fbx+ (bottom in tension)', 500, 4000, 50, 'psi') + numRow('beam.Fv', 'Fvx (shear)', 100, 500, 10, 'psi') +
      `<div class="hint">Defaults: NDS 2015 Supplement Table 5A, 24F-1.8E, Southern Pine. Check your beam's stamp.</div>`;
    const load = selRow('load.mode', 'Load basis', [['limit', 'From original sag limit'], ['manual', 'Enter uniform load']], 'sel') +
      (P.load.mode === 'limit' ? numRow('load.limit', 'Original sag limit', 0.05, 3, 0.0625, 'in') : numRow('load.w_plf', 'Uniform load', 1, 5000, 5, 'lb/ft')) +
      `<div class="hint">The original limit gives the heaviest load the undamaged beam could carry within it; the real load may be lower.</div>`;
    $('controls').innerHTML = acc('Repair', repair, true) + acc('Damage', damage, false, P.notch.enabled ? P.notch.length + '" x ' + P.notch.depth + '"' : 'none') +
      acc('Plate length &amp; plate 2', plates, false) + acc('Fastener layout', fasteners, false) + acc('Beam &amp; load', beam + load, false);
    document.querySelectorAll('#controls details.acc').forEach(d => {
      const k = d.querySelector('summary span').firstChild.textContent;
      d.open = openSet.has(k);
      d.addEventListener('toggle', () => { if (d.open) openSet.add(k); else openSet.delete(k); });
    });
    bind();
  }
  function bind() {
    document.querySelectorAll('#controls [data-path]').forEach(el => {
      const path = el.dataset.path, kind = el.dataset.kind;
      if (kind === 'chk') el.addEventListener('change', () => { set(P, path, el.checked); keepOpen(); renderControls(); update(); });
      else if (kind === 'sel') el.addEventListener('change', () => { set(P, path, el.value); keepOpen(); renderControls(); update(); });
      else if (kind === 'num') el.addEventListener('change', () => { set(P, path, parseFloat(el.value)); update(); });
      else if (kind === 'plate') el.addEventListener('change', () => { const t = parseFloat(el.value); P.plates[0].t = t; P.plates[1].t = t; update(); });
      else if (kind === 'struct') el.addEventListener('change', () => {
        set(P, path, el.value);
        if (P.fast.type !== 'nail' && !(P.fast.type === 'bolt' ? BF.BOLTS : BF.LAGS)[P.fast.size]) P.fast.size = '1/2';
        keepOpen(); renderControls(); update();
      });
      else {
        el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v)) { set(P, path, v); update(); } });
        el.addEventListener('change', () => { clampAll(); keepOpen(); renderControls(); update(); });
      }
    });
  }
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  function clampAll() {
    P.notch.length = clamp(P.notch.length, 1, P.beam.Ltot);
    P.notch.depth = clamp(P.notch.depth, 0.5, P.beam.d - 1);
    P.notch.center = clamp(P.notch.center, P.notch.length / 2, P.beam.Ltot - P.notch.length / 2);
    P.plates.forEach(pl => { pl.h = clamp(Math.round(pl.h * 2) / 2, 6, P.beam.d); pl.yb = clamp(Math.round(pl.yb * 2) / 2, 0, P.beam.d - pl.h); pl.len = clamp(pl.len, 12, P.beam.Ltot); });
    P.fast.rows = clamp(Math.round(P.fast.rows), 1, 6);
  }

  /* ---------- summary bar ---------- */
  function renderSum() {
    const sags = [A.baseline, A.damaged, A.single, A.double].map(r => r.maxSag);
    const lim = P.load.mode === 'limit' ? P.load.limit : A.baseline.maxSag;
    $('sumbar').innerHTML = sags.map((s, i) => {
      const ok = i === 0 ? s <= lim + 1e-6 : s <= P.target + 1e-6;
      const label = i === 0 ? 'limit ' + fr16(lim) : 'goal ' + fr16(P.target);
      return `<div class="chip ${ok ? 'ok' : 'bad'}" style="--c:${SC[i]}"><small>${SNAME[i]}</small><b>${s.toFixed(2)}"</b><small>${ok ? '✓ ' : '✗ '}${label}</small></div>`;
    }).join('');
  }

  /* ---------- notes & warnings (collapsed) ---------- */
  function renderNotes() {
    const items = [{ t: 'Exploration tool, not an engineered design', d: 'This is a simplified beam model with NDS-style fastener capacities. Any repair of a load-bearing beam must be reviewed and stamped by a licensed structural engineer.' }]
      .concat(A.warn);
    if (A.twistNote) items.push({ t: 'One plate twists the beam a little', d: A.twistNote });
    const n = items.length;
    $('notes').innerHTML = `<details class="warnbox"><summary><span>⚠ ${n} things to know</span></summary><div class="body">` +
      items.map(w => `<details class="item"><summary>${esc(w.t)}</summary><p>${esc(w.d)}</p></details>`).join('') + `</div></details>`;
  }

  /* ---------- generic line chart ---------- */
  function lineChart(el, o) {
    const W = Math.max(280, el.clientWidth || 340), H = o.h || 230, ml = 44, mr = 10, mt = 10, mb = 34;
    const X = x => ml + x / P.beam.Ltot * (W - ml - mr);
    const lo = o.ymin, hi = o.ymax;
    const Y = v => mt + (o.invert ? (v - lo) / (hi - lo) : 1 - (v - lo) / (hi - lo)) * (H - mt - mb);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    for (let v = o.ytickStart !== undefined ? o.ytickStart : lo; v <= hi + 1e-9; v += o.ystep) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${ml - 5}" y="${Y(v) + 4}" text-anchor="end">${o.fmt(v)}</text>`;
    for (let x = 0; x <= P.beam.Ltot; x += W < 420 ? 60 : 40) s += `<text x="${X(x)}" y="${H - 18}" text-anchor="middle">${x}</text>`;
    s += `<text x="${(ml + W - mr) / 2}" y="${H - 3}" text-anchor="middle">${o.xlabel}</text>`;
    (o.hlines || []).forEach(h => { s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-dasharray="4 4"/><text x="${W - mr - 3}" y="${Y(h.y) - 4}" text-anchor="end" fill="${h.color}" style="fill:${h.color}">${h.label}</text>`; });
    o.series.forEach(se => { let d = ''; se.x.forEach((x, k) => { d += (k ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(se.y[k]).toFixed(1); }); s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2.4" stroke-linejoin="round"/>`; });
    s += '</svg><div class="legend">' + o.series.map(se => `<span><i style="background:${se.color}"></i>${se.label}</span>`).join('') + '</div>';
    el.innerHTML = s;
  }

  /* ---------- beam elevation ---------- */
  function renderElev() {
    const el = $('elev'), W = Math.max(280, el.clientWidth || 340), m = 12, sx = (W - 2 * m) / P.beam.Ltot;
    const bh = Math.max(46, P.beam.d * sx), sy = bh / P.beam.d, k = sy / sx;
    const H = bh + 76, y0 = 34, X = x => m + x * sx, Y = y => y0 + (P.beam.d - y) * sy;
    const xs1 = P.beam.bearing / 2, xs2 = P.beam.Ltot - P.beam.bearing / 2;
    const res = A.repaired;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Beam elevation">`;
    const na = W < 420 ? 14 : 30;
    for (let i = 0; i <= na; i++) { const x = xs1 + (xs2 - xs1) * i / na; s += `<line x1="${X(x)}" y1="${y0 - 14}" x2="${X(x)}" y2="${y0 - 3}" stroke="var(--mute)"/>`; }
    s += `<text x="${X(xs2)}" y="${y0 - 18}" text-anchor="end">${A.wPlf.toFixed(0)} lb/ft</text>`;
    s += `<rect x="${X(0)}" y="${Y(P.beam.d)}" width="${P.beam.Ltot * sx}" height="${bh}" fill="var(--wood)" stroke="#8b6a3a"/>`;
    if (P.notch.enabled) {
      const nx0 = P.notch.center - P.notch.length / 2;
      s += `<rect x="${X(nx0)}" y="${Y(P.notch.depth)}" width="${P.notch.length * sx}" height="${P.notch.depth * sy}" fill="var(--card)" stroke="var(--s1)" stroke-dasharray="4 3"/>`;
      s += `<text x="${X(nx0)}" y="${Y(0) + 13}" style="fill:var(--s1)">damage ${P.notch.length}" x ${P.notch.depth}"</text>`;
    }
    res.plates.forEach(p => {
      const inside = p.idx === 1;
      s += `<rect x="${X(p.px0)}" y="${Y(p.yb + p.h)}" width="${(p.px1 - p.px0) * sx}" height="${p.h * sy}" fill="${inside ? 'none' : 'var(--steel)'}" fill-opacity="0.5" stroke="var(--platestroke)" stroke-width="1.4" ${inside ? 'stroke-dasharray="6 3"' : ''}/>`;
      p.xsF.forEach(x => p.ys.forEach(y => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="1.5" fill="var(--ink)"/>`; }));
    });
    [xs1, xs2].forEach(x => {
      s += `<rect x="${X(x - P.beam.bearing / 2)}" y="${Y(0)}" width="${Math.max(3, P.beam.bearing * sx)}" height="8" fill="#555"/>`;
      s += `<polygon points="${X(x)},${Y(0) + 8} ${X(x) - 7},${Y(0) + 21} ${X(x) + 7},${Y(0) + 21}" fill="#888"/>`;
    });
    s += `</svg><div class="cap">${res.plates.length === 2 ? 'Solid plate = outside face, dashed = inside face. ' : 'Plate on the outside face. '}Dots are fasteners.${k > 1.15 ? ' Height drawn x' + k.toFixed(1) + ' for visibility.' : ''}</div>`;
    el.innerHTML = s;
  }

  function renderDefl() {
    const lim = P.load.mode === 'limit' ? P.load.limit : A.baseline.maxSag;
    const rs = [A.baseline, A.damaged, A.single, A.double];
    const ymax = Math.max(lim, P.target, ...rs.map(r => r.maxSag)) * 1.12;
    lineChart($('defl'), {
      ymin: 0, ymax, invert: true, ystep: ymax > 1 ? 0.25 : 0.125, fmt: v => v.toFixed(2), xlabel: 'distance from left end (in)  |  sag down (in)',
      hlines: [{ y: lim, color: 'var(--s0)', label: 'original limit ' + fr16(lim) }, { y: P.target, color: 'var(--c3)', label: 'goal ' + fr16(P.target) }],
      series: rs.map((r, i) => ({ x: Array.from(r.X), y: Array.from(r.defl), color: SC[i], label: SNAME[i] + ' ' + r.maxSag.toFixed(2) + '"' })),
    });
  }

  /* ---------- stress heat maps ---------- */
  function heatColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return { zero: dark ? [45, 53, 65] : [242, 242, 242], red: dark ? [235, 90, 80] : [190, 35, 45], blue: dark ? [80, 140, 240] : [35, 95, 185] };
  }
  function drawHeat(cv, res, mode, M, caption) {
    const dpr = window.devicePixelRatio || 1, Wc = cv.clientWidth || 320, Hc = cv.clientHeight || 50;
    cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr);
    const ctx = cv.getContext('2d'), img = ctx.createImageData(cv.width, cv.height), cc = heatColors();
    const d = P.beam.d, L = P.beam.Ltot, E = BF.Ebend(P), Es = P.steel.E, ym = d / 2;
    const col = t => { t = Math.max(-1, Math.min(1, t)); const c = t >= 0 ? cc.red : cc.blue, a = Math.abs(t); return [0, 1, 2].map(i => cc.zero[i] + (c[i] - cc.zero[i]) * a); };
    let e = 0;
    for (let px = 0; px < cv.width; px++) {
      const x = (px + 0.5) / cv.width * L;
      while (e < res.ne - 1 && res.X[e + 1] <= x) e++;
      const el = res.el[e];
      for (let py = 0; py < cv.height; py++) {
        const y = d - (py + 0.5) / cv.height * d;
        let sig = null;
        if (mode === 'wood') { if (y >= el.yn) sig = E * (el.eps0 - (y - ym) * el.curv); }
        else {
          const p = res.plates[0];
          if (p && x >= p.px0 && x <= p.px1 && y >= p.yb && y <= p.yb + p.h) { const pp = el.plate[0]; sig = pp ? Es * (pp.eps0 - (y - p.yc) * el.curv) : 0; }
        }
        const o = (py * cv.width + px) * 4;
        if (sig === null) { img.data[o + 3] = 0; continue; }
        const c = col(sig / M); img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line'); ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
  }
  function renderStress() {
    $('segStress').innerHTML = ['wood', 'plate'].map(m => `<button data-m="${m}" class="${stressMode === m ? 'on' : ''}">${m === 'wood' ? 'Wood' : 'Plate'}</button>`).join('');
    $('segStress').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { stressMode = b.dataset.m; renderStress(); }));
    const rs = [A.baseline, A.damaged, A.single, A.double];
    let M = 1;
    if (stressMode === 'wood') rs.forEach(r => r.el.forEach(e => { M = Math.max(M, Math.abs(e.woodBot), Math.abs(e.woodTop)); }));
    else rs.slice(2).forEach(r => r.el.forEach(e => { const pp = e.plate[0]; if (pp) M = Math.max(M, Math.abs(pp.sBot), Math.abs(pp.sTop)); }));
    M = Math.max(M, 100);
    const fmt = v => stressMode === 'wood' ? Math.round(v) + ' psi' : (v / 1000).toFixed(1) + ' ksi';
    let h = '';
    rs.forEach((r, i) => {
      const noPlate = stressMode === 'plate' && i < 2;
      let note = '';
      if (!noPlate) {
        let t = 0, c = 0;
        r.el.forEach(e => { const arr = stressMode === 'wood' ? [e.woodBot, e.woodTop] : (e.plate[0] ? [e.plate[0].sBot, e.plate[0].sTop] : []); arr.forEach(v => { t = Math.max(t, v); c = Math.max(c, -v); }); });
        note = 'peak ' + fmt(Math.max(t, c)) + (t >= c ? ' tension' : ' compression');
      } else note = 'no plate';
      h += `<div class="hmrow"><span style="color:${SC[i]};font-weight:650">${SNAME[i]}</span><span>${note}</span></div><canvas class="hm" data-i="${i}"></canvas>`;
    });
    h += `<div class="scale" style="background:linear-gradient(90deg,var(--s2),var(--hm0),var(--s1))"></div><div class="scalelbl"><span>−${fmt(M)} compression</span><span>0</span><span>${fmt(M)} tension</span></div>
      <div class="cap">Bending stress along the beam, full depth (height stretched). Red = tension, blue = compression. White gaps are the notch${stressMode === 'plate' ? ' or areas without plate' : ''}.</div>`;
    $('stress').innerHTML = h;
    $('stress').querySelectorAll('canvas').forEach(cv => { const i = +cv.dataset.i; if (stressMode === 'plate' && i < 2) { cv.style.opacity = 0.25; drawHeat(cv, rs[i], 'none', M); } else drawHeat(cv, rs[i], stressMode, M); });
  }

  /* ---------- twist ---------- */
  function renderTwist() {
    const el = $('twist'), tw = A.twist, W = Math.max(280, el.clientWidth || 340);
    const peak = Math.max(...tw.map(t => Math.abs(t.deg)));
    const exag = peak > 1e-6 ? Math.min(400, 14 / peak) : 1;
    const cw = W / 4, s = Math.min(5.2, (cw - 16) / (P.beam.b + 2 * 0.5 + 3)), cy = 78;
    let svg = `<svg viewBox="0 0 ${W} 166" width="${W}" height="166">`;
    tw.forEach((t, i) => {
      const cx = cw * i + cw / 2, ang = -t.deg * exag;
      const b = P.beam.b * s, d = P.beam.d * s;
      svg += `<g transform="translate(${cx},${cy})"><rect x="${-b / 2}" y="${-d / 2}" width="${b}" height="${d}" fill="none" stroke="var(--mute)" stroke-dasharray="2 3" opacity="0.6"/>`;
      svg += `<g transform="rotate(${ang})"><rect x="${-b / 2}" y="${-d / 2}" width="${b}" height="${d}" fill="var(--wood)" stroke="#8b6a3a"/>`;
      if (i === 1 || i === 2 || i === 3) { if (P.notch.enabled) svg += `<rect x="${-b / 2}" y="${d / 2 - P.notch.depth * s}" width="${b}" height="${P.notch.depth * s}" fill="var(--card)" stroke="var(--s1)" stroke-dasharray="3 2"/>`; }
      if (i >= 2) A.scen[i].plates.forEach(p => {
        const tt = Math.max(2, p.t * s * 2.2), x = p.idx === 0 ? -b / 2 - tt : b / 2;
        svg += `<rect x="${x}" y="${d / 2 - (p.yb + p.h) * s}" width="${tt}" height="${p.h * s}" fill="var(--steel)" stroke="var(--platestroke)"/>`;
      });
      svg += `</g></g><text x="${cx}" y="${cy + d / 2 + 22}" text-anchor="middle" style="fill:${SC[i]};font-weight:650">${SNAME[i]}</text>`;
      svg += `<text x="${cx}" y="${cy + d / 2 + 36}" text-anchor="middle">${Math.abs(t.deg) < 0.005 ? 'no twist' : Math.abs(t.deg).toFixed(2) + '°'}</text>`;
    });
    svg += `</svg>`;
    el.innerHTML = `<div class="cap" style="margin:0 0 4px">End view (outside plate on the left). ${peak > 1e-6 ? 'Twist drawn x' + exag.toFixed(0) + ' so it is visible.' : 'No twist in any case.'}</div>` + svg + '<div id="twChart"></div>' +
      `<div class="cap">First-order estimate: one plate stiffens one side, so the load line is off the stiffness centre. Both ends are assumed held against twisting; real framing usually holds the beam straighter.${tw[2].lateralTop > 0.001 ? ' Peak sideways movement of the top edge about ' + tw[2].lateralTop.toFixed(2) + '" with one plate.' : ''}</div>`;
    const ymax = Math.max(0.1, peak * 1.2);
    lineChart($('twChart'), {
      h: 190, ymin: -ymax, ymax, ytickStart: -Math.floor(ymax * 10) / 10, ystep: Math.max(0.05, Math.round(ymax / 2 * 100) / 100), fmt: v => v.toFixed(2),
      xlabel: 'distance from left end (in)  |  twist (deg)', hlines: [{ y: 0, color: 'var(--mute)', label: '' }],
      series: tw.map((t, i) => ({ x: Array.from(t.X), y: Array.from(t.theta, v => v * 180 / Math.PI), color: SC[i], label: SNAME[i] })),
    });
  }

  /* ---------- details (tables) ---------- */
  function renderDetails() {
    const c = A.checks, w = A.wood, ck = A.check;
    const sw = '<table><tr><th>Plate thickness (each)</th>' + A.sweep.map(s => `<th>${fr16(s.t)}</th>`).join('') + '</tr>' +
      '<tr><td>1 plate: sag</td>' + A.sweep.map(s => `<td>${fin(s.sag)}</td>`).join('') + '</tr>' +
      '<tr><td>1 plate: goal</td>' + A.sweep.map(s => `<td>${pill(s.sag <= P.target + 1e-9, s.sag <= P.target + 1e-9 ? 'yes' : 'no')}</td>`).join('') + '</tr>' +
      '<tr><td>2 plates: sag</td>' + A.sweep.map(s => `<td>${fin(s.sag2)}</td>`).join('') + '</tr>' +
      '<tr><td>2 plates: goal</td>' + A.sweep.map(s => `<td>${pill(s.sag2 <= P.target + 1e-9, s.sag2 <= P.target + 1e-9 ? 'yes' : 'no')}</td>`).join('') + '</tr></table>';
    // fastener table for the case selected above the beam picture
    let ft = '';
    if (!A.repaired.plates.length) ft = '<p class="hint">No plate.</p>';
    else {
      const ftype = P.fast.type, desc = ftype === 'nail' ? BF.NAILS[P.fast.nail].label : `${P.fast.size}" ${ftype === 'lag' ? 'lag screw' : 'through bolt'}`;
      ft = `<table><tr><th>${esc(desc)} (${ck} plate${ck > 1 ? 's' : ''})</th>` + c.fasteners.map(f => `<th>Plate ${f.plate + 1}</th>`).join('') + (c.doubleShear ? '<th>Bolt (double shear)</th>' : '') + '</tr>';
      const row = (lbl, fn, ds) => { ft += `<tr><td>${lbl}</td>` + c.fasteners.map(f => `<td>${fn(f)}</td>`).join('') + (c.doubleShear ? `<td>${ds ? ds(c.doubleShear) : ''}</td>` : '') + '</tr>'; };
      const util = (a, b) => pill(a <= b, (100 * a / b).toFixed(0) + '%');
      row('Rows x fasteners per row', f => `${f.rows} x ${f.n}`);
      row('Dowel bearing Fem (wood)', f => f.cap.Fem.toFixed(0) + ' psi');
      row('Bending yield Fyb', f => f.cap.Fyb.toFixed(0) + ' psi');
      row('Diameter in yield equations', f => f.cap.Dy.toFixed(3) + '"' + (f.cap.Dy !== f.cap.D ? ' (root)' : ''));
      if (c.fasteners.some(f => f.cap.pen)) row('Penetration / needed for full Z', f => f.cap.pen ? f.cap.pen.excl.toFixed(2) + '" / ' + f.cap.pen.need8D.toFixed(2) + '"' : '-');
      ['Im', 'Is', 'II', 'IIIm', 'IIIs', 'IV'].forEach(m => { if (c.fasteners.some(f => f.cap.modes[m] !== undefined)) row('Mode ' + m + ' (lb)', f => f.cap.modes[m] !== undefined ? f.cap.modes[m].toFixed(0) : '-', d => d.cap.modes[m] !== undefined ? d.cap.modes[m].toFixed(0) : '-'); });
      row('Reference Z (mode)', f => f.cap.Zref.toFixed(0) + ' lb (' + f.cap.mode + ')', d => d.cap.Zref.toFixed(0) + ' lb (' + d.cap.mode + ')');
      row('Adjustments', f => f.cap.adj.toFixed(2) + ' (pen ' + f.cap.penFactor.toFixed(2) + ', CΔ ' + f.cap.Cdelta.toFixed(2) + ')' + (f.cap.Cg ? ' x Cg ' + f.cap.Cg.toFixed(2) : ''), d => d.cap.adj.toFixed(2));
      row("Adjusted Z' (along grain)", f => f.cap.Zadj.toFixed(0) + ' lb', d => d.cap.Zadj.toFixed(0) + ' lb');
      row('Peak force (FE x ' + (P.fast.peak || 1) + ' allowance)', f => f.demand.toFixed(0) + ' lb', d => d.demand.toFixed(0) + ' lb');
      row('Utilisation', f => f.cap.Zadj > 0 ? util(f.demand, f.cap.Zadj) : pill(false, 'not permitted'), d => d.cap.Zadj > 0 ? util(d.demand, d.cap.Zadj) : '');
      row('Vertical transfer per fastener', f => f.Fy.toFixed(0) + ' lb (plate takes ' + (100 * f.share).toFixed(0) + '% of M)');
      row("Adjusted Z' (across grain)", f => f.cap.ZadjPerp.toFixed(0) + ' lb');
      row('Combined', f => f.cap.Zadj > 0 ? util(Math.hypot(f.demand / f.cap.Zadj, f.Fy / f.cap.ZadjPerp), 1) : '');
      ft += '</table>';
    }
    const Fb = w.FbAdj;
    const r = (lbl, st) => `<tr><td>${lbl}</td><td>${st.tens.toFixed(0)} psi</td><td>${pill(st.tens <= Fb, (100 * st.tens / Fb).toFixed(0) + '%')}</td><td>${st.comp.toFixed(0)} psi</td></tr>`;
    const u = (V, Vr) => `<td>${V.toFixed(0)} lb</td><td>${Vr.toFixed(0)} lb</td><td>${pill(V <= Vr, (100 * V / Vr).toFixed(0) + '%')}</td>`;
    let wd = `<table><tr><th>Bending</th><th>Peak tension</th><th>of Fb′ ${Fb.toFixed(0)}</th><th>Peak compression</th></tr>${r('Original', w.base)}${r('Notched', w.dam)}${r('1 plate', w.single)}${r('2 plates', w.double)}</table>
      <table style="margin-top:8px"><tr><th>Shear (NDS 3.4.3)</th><th>Actual</th><th>Allowed</th><th>Ratio</th></tr>
      <tr><td>At d from support face</td>${u(w.vEnd * (2 / 3) * P.beam.b * P.beam.d, w.Fv * (2 / 3) * P.beam.b * P.beam.d)}</tr>`;
    if (w.shearNotch) wd += `<tr><td>At the notch (Eq. 3.4-3)</td>${u(w.shearNotch.V, w.shearNotch.Vr)}</tr>`;
    if (w.shearConn) wd += `<tr><td>Bolt/lag connection (3.4.3.3, ${w.shearConn.within5d ? 'within 5d of end' : 'beyond 5d'})</td>${u(w.shearConn.V, w.shearConn.Vr)}</tr>`;
    wd += `</table><p class="hint">Beam model: no stress concentration at the notch corners; CV = ${w.Cv.toFixed(3)}; CL = 1.0 assumed. Fb′ = Fbx+ x CD x CV.</p>`;
    const clear = P.beam.Ltot - 2 * P.beam.bearing;
    const how = `<ul style="padding-left:18px;margin:6px 0">
      <li><b>Beam</b>: ${P.beam.b}" x ${P.beam.d}" x ${P.beam.Ltot}", bearing ${P.beam.bearing}" each end, clear opening ${clear}", span ${clear + P.beam.bearing}".</li>
      <li><b>Load</b>: uniform. ${P.load.mode === 'limit' ? 'Back-calculated so the undamaged beam sags exactly ' + fr16(P.load.limit) + ' (' + A.wPlf.toFixed(0) + ' lb/ft). The real load is probably lower.' : 'Entered by you.'}</li>
      <li><b>Model</b>: Timoshenko beam elements; wood and each plate have their own axial motion and share deflection and rotation; fasteners are slip springs. The notch removes wood section but the plate and its fastener rows run straight across it (blocking carries the fasteners, adds no stiffness).</li>
      <li><b>NDS 2015</b>: Supp. Table 5A (24F-1.8E), Tables 12.3.1A/B, 12.3.3, 11.3.6, 12.5.1B/D/F; bolt, lag screw and nail values reproduce Tables 12D, 12I, 12K and 12P within 2% (tests in the repository).</li>
      <li><b>Calibration</b>: the notch counts ${P.notch.ext === undefined ? 1.5 : P.notch.ext}x its depth longer at each end and peak fastener force carries a 1.5x allowance, both fitted to a 3-D model of the default case.</li>
      <li><b>Twist</b>: first-order estimate from the plate's shear share times its offset, ends held.</li>
      <li><b>Not modelled</b>: corner stress concentration, crack growth, hole slip, creep, buckling, support bearing.</li></ul>`;
    $('details').innerHTML = acc('Plate thickness sweep', sw, false) + acc('Fastener check', ft, false, ck + ' plate' + (ck > 1 ? 's' : '')) + acc('Wood checks', wd, false) + acc('How this works', how, false);
    // keep these open/closed state stable between updates is not needed: they are re-created when inputs change
  }

  /* ---------- main update ---------- */
  function update() {
    try { A = BF.analyze(P); } catch (e) { $('sumbar').innerHTML = `<div class="chip bad" style="grid-column:1/-1">Calculation error: ${esc(e.message)}</div>`; return; }
    renderSum(); renderNotes(); renderCheckSeg(); renderElev(); renderDefl(); renderStress(); renderTwist(); renderDetailsKeep();
    history.replaceState(null, '', location.pathname + location.search + toHash());
  }
  function renderCheckSeg() {
    $('segCheck').innerHTML = [1, 2].map(n => `<button data-n="${n}" class="${P.check === n ? 'on' : ''}">${n} plate${n > 1 ? 's' : ''}</button>`).join('');
    $('segCheck').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { P.check = +b.dataset.n; update(); }));
  }
  function renderDetailsKeep() {
    const open = Array.from(document.querySelectorAll('#details details.acc')).map(d => d.open);
    renderDetails();
    document.querySelectorAll('#details details.acc').forEach((d, i) => { if (open[i]) d.open = true; });
  }

  /* ---------- theme, share, reset ---------- */
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); $('btnTheme').textContent = t === 'dark' ? 'Light' : 'Dark'; }
  let theme = null;
  try { theme = localStorage.getItem('bf-theme'); } catch (e) { /* storage may be unavailable */ }
  if (theme !== 'dark' && theme !== 'light') theme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(theme);
  $('btnTheme').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; applyTheme(theme); try { localStorage.setItem('bf-theme', theme); } catch (e) { /* ignore */ } if (A) { renderStress(); } });
  $('btnReset').addEventListener('click', () => { P = BF.defaults(); renderControls(); update(); });
  $('btnLink').addEventListener('click', () => {
    const url = location.origin + location.pathname + toHash();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { $('btnLink').textContent = 'Copied'; setTimeout(() => $('btnLink').textContent = 'Share', 1400); }, () => { prompt('Copy this link:', url); });
  });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (A) { renderElev(); renderDefl(); renderStress(); renderTwist(); } }, 150); });

  fromHash(); clampAll(); renderControls(); update();
})();
