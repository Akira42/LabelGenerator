import roboto400 from '@fontsource/roboto/files/roboto-latin-400-normal.woff2?inline';
import roboto500 from '@fontsource/roboto/files/roboto-latin-500-normal.woff2?inline';
import roboto700 from '@fontsource/roboto/files/roboto-latin-700-normal.woff2?inline';

// Tuning knobs: change these after a test print.
export const ZPL = {
  dpi: 203,        // use 300 if your printer has the optional 300 dpi head
  threshold: 140,  // image mode: higher = bolder/blacker, lower = thinner
  heightRatio: 1,  // native mode: text too big/small? adjust (e.g. 0.9 or 1.1)
  widthRatio: 0,   // native mode: 0 = printer's default; try 0.9 if text is too wide
  baseline: 0.78,  // native mode: text too high/low? raise/lower this a little
  boldFrom: 600,   // native mode: weights >= this are printed with a double strike
};

const clean = (s) => s.replace(/[\^~]/g, ' ');

const FONT_CSS = [[400, roboto400], [500, roboto500], [700, roboto700]]
  .map(
    ([w, src]) =>
      `@font-face{font-family:'Roboto';font-weight:${w};font-style:normal;src:url(${src}) format('woff2');}`
  )
  .join('');

// Split one <text> into visual lines, with start/end x and baseline y in label units.
function readLines(el) {
  const m = el.transform.baseVal.consolidate()?.matrix;
  const tx = m?.e ?? 0;
  const ty = m?.f ?? 0;
  const str = el.textContent;
  const n = Math.min(el.getNumberOfChars(), str.length);
  if (!n) return [];

  // font weight per character (the footer mixes bold and regular tspans)
  const base = parseInt(getComputedStyle(el).fontWeight) || 400;
  const weights = new Array(n).fill(base);
  let off = 0;
  for (const t of el.querySelectorAll('tspan')) {
    if (t.querySelector('tspan')) continue; // only leaf tspans
    const w = parseInt(getComputedStyle(t).fontWeight) || base;
    for (let i = 0; i < t.textContent.length && off + i < n; i++) weights[off + i] = w;
    off += t.textContent.length;
  }

  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = el.getStartPositionOfChar(i);
    const y = Math.round((ty + p.y) * 10) / 10;
    let L = lines.at(-1);
    if (!L || Math.abs(L.y - y) > 0.3) {
      L = { y, x0: tx + p.x, text: '', weight: weights[i] };
      lines.push(L);
    }
    L.text += str[i];
    L.x1 = tx + el.getEndPositionOfChar(i).x;
  }
  return lines;
}

// Renders the SVG to a 1-bit ^GFA graphic.
// full = true keeps text and lines (Roboto image mode); false keeps only graphics.
async function bitmap(svg, W, H, rot, full) {
  const clone = svg.cloneNode(true);
  if (!full) {
    clone.querySelectorAll('text').forEach((t) => t.remove());
    clone.querySelectorAll(':scope > rect').forEach((r) => r.remove());
  } else {
    // images can't see the page's fonts, so embed Roboto inside the SVG
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = FONT_CSS;
    clone.insertBefore(style, clone.firstChild);
    // white background instead of the grey preview color
    // const bg = clone.querySelector(':scope > rect');
    // if (bg) bg.setAttribute('style', 'fill:#fff');
  }
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);
  clone.setAttribute('preserveAspectRatio', 'none');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
  );
  const img = new Image();
  await new Promise((ok, fail) => {
    img.onload = ok;
    img.onerror = fail;
    img.src = url;
  });

  // the page is turned when rotated, so width and height swap
  const outW = rot ? H : W;
  const outH = rot ? W : H;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    if (rot === 90) {
      ctx.translate(H, 0);
      ctx.rotate(Math.PI / 2);
    } else if (rot === 270) {
      ctx.translate(0, W);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(img, 0, 0, W, H);
  };
  draw();
  if (full) {
    // embedded fonts can be late on the first draw: wait a moment and draw again
    await new Promise((r) => setTimeout(r, 150));
    draw();
  }
  URL.revokeObjectURL(url);

  const px = ctx.getImageData(0, 0, outW, outH).data;
  const rowBytes = Math.ceil(outW / 8);
  const rows = [];
  for (let y = 0; y < outH; y++) {
    let row = '';
    for (let bx = 0; bx < rowBytes; bx++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const x = bx * 8 + b;
        let bit = 0;
        if (x < outW) {
          const i = (y * outW + x) * 4;
          bit = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < ZPL.threshold ? 1 : 0;
        }
        byte = (byte << 1) | bit;
      }
      row += byte.toString(16).padStart(2, '0');
    }
    rows.push(row);
  }
  const total = rowBytes * outH;
  return `^GFA,${total},${total},${rowBytes},${rows.join('').toUpperCase()}`;
}

