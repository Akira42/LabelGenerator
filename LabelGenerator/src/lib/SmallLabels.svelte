<script>
  import { onMount } from "svelte";
  import qz from "qz-tray";

  let { active = true } = $props();

  // ---- geometry, in printer dots ----
  const DPI = 203; // use 300 if you have the optional 300 dpi head
  const mm = (v) => Math.round((v * DPI) / 25.4);
  const PER_ROW = 5;
  const LABEL_W = mm(15); // 120 dots
  const LABEL_H = mm(50); // 400 dots
  const ROW_W = LABEL_W * PER_ROW; // 600 dots = 75 mm
  const PAD = mm(1); // margin inside each label
  const LINE_H = 1.15; // line spacing
  const MAX_LINES = 3;
  const MIN_PX = 6;
  const THRESHOLD = 140; // higher = blacker text, lower = thinner
  const FONT = "Roboto, 'Helvetica Neue', Arial, sans-serif";

  let nextId = 1;
  const newLabel = () => ({ text: "", size: 14, bold: true });
  const newRow = () => ({
    id: nextId++,
    copies: 1,
    labels: Array.from({ length: PER_ROW }, newLabel),
  });

  let rows = $state([newRow()]);
  let orient = $state("up"); // 'up' | 'down' | 'none'
  let autoFit = $state(true);
  let cutLines = $state(false);
  let rotation = $state(0);
  function loadOffsets() {
    try {
      return JSON.parse(localStorage.getItem("small-offset")) ?? {};
    } catch {
      return {};
    }
  }
  const savedOff = loadOffsets();
  let offX = $state(savedOff.x ?? 0); // mm, positive = right
  let offY = $state(savedOff.y ?? 0); // mm, positive = down

  $effect(() => {
    try {
      localStorage.setItem(
        "small-offset",
        JSON.stringify({ x: offX, y: offY }),
      );
    } catch {}
  });

  let printers = $state([]);
  let printerName = $state("");
  let status = $state("");
  let fontsReady = $state(false);
  let canvases = [];
  let loaded = false;

  // ---- QZ Tray ----
  let connecting = null;
  function qzConnect() {
    if (qz.websocket.isActive()) return Promise.resolve();
    connecting ??= qz.websocket.connect().finally(() => (connecting = null));
    return connecting;
  }

  async function loadPrinters() {
    status = "Conectando ao QZ Tray…";
    try {
      await qzConnect();
    } catch (e) {
      status = `Não consegui conectar ao QZ Tray (${e?.message ?? e}). Verifique se ele está aberto.`;
      return;
    }
    try {
      const found = await qz.printers.find();
      printers = Array.isArray(found) ? found : [found];
      let saved = "";
      try {
        saved = localStorage.getItem("printer") ?? "";
      } catch {}
      printerName =
        printers.find((p) => p === saved) ??
        printers.find((p) => /elgin|l42/i.test(p)) ??
        printers[0] ??
        "";
      status = printers.length
        ? ""
        : "Nenhuma impressora instalada no Windows.";
    } catch (e) {
      status = `Erro ao listar impressoras: ${e?.message ?? e}`;
    }
  }

  const savePrinter = () => {
    try {
      localStorage.setItem("printer", printerName);
    } catch {}
  };

  // connect the first time the tab is opened (avoids racing the other tab)
  $effect(() => {
    if (active && !loaded) {
      loaded = true;
      loadPrinters();
    }
  });

  // ---- fonts ----
  async function loadFonts() {
    try {
      await Promise.all([
        document.fonts.load("400 20px Roboto"),
        document.fonts.load("700 20px Roboto"),
      ]);
    } catch {}
  }
  onMount(async () => {
    await loadFonts();
    fontsReady = true;
  });

  // ---- drawing: one row = 600 x 400 dots ----
  function drawRow(canvas, row, { preview = false } = {}) {
    canvas.width = ROW_W;
    canvas.height = LABEL_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, ROW_W, LABEL_H);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    row.labels.forEach((lab, i) => {
      const lines = lab.text
        .split("\n")
        .slice(0, MAX_LINES)
        .map((s) => s.trim());
      while (lines.length && !lines.at(-1)) lines.pop();
      if (!lines.length) return;

      const rotated = orient !== "none";
      const boxW = (rotated ? LABEL_H : LABEL_W) - 2 * PAD; // along the text
      const boxH = (rotated ? LABEL_W : LABEL_H) - 2 * PAD; // across the lines

      let px = (lab.size * DPI) / 72;
      const setFont = () =>
        (ctx.font = `${lab.bold ? 700 : 400} ${px}px ${FONT}`);
      setFont();
      if (autoFit) {
        const fits = () =>
          Math.max(...lines.map((l) => ctx.measureText(l).width)) <= boxW &&
          lines.length * px * LINE_H <= boxH;
        while (px > MIN_PX && !fits()) {
          px -= 0.5;
          setFont();
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(i * LABEL_W, 0, LABEL_W, LABEL_H); // never bleed into the neighbour
      ctx.clip();
      ctx.translate(
        i * LABEL_W + LABEL_W / 2 + mm(offX || 0),
        LABEL_H / 2 + mm(offY || 0),
      );
      if (orient === "up") ctx.rotate(-Math.PI / 2);
      if (orient === "down") ctx.rotate(Math.PI / 2);

      // center by the real ink, so it works for any text and any number of lines
      const pitch = px * LINE_H;
      const ink = lines.map((l) => (l ? ctx.measureText(l) : null));
      const asc = (k) => (ink[k] ? ink[k].actualBoundingBoxAscent : 0.711 * px); // blank line = one cap height
      const desc = (k) => (ink[k] ? ink[k].actualBoundingBoxDescent : 0);
      const last = lines.length - 1;
      const base0 = -(-asc(0) + last * pitch + desc(last)) / 2; // baseline of the first line

      lines.forEach((l, k) => {
        if (!l) return;
        const dx =
          -(ink[k].actualBoundingBoxRight - ink[k].actualBoundingBoxLeft) / 2;
        ctx.fillText(l, dx, base0 + k * pitch);
      });
      ctx.restore();
    });

    if (cutLines) {
      for (let i = 1; i < PER_ROW; i++)
        ctx.fillRect(i * LABEL_W - 1, 0, 2, LABEL_H);
    }

    // pure black and white, exactly what the printer will get
    const img = ctx.getImageData(0, 0, ROW_W, LABEL_H);
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const v =
        0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2] < THRESHOLD
          ? 0
          : 255;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    if (preview) {
      // guides that do NOT print
      ctx.strokeStyle = "#b5b5b5";
      ctx.lineWidth = 1;
      ctx.setLineDash(cutLines ? [] : [6, 6]);
      if (!cutLines) {
        for (let i = 1; i < PER_ROW; i++) {
          ctx.beginPath();
          ctx.moveTo(i * LABEL_W + 0.5, 0);
          ctx.lineTo(i * LABEL_W + 0.5, LABEL_H);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.strokeRect(0.5, 0.5, ROW_W - 1, LABEL_H - 1);
    }
  }

  $effect(() => {
    if (!fontsReady) return;
    rows.forEach((row, r) => {
      if (canvases[r]) drawRow(canvases[r], row, { preview: true });
    });
  });

  // ---- ZPL ----
  function rowZpl(row) {
    const c = document.createElement("canvas");
    drawRow(c, row);
    let src = c;
    let W = ROW_W;
    let H = LABEL_H;

    if (rotation) {
      const r = document.createElement("canvas");
      r.width = H;
      r.height = W;
      const rc = r.getContext("2d", { willReadFrequently: true });
      rc.fillStyle = "#fff";
      rc.fillRect(0, 0, H, W);
      if (rotation === 90) {
        rc.translate(H, 0);
        rc.rotate(Math.PI / 2);
      } else {
        rc.translate(0, W);
        rc.rotate(-Math.PI / 2);
      }
      rc.drawImage(c, 0, 0);
      src = r;
      [W, H] = [H, W];
    }

    const px = src.getContext("2d").getImageData(0, 0, W, H).data;
    const rowBytes = Math.ceil(W / 8);
    const hex = [];
    for (let y = 0; y < H; y++) {
      let line = "";
      for (let bx = 0; bx < rowBytes; bx++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
          const x = bx * 8 + b;
          const bit = x < W && px[(y * W + x) * 4] < 128 ? 1 : 0;
          byte = (byte << 1) | bit;
        }
        line += byte.toString(16).padStart(2, "0");
      }
      hex.push(line);
    }
    const total = rowBytes * H;
    return [
      "^XA",
      "^CI28",
      `^PW${W}`,
      `^LL${H}`,
      "^LH0,0",
      `^PQ${Math.max(1, row.copies | 0)}`,
      `^FO0,0^GFA,${total},${total},${rowBytes},${hex.join("").toUpperCase()}^FS`,
      "^XZ",
    ].join("\n");
  }

  async function buildAll() {
    await loadFonts();
    const filled = rows.filter((r) => r.labels.some((l) => l.text.trim()));
    return filled.length ? filled.map(rowZpl).join("\n") : null;
  }

  async function printAll() {
    try {
      const zpl = await buildAll();
      if (!zpl) {
        status = "Nenhuma etiqueta preenchida.";
        return;
      }
      status = "Enviando…";
      await qzConnect();
      const cfg = qz.configs.create(printerName, { encoding: "UTF-8" });
      await qz.print(cfg, [
        { type: "raw", format: "command", flavor: "plain", data: zpl },
      ]);
      status = "Enviado para a impressora.";
    } catch (e) {
      status = `Erro ao imprimir: ${e?.message ?? e}`;
    }
  }

  async function downloadZpl() {
    const zpl = await buildAll();
    if (!zpl) {
      status = "Nenhuma etiqueta preenchida.";
      return;
    }
    const url = URL.createObjectURL(new Blob([zpl], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "etiquetas-pequenas.zpl",
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- rows ----
  const addRow = () => rows.push(newRow());
  const removeRow = (r) => {
    if (rows.length > 1) rows.splice(r, 1);
  };
  const duplicateRow = (r) =>
    rows.splice(r + 1, 0, { ...$state.snapshot(rows[r]), id: nextId++ });
  const bump = (lab, d) => {
    lab.size = Math.min(40, Math.max(4, Math.round((lab.size + d) * 10) / 10));
  };
</script>

<main>
  <section class="settings">
    <label>
      Direção do texto
      <select bind:value={orient}>
        <option value="up">Vertical, de baixo para cima</option>
        <option value="down">Vertical, de cima para baixo</option>
        <option value="none">Horizontal (sem girar)</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={autoFit} />
      Ajustar o tamanho para caber
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={cutLines} />
      Imprimir linhas entre as etiquetas
    </label>
    <label>
      Girar a página na impressão
      <select bind:value={rotation}>
        <option value={0}>Não girar (75 × 50)</option>
        <option value={90}>Girar 90° horário</option>
        <option value={270}>Girar 90° anti-horário</option>
      </select>
    </label>
    <label>
      Mover texto para baixo (mm)
      <input type="number" step="0.1" min="-5" max="5" bind:value={offY} />
    </label>
    <label>
      Mover texto para a direita (mm)
      <input type="number" step="0.1" min="-5" max="5" bind:value={offX} />
    </label>
    <label>
      Impressora
      <input
        list="small-printers"
        bind:value={printerName}
        onchange={savePrinter}
        placeholder="Nome no Windows"
      />
      <datalist id="small-printers">
        {#each printers as p}<option value={p}></option>{/each}
      </datalist>
    </label>
    <div class="buttons">
      <button type="button" onclick={loadPrinters}
        >↻ Atualizar impressoras</button
      >
      <button type="button" onclick={printAll} disabled={!printerName}
        >🖨️ Imprimir tudo</button
      >
      <button type="button" onclick={downloadZpl}>Baixar .zpl</button>
    </div>
    {#if status}<p class="warn">{status}</p>{/if}
  </section>

  {#each rows as row, r (row.id)}
    <section class="row">
      <header>
        <strong>Fileira {r + 1}</strong>
        <label class="inline">
          Cópias
          <input type="number" min="1" max="500" bind:value={row.copies} />
        </label>
        <button type="button" onclick={() => duplicateRow(r)}>Duplicar</button>
        <button
          type="button"
          onclick={() => removeRow(r)}
          disabled={rows.length === 1}>Remover</button
        >
      </header>

      <canvas class="preview" bind:this={canvases[r]}></canvas>

      <div class="editors">
        {#each row.labels as lab, i}
          <div class="editor">
            <textarea
              rows="3"
              placeholder="Etiqueta {i + 1}"
              bind:value={lab.text}></textarea>
            <div class="mini">
              <button
                type="button"
                title="Diminuir"
                onclick={() => bump(lab, -0.5)}>A−</button
              >
              <span>{lab.size.toFixed(1)}</span>
              <button
                type="button"
                title="Aumentar"
                onclick={() => bump(lab, 0.5)}>A+</button
              >
            </div>
            <label class="check small">
              <input type="checkbox" bind:checked={lab.bold} /> Negrito
            </label>
          </div>
        {/each}
      </div>
    </section>
  {/each}

  <button type="button" class="add" onclick={addRow}>+ Adicionar fileira</button
  >
  <p class="hint">
    Cada fileira é uma etiqueta de 75 × 50 mm com 5 etiquetas de 15 × 50 mm. Até
    3 linhas por etiqueta (Enter = nova linha).
  </p>
</main>

<style>
  main {
    display: grid;
    gap: 1.25rem;
    padding: 1.5rem;
    text-align: left;
    justify-items: start;
  }
  .settings {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.75rem 1.5rem;
    align-items: end;
    width: 100%;
    max-width: 900px;
  }
  .settings label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .buttons {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    grid-column: 1 / -1;
  }
  .check {
    display: flex !important;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .check.small {
    font-size: 0.75rem;
  }
  .warn {
    margin: 0;
    font-size: 0.8rem;
    color: #b45309;
    grid-column: 1 / -1;
  }
  .row {
    display: grid;
    gap: 0.5rem;
  }
  .row header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
  }
  .inline input {
    width: 4rem;
  }
  .preview {
    display: block;
    width: 600px;
    height: 400px;
    background: #fff;
    image-rendering: pixelated;
  }
  .editors {
    display: grid;
    grid-template-columns: repeat(5, 120px);
  }
  .editor {
    display: grid;
    gap: 0.25rem;
    align-content: start;
    padding: 0 2px;
    box-sizing: border-box;
  }
  .editor textarea {
    width: 100%;
    box-sizing: border-box;
    font-size: 0.8rem;
    resize: vertical;
  }
  .mini {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .mini button {
    padding: 0.1rem 0.4rem;
    font-size: 0.75rem;
  }
  .mini span {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .add {
    padding: 0.4rem 1rem;
  }
  .hint {
    margin: 0;
    font-size: 0.8rem;
    color: #666;
  }
</style>
