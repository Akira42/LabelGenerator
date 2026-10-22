<script>
  import qz from 'qz-tray';
  import rawSvg from './labels/qdfl.svg?raw';
  import { scopeSvg } from './scopeSvg.js';
  import { buildZpl } from './zpl.js';

  let { active = true } = $props();

  const SCOPE = 'sv-qdfl';
  const svgText = scopeSvg(rawSvg, SCOPE);
  const NS = 'http://www.w3.org/2000/svg';

  const LABEL_W = 100; // mm
  const LABEL_H = 142; // mm
  const PRINT_DPI = 300;
  const STEP = 0.5;
  const MIN_SIZE = 4;
  const MAX_TITLE_SIZE = 70;
  const TITLE_LINE_GAP = 2;
  const CAP = 0.711; // cap height of Roboto, to keep text centered when the size changes
  const MAX_TITLE_W = 270; // widest the title may get, in SVG units
  const MAX_VALUE_W = 68; // widest a table value may get

  // Suggestions for free-text fields, matched against the field name.
  const HINTS = [
    [/PROTE/, ['IP20', 'IP54', 'IP55', 'IP65', 'IP66']],
    [/OPERA/, ['127V', '220V', '127/220V', '220/240V', '380V', '380/220V', '440V']],
  ];

  let container;
  let layout;
  let titleField = $state({ el: null, text: '', size: 0, defSize: 0 });
  let titleLines = $state([]);
  let fields = $state([]);
  let copies = $state(1);
  let rules = $state(true);
  let printers = $state([]);
  let printerName = $state('');
  let status = $state('');

  function loadOffsets() {
    try { return JSON.parse(localStorage.getItem('qdfl-offset')) ?? {}; } catch { return {}; }
  }
  const savedOff = loadOffsets();
  let offX = $state(savedOff.x ?? 0); // mm, positive = right
  let offY = $state(savedOff.y ?? 0); // mm, positive = down
  $effect(() => {
    try { localStorage.setItem('qdfl-offset', JSON.stringify({ x: offX, y: offY })); } catch {}
  });

  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const sizeOf = (el) => Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
  const where = (el) => {
    const m = el.transform.baseVal.consolidate()?.matrix;
    return { x: m?.e ?? 0, y: m?.f ?? 0, sx: m?.a ?? 1 };
  };

  // ---- start when the tab is first opened (hidden tabs can't be measured) ----
  let started = false;
  $effect(() => {
    if (active && !started) {
      started = true;
      start();
    }
  });

  async function start() {
    await Promise.all([400, 500, 700].map((w) => document.fonts.load(`${w} 12px Roboto`)));
    init();
    loadPrinters();
  }

  function init() {
    const svg = container.querySelector('svg');
    const vb = svg.viewBox.baseVal;

    // some text objects in this export have no font-family; make them Roboto
    const fontFix = document.createElementNS(NS, 'style');
    fontFix.textContent = `.${SCOPE} text { font-family: Roboto, sans-serif; }`;
    svg.querySelector('defs').append(fontFix);

    const texts = [...svg.querySelectorAll('text')].map((el) => ({
      el, ...where(el), size: sizeOf(el), text: el.textContent.trim(),
    }));

    const title = texts.reduce((a, b) => (b.size > a.size ? b : a)); // biggest text
    const colX = 0.7 * vb.width; // the value column starts at the right
    const values = texts.filter((t) => t.x >= colX).sort((a, b) => a.y - b.y);
    const top = values[0].y - 25;
    const bottom = values.at(-1).y + 12;
    const labels = texts.filter((t) => t.x < colX && t.y > top && t.y < bottom);

    // values are centered in their column
    const cx =
      values.reduce((sum, v) => {
        const b = v.el.getBBox();
        return sum + v.x + (b.x + b.width / 2) * v.sx;
      }, 0) / values.length;

    const titleEls = [title.el, title.el.cloneNode(false), title.el.cloneNode(false)];
    title.el.after(...titleEls.slice(1));
    layout = {
      svg, vb: { w: vb.width, h: vb.height }, cx, titleX: vb.width / 2,
      titleCenter: title.y - (CAP * title.size) / 2, titleEls,
    };

    const labelFor = (v) =>
      labels.reduce((a, b) => (Math.abs(b.y - v.y) < Math.abs(a.y - v.y) ? b : a)).text;

    titleField = {
      el: title.el, text: title.text,
      size: title.size, defSize: title.size,
    };
    titleLines = [title.text].map((text) => ({
      text, size: title.size, defSize: title.size,
    }));

    fields = values.map((v) => {
      const label = labelFor(v);
      const base = { label, el: v.el, y: v.y, size: 10, defSize: 10 };
      const m = v.text.match(/^([\d.,]+)\s*([A-Za-zµ]*)$/); // "100A", "60Hz", "3"
      if (m) return { ...base, kind: 'num', unit: m[2], value: m[1].replace(',', '.') };
      const key = norm(label);
      const hints = HINTS.find(([re]) => re.test(key))?.[1] ?? [];
      return { ...base, kind: 'text', hints, value: v.text };
    });
  }

  // ---- keep the SVG in sync with the form ----
  function fit(el, size, maxW, sx = 1) {
    let s = size;
    el.style.fontSize = `${s}px`;
    while (s > MIN_SIZE && el.getBBox().width * sx > maxW) {
      s -= 0.5;
      el.style.fontSize = `${s}px`;
    }
    return s;
  }

  $effect(() => {
    if (!titleField.el || !layout) return;

    const renderedTitle = layout.titleEls.map((el, i) => {
      const line = titleLines[i];
      el.textContent = line?.text ?? '';
      if (!line) return null;
      el.setAttribute('text-anchor', 'middle');
      return { el, size: fit(el, line.size, MAX_TITLE_W, where(titleField.el).sx) };
    }).filter(Boolean);
    const titleHeight = renderedTitle.reduce((sum, line) => sum + CAP * line.size, 0)
      + TITLE_LINE_GAP * Math.max(0, renderedTitle.length - 1);
    let baseline = layout.titleCenter - titleHeight / 2;
    for (const line of renderedTitle) {
      baseline += CAP * line.size;
      line.el.setAttribute(
        'transform',
        `translate(${layout.titleX} ${baseline}) scale(${where(titleField.el).sx} 1)`
      );
      baseline += TITLE_LINE_GAP;
    }

    for (const f of fields) {
      f.el.textContent =
        f.kind === 'num'
          ? f.value === null || f.value === '' ? '' : `${f.value}${f.unit}`
          : f.value;
      f.el.setAttribute('text-anchor', 'middle');
      const s = fit(f.el, f.size, MAX_VALUE_W);
      f.el.setAttribute('transform', `translate(${layout.cx} ${f.y + (CAP / 2) * (s - f.defSize)})`);
    }
  });

  const bump = (f, d, max) => {
    f.size = Math.min(max, Math.max(MIN_SIZE, Math.round((f.size + d) * 10) / 10));
  };

  function updateTitle(event) {
    const text = event.currentTarget.value.replace(/\r/g, '').split('\n').slice(0, 3).join('\n');
    event.currentTarget.value = text;
    titleField.text = text;

    const parts = text.split('\n');
    const available = (MAX_TITLE_SIZE * CAP - TITLE_LINE_GAP * (parts.length - 1)) / CAP;
    const lineCountChanged = parts.length !== titleLines.length;
    const initialSize = Math.floor(
      Math.min(titleField.defSize, available / parts.length) * 10
    ) / 10;
    const next = parts.map((line, i) => lineCountChanged
      ? { text: line, size: initialSize, defSize: initialSize }
      : { ...titleLines[i], text: line }
    );
    titleLines = next;
  }

  function titleLineMaxSize(index) {
    const available = (MAX_TITLE_SIZE * CAP - TITLE_LINE_GAP * (titleLines.length - 1)) / CAP;
    const otherSizes = titleLines.reduce(
      (sum, item, i) => sum + (i === index ? 0 : item.size),
      0
    );
    return Math.max(MIN_SIZE, available - otherSizes);
  }

  function clampTitleLineSize(index) {
    const line = titleLines[index];
    if (!Number.isFinite(line.size)) return;
    line.size = Math.min(titleLineMaxSize(index), Math.max(MIN_SIZE, line.size));
  }

  const fileBase = $derived(
    String(fields.find((f) => /FABRIC/.test(norm(f.label)))?.value ?? '')
      .replace(/[\\/:*?"<>|]/g, '-') || 'etiqueta-qdfl'
  );

  // ---- black and white version for the thermal printer ----
  function parseColor(css) {
    const m = css?.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
    return { lum: 0.299 * r + 0.587 * g + 0.114 * b, sat: Math.max(r, g, b) - Math.min(r, g, b) };
  }

  // Colors would turn into white or black at random (orange becomes white), so
  // decide it here: whites and light greys stay white, everything else is black.
  function monoClone() {
    const live = layout.svg;
    const clone = live.cloneNode(true);
    const a = live.querySelectorAll('*');
    const b = clone.querySelectorAll('*');
    const toBW = (css) => {
      const c = parseColor(css);
      if (!c) return null;
      return c.lum >= 200 && c.sat < 25 ? '#fff' : '#000';
    };
    a.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const f = toBW(cs.fill);
      const s = toBW(cs.stroke);
      if (f) b[i].style.fill = f;
      if (s) b[i].style.stroke = s;
    });

    // the grey bands would vanish, so mark the row edges with thin lines
    if (rules) {
      const ys = [];
      for (const r of live.querySelectorAll('rect')) {
        const c = parseColor(getComputedStyle(r).fill);
        if (!c || c.lum < 200 || c.lum > 245 || c.sat > 25) continue; // light grey only
        const y = r.y.baseVal.value;
        ys.push(y, y + r.height.baseVal.value);
      }
      ys.sort((p, q) => p - q);
      const edges = [];
      for (const y of ys) if (!edges.length || y - edges.at(-1) > 1.2) edges.push(y);
      for (const y of edges) {
        const line = document.createElementNS(NS, 'rect');
        line.setAttribute('x', 0);
        line.setAttribute('y', y - 0.3);
        line.setAttribute('width', layout.vb.w);
        line.setAttribute('height', 0.6);
        line.style.fill = '#000';
        clone.append(line);
      }
    }
    return clone;
  }

  // the design is 101 mm wide; shrink it a hair to fit a 100 mm label
  const printScale = () => (LABEL_W * 72) / 25.4 / layout.vb.w;

  async function makeZpl() {
    return buildZpl(monoClone(), {
      copies, mode: 'image', scale: printScale(),
      offsetX: offX || 0, offsetY: offY || 0,
    });
  }

  // ---- QZ Tray ----
  let connecting = null;
  function qzConnect() {
    if (qz.websocket.isActive()) return Promise.resolve();
    connecting ??= qz.websocket.connect().finally(() => (connecting = null));
    return connecting;
  }

  async function loadPrinters() {
    status = 'Conectando ao QZ Tray…';
    try {
      await qzConnect();
    } catch (e) {
      status = `Não consegui conectar ao QZ Tray (${e?.message ?? e}). Verifique se ele está aberto.`;
      return;
    }
    try {
      const found = await qz.printers.find();
      printers = Array.isArray(found) ? found : [found];
      let saved = '';
      try { saved = localStorage.getItem('printer-qdfl') ?? ''; } catch {}
      printerName =
        printers.find((p) => p === saved) ??
        printers.find((p) => /elgin|l42/i.test(p)) ??
        printers[0] ?? '';
      status = printers.length ? '' : 'Nenhuma impressora instalada no Windows.';
    } catch (e) {
      status = `Erro ao listar impressoras: ${e?.message ?? e}`;
    }
  }

  const savePrinter = () => {
    try { localStorage.setItem('printer-qdfl', printerName); } catch {}
  };

  async function printThermal() {
    try {
      status = 'Enviando…';
      const zpl = await makeZpl();
      await qzConnect();
      const cfg = qz.configs.create(printerName, { encoding: 'UTF-8' });
      await qz.print(cfg, [{ type: 'raw', format: 'command', flavor: 'plain', data: zpl }]);
      status = 'Enviado para a impressora.';
    } catch (e) {
      status = `Erro ao imprimir: ${e?.message ?? e}`;
    }
  }

  async function downloadZpl() {
    const zpl = await makeZpl();
    save(new Blob([zpl], { type: 'text/plain' }), `${fileBase}.zpl`);
  }

  function downloadSvg() {
    const clone = layout.svg.cloneNode(true);
    clone.setAttribute('width', `${((layout.vb.w * 25.4) / 72).toFixed(2)}mm`);
    clone.setAttribute('height', `${((layout.vb.h * 25.4) / 72).toFixed(2)}mm`);
    const xml = new XMLSerializer()
      .serializeToString(clone)
      .replaceAll(`.${SCOPE} `, '') // back to plain class styles for other editors
      .replace(` class="${SCOPE}"`, '');
    save(new Blob([xml], { type: 'image/svg+xml' }), `${fileBase}.svg`);
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
  }

  // Full-color vector print through the browser (for a normal or color printer).
  async function printColor() {
    await document.fonts.ready;
    const clone = layout.svg.cloneNode(true);
    clone.setAttribute('width', `${LABEL_W}mm`);
    clone.setAttribute('height', `${LABEL_H}mm`);
    clone.setAttribute('preserveAspectRatio', 'xMidYMin meet');

    const sourceUrl = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
    );
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = sourceUrl;
      });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round((LABEL_W * PRINT_DPI) / 25.4);
    canvas.height = Math.round((LABEL_H * PRINT_DPI) / 25.4);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const area = document.createElement('div');
    area.id = 'qdfl-print';
    const printImage = document.createElement('img');
    printImage.src = canvas.toDataURL('image/png');
    printImage.alt = '';
    await printImage.decode();
    area.append(printImage);

    const style = document.createElement('style');
    style.textContent = `
      @page { size: ${LABEL_W}mm ${LABEL_H}mm; margin: 0; }
      @media screen { #qdfl-print { display: none; } }
      @media print {
        html, body { margin: 0; padding: 0; height: ${LABEL_H}mm; overflow: hidden; background: #fff; }
        body > *:not(#qdfl-print) { display: none !important; }
        #qdfl-print { width: ${LABEL_W}mm; height: ${LABEL_H}mm; overflow: hidden; }
        #qdfl-print img { display: block; width: 100%; height: 100%; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }`;
    document.head.append(style);
    document.body.append(area);
    window.addEventListener('afterprint', () => { style.remove(); area.remove(); }, { once: true });
    window.print();
  }