// rotation: 0 = portrait 60x90, 90 = turned clockwise, 270 = turned counter-clockwise
// mode: 'image' = everything as a Roboto bitmap, 'native' = printer font for text
export async function buildZpl(svg, { copies = 1, rotation = 0, mode = 'image', scale = 1 } = {}) {
  await document.fonts.ready;

  const vb = svg.viewBox.baseVal;
  const k = (ZPL.dpi / 72) * scale;
  const W = Math.round(vb.width * k);
  const H = Math.round(vb.height * k);
  const sx = W / vb.width;
  const sy = H / vb.height;

  const PW = rotation ? H : W; // print width across the head
  const LL = rotation ? W : H; // label length along the feed

  const out = ['^XA', '^CI28', `^PW${PW}`, `^LL${LL}`, '^LH0,0', `^PQ${copies}`];

  if (mode === 'image') {
    out.push(`^FO0,0${await bitmap(svg, W, H, rotation, true)}^FS`);
    out.push('^XZ');
    return out.join('\n');
  }

  // maps a rectangle from design dots to page dots
  const place = (x, y, w, h) => {
    if (rotation === 90) return { x: H - (y + h), y: x, w: h, h: w };
    if (rotation === 270) return { x: y, y: W - (x + w), w: h, h: w };
    return { x, y, w, h };
  };
  const orient = rotation === 90 ? 'R' : rotation === 270 ? 'B' : 'N';

  out.push(`^FO0,0${await bitmap(svg, W, H, rotation, false)}^FS`);

  for (const r of svg.querySelectorAll(':scope > rect')) {
    const w = r.width.baseVal.value;
    const h = r.height.baseVal.value;
    if (w >= vb.width - 0.1 && h >= vb.height - 0.1) continue; // background
    const g = place(
      Math.round(r.x.baseVal.value * sx),
      Math.round(r.y.baseVal.value * sy),
      Math.max(2, Math.round(w * sx)),
      Math.max(2, Math.round(h * sy))
    );
    out.push(`^FO${g.x},${g.y}^GB${g.w},${g.h},${Math.min(g.w, g.h)}^FS`);
  }

  for (const el of svg.querySelectorAll('text')) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    const h = Math.round(size * k * ZPL.heightRatio);
    const w = ZPL.widthRatio ? Math.round(h * ZPL.widthRatio) : 0;
    const anchored = el.getAttribute('text-anchor') === 'middle';

    for (const L of readLines(el)) {
      const text = clean(L.text.trim());
      if (!text) continue;

      const c = (L.x0 + L.x1) / 2;
      let align, boxX, boxW;
      if (Math.abs(c - vb.width / 2) < 4) {
        align = 'C'; boxX = 0; boxW = vb.width;
      } else if (anchored) {
        const half = Math.min(c, vb.width - c);
        align = 'C'; boxX = c - half; boxW = 2 * half;
      } else {
        align = 'L'; boxX = L.x0; boxW = vb.width - L.x0;
      }

      const fx = Math.round(boxX * sx);
      const fy = Math.round(L.y * sy - h * ZPL.baseline);
      const fw = Math.round(boxW * sx);
      const field = (dx) => {
        const g = place(fx + dx, fy, fw, h);
        return `^FO${g.x},${g.y}^A0${orient},${h},${w}^FB${fw},1,0,${align},0^FD${text}^FS`;
      };

      out.push(field(0));
      if (L.weight >= ZPL.boldFrom) out.push(field(1));
    }
  }

  out.push('^XZ');
  return out.join('\n');
}