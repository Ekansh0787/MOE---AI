// Minimalist canvas charts (no external libraries).
// Charts are re-rendered on window resize and pick up CSS theme variables.

const Charts = (() => {
  const registry = new Set();

  const cssVar = (name) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || null;
  };
  const colors = {
    text: () => cssVar('--text-2') || '#6b7280',
    grid: () => cssVar('--border') || '#e6e8ec',
    accent: () => cssVar('--accent') || '#6366f1',
    green: () => cssVar('--green') || '#16a34a',
  };

  function prep(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, height);
    return { ctx, w: cssW, h: height };
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function fmtValue(v, fmt) {
    if (typeof fmt === 'function') return fmt(v);
    if (typeof v === 'number') {
      if (Math.abs(v) >= 1000) return v.toLocaleString();
      if (Math.abs(v) >= 100) return v.toFixed(0);
      if (Math.abs(v) >= 1) return v.toFixed(1);
      return v.toFixed(2);
    }
    return String(v);
  }

  function axis(pad) {
    return { top: 18, right: 10, bottom: 26, left: pad };
  }

  // Vertical bars; supports multiple series, optionally stacked.
  function drawBars(canvas, opts) {
    registry.add(canvas);
    const h = opts.height || 190;
    const series = opts.series || [{ name: 'value', data: opts.data || [], color: opts.color || colors.accent() }];
    const labels = opts.labels || series[0].data.map((_, i) => String(i));
    const stacked = !!opts.stacked;
    const padL = opts.leftPad != null ? opts.leftPad : 38;
    const pad = axis(padL);
    const { ctx, w, h: H } = prep(canvas, h);
    const plotW = w - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const n = labels.length;
    const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.data[i] || 0), 0));
    const maxV = Math.max(1, ...totals) * 1.12;

    // grid + y labels
    ctx.font = '10px ' + (cssVar('--font') || 'sans-serif');
    ctx.fillStyle = colors.text();
    ctx.strokeStyle = colors.grid();
    ctx.lineWidth = 1;
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const y = pad.top + plotH - (plotH * t) / ticks;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      const v = (maxV * t) / ticks;
      ctx.textAlign = 'right';
      ctx.fillText(fmtValue(v, opts.format), pad.left - 6, y + 3);
    }

    if (n === 0) return;

    const groupW = plotW / n;
    const barW = Math.min(26, groupW * 0.62);
    const step = series.length > 1 && !stacked ? barW / series.length : 0;

    for (let i = 0; i < n; i++) {
      const cx = pad.left + groupW * i + groupW / 2;
      let acc = 0;
      for (let s = 0; s < series.length; s++) {
        const v = series[s].data[i] || 0;
        if (v <= 0) continue;
        let x, bw;
        if (stacked) {
          x = cx - barW / 2;
          bw = barW;
        } else {
          x = cx - barW / 2 - step * (series.length - 1) / 2 + s * step;
          bw = Math.max(2, barW - step);
        }
        const bh = (v / maxV) * plotH;
        const y = pad.top + plotH - acc - bh;
        ctx.fillStyle = series[s].color;
        ctx.fillRect(x, y, bw, bh);
        acc += bh;
      }
      // value label on top of stacked/total
      ctx.fillStyle = colors.text();
      ctx.textAlign = 'center';
      ctx.fillText(fmtValue(totals[i], opts.format), cx, pad.top + plotH - acc - 4);

      // x labels
      ctx.fillStyle = colors.text();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, H);
      ctx.clip();
      ctx.textAlign = 'center';
      ctx.fillText(truncate(labels[i], 14), cx, H - 8);
      ctx.restore();
    }
  }

  function drawLine(canvas, opts) {
    registry.add(canvas);
    const h = opts.height || 190;
    const data = opts.data || [];
    const labels = opts.labels || data.map((_, i) => String(i));
    const color = opts.color || colors.accent();
    const pad = { top: 18, right: 10, bottom: 26, left: opts.leftPad != null ? opts.leftPad : 40 };
    const { ctx, w, h: H } = prep(canvas, h);
    const plotW = w - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const maxV = Math.max(1, ...data) * 1.12;

    ctx.font = '10px ' + (cssVar('--font') || 'sans-serif');
    ctx.strokeStyle = colors.grid();
    ctx.lineWidth = 1;
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const y = pad.top + plotH - (plotH * t) / ticks;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      const v = (maxV * t) / ticks;
      ctx.fillStyle = colors.text();
      ctx.textAlign = 'right';
      ctx.fillText(fmtValue(v, opts.format), pad.left - 6, y + 3);
    }

    if (data.length === 0) return;
    const n = data.length;
    const x = (i) => pad.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const y = (v) => pad.top + plotH - (v / maxV) * plotH;

    // area fill
    ctx.beginPath();
    ctx.moveTo(x(0), pad.top + plotH);
    data.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(n - 1), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = color + '22';
    ctx.fill();

    // line
    ctx.beginPath();
    data.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // dots + labels
    data.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(v), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = colors.text();
      ctx.textAlign = 'center';
      const every = Math.ceil(n / 12);
      if (i % every === 0 || i === n - 1) {
        ctx.fillText(truncate(labels[i], 12), x(i), H - 8);
      }
    });
  }

  function drawDonut(canvas, opts) {
    registry.add(canvas);
    const size = opts.size || 160;
    const { ctx, w, h: H } = prep(canvas, size);
    const data = opts.data || [];
    const palette = opts.colors || [colors.accent(), colors.green(), '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#64748b'];
    const total = data.reduce((a, b) => a + b, 0);
    const cx = w / 2;
    const cy = H / 2;
    const r = Math.min(w, H) / 2 - 8;

    ctx.textAlign = 'center';
    if (total === 0) {
      ctx.fillStyle = colors.grid();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.text();
      ctx.font = '11px ' + (cssVar('--font') || 'sans-serif');
      ctx.fillText('No data', cx, cy + 4);
      return;
    }

    let angle = -Math.PI / 2;
    ctx.lineWidth = Math.max(10, r * 0.3);
    data.forEach((v, i) => {
      const frac = v / total;
      ctx.beginPath();
      ctx.arc(cx, cy, r, angle, angle + frac * Math.PI * 2);
      ctx.strokeStyle = palette[i % palette.length];
      ctx.stroke();
      angle += frac * Math.PI * 2;
    });
    ctx.fillStyle = colors.text();
    ctx.font = '700 ' + (r * 0.42) + 'px ' + (cssVar('--font') || 'sans-serif');
    ctx.fillText(String(total), cx, cy + r * 0.14);
  }

  window.addEventListener('resize', () => {
    registry.forEach((c) => c && c.__redraw && c.__redraw());
  });

  function register(canvas, redraw) {
    canvas.__redraw = redraw;
    registry.add(canvas);
  }

  return {
    cssVar,
    colors,
    drawBars: (c, o) => { register(c, () => drawBars(c, o)); drawBars(c, o); },
    drawLine: (c, o) => { register(c, () => drawLine(c, o)); drawLine(c, o); },
    drawDonut: (c, o) => { register(c, () => drawDonut(c, o)); drawDonut(c, o); },
  };
})();

window.Charts = Charts;