</script>

{#snippet sizeRow(f, max)}
  <div class="style-row">
    <button type="button" title="Diminuir texto" onclick={() => bump(f, -STEP, max)}>A−</button>
    <span class="size">{f.size.toFixed(1)}</span>
    <button type="button" title="Aumentar texto" onclick={() => bump(f, STEP, max)}>A+</button>
    <button type="button" title="Restaurar padrão" onclick={() => (f.size = f.defSize)}>↺</button>
  </div>
{/snippet}

<main>
  <form>
    <div class="field">
      <label>
        Título (até 3 linhas)
        <textarea rows="3" value={titleField.text} oninput={updateTitle}></textarea>
      </label>
      {#each titleLines as line, i}
        <div class="title-line">
          <span>Linha {i + 1}</span>
          <input
            class="title-size"
            aria-label="Tamanho da linha {i + 1}"
            type="number"
            min={MIN_SIZE}
            max={titleLineMaxSize(i)}
            step="0.1"
            bind:value={line.size}
            onchange={() => clampTitleLineSize(i)}
          />
        </div>
      {/each}
    </div>

    {#each fields as f, i}
      <div class="field">
        <label>
          {f.label}
          {#if f.kind === 'num'}
            <span class="num">
              <input type="number" step="any" bind:value={f.value} />
              {#if f.unit}<em>{f.unit}</em>{/if}
            </span>
          {:else}
            <input bind:value={f.value} list={f.hints.length ? `qdfl-hints-${i}` : undefined} />
            {#if f.hints.length}
              <datalist id="qdfl-hints-{i}">
                {#each f.hints as h}<option value={h}></option>{/each}
              </datalist>
            {/if}
          {/if}
        </label>
        {@render sizeRow(f, 18)}
      </div>
    {/each}

    <hr />

    <label class="check">
      <input type="checkbox" bind:checked={rules} />
      Térmica: linhas entre as linhas da tabela
    </label>
    <label>
      Cópias
      <input type="number" min="1" max="500" bind:value={copies} />
    </label>
    <label>
      Impressora térmica
      <select bind:value={printerName} onchange={savePrinter}>
        {#each printers as p}<option value={p}>{p}</option>{/each}
      </select>
    </label>
    <label>
      Mover impressão para baixo (mm)
      <input type="number" step="0.1" min="-5" max="5" bind:value={offY} />
    </label>
    <label>
      Mover impressão para a direita (mm)
      <input type="number" step="0.1" min="-5" max="5" bind:value={offX} />
    </label>

    <div class="buttons">
      <button type="button" onclick={printThermal} disabled={!printerName}>🖨️ Imprimir térmica (P&B)</button>
      <button type="button" onclick={printColor}>🎨 Imprimir colorida (navegador)</button>
      <button type="button" onclick={downloadSvg}>Baixar SVG</button>
      <button type="button" onclick={downloadZpl}>Baixar .zpl</button>
      <button type="button" onclick={loadPrinters}>↻ Atualizar impressoras</button>
    </div>
    {#if status}<p class="warn">{status}</p>{/if}
  </form>

  <div class="preview" bind:this={container}>{@html svgText}</div>
</main>

<style>
  main { display: flex; gap: 2rem; padding: 1.5rem; align-items: flex-start; }
  form { display: grid; gap: 0.9rem; width: 320px; text-align: left; }
  .field { display: grid; gap: 0.35rem; }
  .title-line { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.8rem; }
  .title-size { width: 5rem; }
  textarea { min-width: 0; resize: vertical; }
  label { display: grid; gap: 0.25rem; font-size: 0.85rem; }
  .check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; }
  .num { display: flex; align-items: center; gap: 0.4rem; }
  .num input { flex: 1; min-width: 0; }
  .num em { font-style: normal; font-weight: 600; }
  .style-row { display: flex; align-items: center; gap: 0.35rem; }
  .style-row button { padding: 0.15rem 0.5rem; font-size: 0.8rem; }
  .size { min-width: 2.2rem; text-align: center; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .warn { margin: 0; font-size: 0.8rem; color: #b45309; }
  .preview { width: 420px; background: #fff; }
  .preview :global(svg) { width: 100%; height: auto; display: block; }
</style>