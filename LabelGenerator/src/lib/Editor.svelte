<script>
    import { onMount } from "svelte";
    import labelSvg from "../lib/labels/label.svg?raw";
    import qz from "qz-tray";
    import { buildZpl } from "../lib/zpl.js";

    const SIZES = [
        { key: "60x90", w: 60, h: 90, label: "60 × 90 mm" },
        { key: "100x150", w: 100, h: 150, label: "100 × 150 mm" },
    ];
    const CORES = [
        "RAL 2004",
        "RAL 7032",
        "RAL 7035",
        "RAL 9003",
        "RAL 9010",
        "RAL 5010",
        "INOX",
    ];

    const CONFIG = {
        ALTURA: { kind: "dim", key: "h" },
        LARGURA: { kind: "dim", key: "w" },
        PROFUNDIDADE: { kind: "dim", key: "d" },
        TIPO: { kind: "select", options: ["SOBREPOR", "EMBUTIR"] },
        USO: { kind: "select", options: ["ABRIGADO", "AO TEMPO"] },
        "GRAU DE PROT": {
            kind: "select",
            options: ["IP54/IK10", "IP65/IK10", "IP66/IK10"],
        },
        "COR DA PLACA": { kind: "select", options: CORES },
        "COR EXTERNA": { kind: "select", options: CORES },
    };

    const WEIGHTS = [
        { value: 400, name: "Normal" },
        { value: 500, name: "Médio" },
        { value: 700, name: "Negrito" },
    ];
    const MIN_SIZE = 3;
    const MAX_SIZE = 40;
    const STEP = 0.5;

    // How much a row grows per 1 unit of extra font size (about the cap height of Roboto).
    const GROWTH = 0.75;
    // Empty space above the logo that can absorb growth before the label gets taller.
    // const SLACK = 10;

    let container;
    let layout; // geometry captured at mount (not reactive)
    let fields = $state([]);
    let printers = $state([]);
    let printerName = $state("");
    let copies = $state(1);
    let rotation = $state(90);
    let textMode = $state("image");
    let status = $state("");
    let labelHeightMm = $state(90);
    let sizeKey = $state("60x90");
    const labelSize = $derived(SIZES.find((s) => s.key === sizeKey));
    const scale = $derived(labelSize.w / 60); // the design is 60 mm wide
    const physHeight = $derived(labelHeightMm * scale);

    // Função para bloquear as setas do teclado
    function blockArrows(e) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
        }
    }

    function blockWheel(e) {
        e.preventDefault();
    }

    function changeSize(key) {
        if (key === "100x150") rotation = 0; // 100 mm wide roll, so print upright
    }
    let landscape = $state(false);
    let titleField = $state({
        el: null,
        text: "",
        size: 0,
        weight: 700,
        defSize: 0,
        defWeight: 700,
    });
    let line2 = $state({
        el: null,
        unlocked: false,
        custom: "",
        size: 12,
        weight: 500,
        defSize: 12,
        defWeight: 500,
    });

    const where = (el) => {
        const m = el.transform.baseVal.consolidate()?.matrix;
        return { x: m?.e ?? 0, y: m?.f ?? 0 };
    };

    const readStyle = (el) => {
        const cs = getComputedStyle(el);
        return {
            size: Math.round(parseFloat(cs.fontSize) * 10) / 10,
            weight: parseInt(cs.fontWeight) || 400,
        };
    };

    const moveText = ({ el, x, y }, dy) =>
        el.setAttribute("transform", `translate(${x} ${y + dy})`);
    const moveRect = ({ el, y }, dy) => el.setAttribute("y", y + dy);

    onMount(() => {
        const svg = container.querySelector("svg");
        const fontFix = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "style",
        );
        fontFix.textContent = "text { font-family: Roboto, sans-serif; }";
        svg.querySelector("defs").append(fontFix);
        const vb = svg.viewBox.baseVal;

        const texts = [...svg.querySelectorAll("text")].map((el) => ({
            el,
            ...where(el),
            text: el.textContent.trim(),
        }));

        // --- geometry: divider lines, the thick bar under the title, the background ---
        const rects = [...svg.querySelectorAll(":scope > rect")];
        const lines = rects
            .filter(
                (r) =>
                    r.height.baseVal.value < 1 && r.width.baseVal.value > 100,
            )
            .map((el) => ({ el, y: el.y.baseVal.value }))
            .sort((a, b) => a.y - b.y);
        const barEl = rects.find((r) => {
            const h = r.height.baseVal.value;
            return h > 1 && h < 10 && r.width.baseVal.value > 100;
        });
        const bar = { el: barEl, y: barEl.y.baseVal.value };
        const bg = rects.find(
            (r) => Math.abs(r.height.baseVal.value - vb.height) < 0.01,
        );
        const tableBottom = lines.at(-1).y;

        // each text in the table belongs to the first divider line below it
        const rowOf = (y) => lines.findIndex((l) => l.y > y);
        const rowTexts = texts
            .filter((t) => t.y > bar.y && t.y < tableBottom)
            .map((t) => ({ ...t, row: rowOf(t.y) }));

        // logo, "1" circle and footer: everything below the table moves together
        const lower = [...svg.children]
            .filter(
                (c) =>
                    c.tagName === "g" ||
                    (c.tagName === "text" && where(c).y > tableBottom),
            )
            .map((el) =>
                el.tagName === "g"
                    ? { el, isGroup: true }
                    : { el, ...where(el) },
            );
        // free space between the table and the logo/circle; growth up to this amount
        // doesn't make the label taller (measured from the SVG instead of a fixed number)
        const lowerTop = Math.min(
            ...lower.filter((i) => i.isGroup).map((i) => i.el.getBBox().y),
        );
        const slack = Math.max(0, lowerTop - tableBottom - 3);
        const title = texts.reduce((a, b) => (b.y < a.y ? b : a)); // top-most text

        layout = {
            svg,
            vb: { w: vb.width, h: vb.height },
            bg,
            bar,
            lines,
            title,
            rowTexts,
            lower,
            slack,
        };

        // --- form fields ---
        const ts = readStyle(title.el);
        titleField = {
            el: title.el,
            text: "QDFL",
            size: ts.size,
            weight: ts.weight,
            defSize: ts.size,
            defWeight: ts.weight,
        };
        // second title line: a copy of the title <text>, only shown when it has text
        const el2 = title.el.cloneNode(false);
        el2.textContent = "";
        title.el.after(el2);
        const s2 = Math.round(ts.size) / 2; // starts at about half the title size
        line2 = {
            el: el2,
            unlocked: false,
            custom: "",
            size: s2,
            weight: 500,
            defSize: s2,
            defWeight: 500,
        };
        layout.titleTop = Math.max(0, title.y - 0.711 * ts.size); // space above the first line

        const labels = rowTexts.filter((t) => t.x < 100);
        const values = rowTexts.filter((t) => t.x >= 100);

        const centerX =
            values.reduce((sum, v) => {
                const b = v.el.getBBox();
                return sum + v.x + b.x + b.width / 2;
            }, 0) / values.length;

        for (const v of values) {
            v.el.setAttribute("text-anchor", "middle");
            v.el.setAttribute("x", centerX - v.x);
        }

        const labelFor = (v) =>
            labels.reduce((a, b) =>
                Math.abs(b.y - v.y) < Math.abs(a.y - v.y) ? b : a,
            ).text;

        fields = values.map((v) => {
            const label = labelFor(v);
            const st = readStyle(v.el);
            const base = {
                label,
                el: v.el,
                row: v.row,
                size: st.size,
                weight: st.weight,
                defSize: st.size,
                defWeight: st.weight,
            };
            const cfg = Object.entries(CONFIG).find(([k]) =>
                label.toUpperCase().startsWith(k),
            )?.[1];

            if (cfg?.kind === "dim") {
                return {
                    ...base,
                    kind: "dim",
                    key: cfg.key,
                    value: parseInt(v.text) || 0,
                };
            }
            if (cfg?.kind === "select") {
                const options = cfg.options.includes(v.text)
                    ? cfg.options
                    : [v.text, ...cfg.options];
                return { ...base, kind: "select", options, value: v.text };
            }
            return { ...base, kind: "text", value: v.text };
        });
    });

    const autoTitle = $derived.by(() => {
        const d = Object.fromEntries(
            fields.filter((f) => f.kind === "dim").map((f) => [f.key, f.value]),
        );
        return `${d.h}x${d.w}x${d.d}`;
    });

    const title = $derived(autoTitle); // dimensions, still used for the file names
    const dimsLine = $derived(line2.unlocked ? line2.custom : autoTitle);

    function toggleDimsLock(e) {
        line2.unlocked = e.currentTarget.checked;
        if (line2.unlocked) line2.custom = autoTitle; // start from the current value
    }

    const applyStyle = (el, size, weight) => {
        el.style.fontSize = `${size}px`;
        el.style.fontWeight = weight;
        el.style.fontVariationSettings = `'wght' ${weight}, 'wdth' 100`;
    };

    // text + font style
    $effect(() => {
        if (!titleField.el) return;
        titleField.el.textContent = titleField.text;
        applyStyle(titleField.el, titleField.size, titleField.weight);
        if (line2.el) {
            line2.el.textContent = dimsLine;
            applyStyle(line2.el, line2.size, line2.weight);
        }
        for (const f of fields) {
            f.el.textContent = f.kind === "dim" ? `${f.value}mm` : f.value;
            applyStyle(f.el, f.size, f.weight);
        }
    });

    // layout: grow rows, move lines and everything below
    $effect(() => {
        if (!layout) return;
        const {
            svg,
            vb,
            bg,
            bar,
            lines,
            title: titleItem,
            rowTexts,
            lower,
            slack,
        } = layout;

        // title block: one or two lines, sitting just above the bar
        const CAP = 0.711;
        const has1 = titleField.text.trim() !== "";
        const has2 = dimsLine.trim() !== "";
        const lastSize = has2 ? line2.size : titleField.size;
        const gap = Math.max(3.5, 0.35 * lastSize);
        const step = (CAP + 0.3) * line2.size;

        let need = layout.titleTop + gap;
        if (has1) need += CAP * titleField.size;
        if (has1 && has2) need += step;
        if (!has1 && has2) need += CAP * line2.size;

        const T = Math.max(0, need - bar.y);
        const lastBase = bar.y + T - gap;
        const base1 = has1 && has2 ? lastBase - step : lastBase;
        titleItem.el.setAttribute(
            "transform",
            `translate(${titleItem.x} ${base1})`,
        );
        line2.el?.setAttribute(
            "transform",
            `translate(${titleItem.x} ${lastBase})`,
        );
        // table rows
        const growth = lines.map(() => 0);
        for (const f of fields) {
            if (f.row == null) continue;
            growth[f.row] = Math.max(
                growth[f.row],
                GROWTH * Math.max(0, f.size - f.defSize),
            );
        }

        const after = [];
        let run = T;
        for (const g of growth) {
            run += g;
            after.push(run);
        }

        moveRect(bar, T);
        lines.forEach((l, i) => moveRect(l, after[i]));
        rowTexts.forEach((t) => moveText(t, after[t.row]));

        const lowerShift = Math.max(0, run - slack);
        for (const item of lower) {
            if (item.isGroup)
                item.el.setAttribute("transform", `translate(0 ${lowerShift})`);
            else moveText(item, lowerShift);
        }
        const H = vb.h + lowerShift;
        svg.setAttribute("viewBox", `0 0 ${vb.w} ${H}`);
        bg?.setAttribute("height", H);
        labelHeightMm = (H * 25.4) / 72;
    });
    const bump = (f, delta) => {
        f.size = Math.min(
            MAX_SIZE,
            Math.max(MIN_SIZE, Math.round((f.size + delta) * 10) / 10),
        );
    };
    const reset = (f) => {
        f.size = f.defSize;
        f.weight = f.defWeight;
    };
    async function printLabel() {
        await document.fonts.ready; // make sure Roboto is loaded before printing

        const pageW = landscape ? labelSize.h : labelSize.w;
        const pageH = landscape ? labelSize.w : labelSize.h;

        const clone = layout.svg.cloneNode(true);
        clone.setAttribute("width", `${labelSize.w}mm`);
        clone.setAttribute("height", `${labelSize.h}mm`);
        // if rows grew and the label is taller than 90 mm, shrink it to fit
        clone.setAttribute("preserveAspectRatio", "xMidYMin meet");
        // a thermal head can't print grey, so drop the preview background
        // clone.querySelector(":scope > rect").style.fill = "#fff";

        const area = document.createElement("div");
        area.id = "print-area";
        area.append(clone);

        const style = document.createElement("style");
        style.textContent = `
    @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
    @media screen { #print-area { display: none; } }
    @media print {
      html, body { margin: 0; padding: 0; height: ${pageH}mm; overflow: hidden; background: #fff; }
      body > *:not(#print-area) { display: none !important; }
      #print-area { position: relative; width: ${pageW}mm; height: ${pageH}mm; overflow: hidden; }
      #print-area svg {
        display: block; position: absolute; top: 0; left: 0;
        ${landscape ? `transform-origin: top left; transform: translateX(${pageW}mm) rotate(90deg);` : ""}
      }
    }
  `;

        document.head.append(style);
        document.body.append(area);
        window.addEventListener(
            "afterprint",
            () => {
                style.remove();
                area.remove();
            },
            { once: true },
        );
        window.print();
    }

    function download() {
        const clone = layout.svg.cloneNode(true);
        // keep the real print size: 1 SVG unit = 1 pt, so the original is exactly 60 x 90 mm
        const v = layout.svg.viewBox.baseVal;
        clone.setAttribute(
            "width",
            `${(((v.width * 25.4) / 72) * scale).toFixed(2)}mm`,
        );
        clone.setAttribute(
            "height",
            `${(((v.height * 25.4) / 72) * scale).toFixed(2)}mm`,
        );

        const xml = new XMLSerializer().serializeToString(clone);
        const url = URL.createObjectURL(
            new Blob([xml], { type: "image/svg+xml" }),
        );
        const safeName = title.replace(/[\\/:*?"<>|]/g, "-") || "etiqueta";
        const a = Object.assign(document.createElement("a"), {
            href: url,
            download: `${safeName}.svg`,
        });
        a.click();
        URL.revokeObjectURL(url);
    }

    async function qzConnect() {
        if (!qz.websocket.isActive()) await qz.websocket.connect();
    }

    async function loadPrinters() {
        status = "Conectando ao QZ Tray…";
        try {
            await qzConnect();
        } catch (e) {
            status = `Não foi possível conectar ao QZ Tray (${e?.message ?? e}). Verifique se ele está aberto e permita o site na janela dele.`;
            return;
        }
        try {
            const found = await qz.printers.find();
            printers = Array.isArray(found) ? found : [found];
            let saved = "";
            try { saved = localStorage.getItem('printer-panel') ?? localStorage.getItem('printer') ?? ''; } catch {}
            printerName =
                printers.find((p) => p === saved) ??
                printers.find((p) => /elgin|l42/i.test(p)) ??
                printers[0] ??
                "";
            status = printers.length
                ? ""
                : "QZ Tray conectou, mas o Windows não tem nenhuma impressora instalada.";
        } catch (e) {
            status = `Erro ao listar impressoras: ${e?.message ?? e}`;
        }
    }

    const savePrinter = () => {
        try { localStorage.setItem('printer-panel', printerName); } catch {}
    };

    async function printZpl() {
        try {
            status = "Enviando…";
            const zpl = await buildZpl(layout.svg, {
                copies,
                rotation,
                mode: textMode,
                scale,
            });
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
        const zpl = await buildZpl(layout.svg, {
            copies,
            rotation,
            mode: textMode,
        });
        const url = URL.createObjectURL(
            new Blob([zpl], { type: "text/plain" }),
        );
        const a = Object.assign(document.createElement("a"), {
            href: url,
            download: `${title}.zpl`,
        });
        a.click();
        URL.revokeObjectURL(url);
    }

    onMount(loadPrinters);
</script>

{#snippet textStyle(f)}
    <div class="style-row">
        <button
            type="button"
            title="Diminuir texto"
            onclick={() => bump(f, -STEP)}>A−</button
        >
        <span class="size">{f.size.toFixed(1)}</span>
        <button
            type="button"
            title="Aumentar texto"
            onclick={() => bump(f, STEP)}>A+</button
        >
        <select bind:value={f.weight} title="Peso da fonte">
            {#each WEIGHTS as w}
                <option value={w.value}>{w.name}</option>
            {/each}
        </select>
        <button type="button" title="Restaurar padrão" onclick={() => reset(f)}
            >↺</button
        >
    </div>
{/snippet}

<main>
    <form>
        <div class="field">
            <label>
                Título (1ª linha)
                <input
                    bind:value={titleField.text}
                    placeholder="Ex.: nome do quadro"
                />
            </label>
            {@render textStyle(titleField)}
        </div>

        <div class="field">
            <label>
                {line2.unlocked ? "" : ""} Dimensões (2ª linha) {line2.unlocked
                    ? "(manual)"
                    : "(automático)"}
                {#if line2.unlocked}
                    <input bind:value={line2.custom} />
                {:else}
                    <input value={autoTitle} readonly class="locked" />
                {/if}
            </label>
            <label class="check">
                <input
                    type="checkbox"
                    checked={line2.unlocked}
                    onchange={toggleDimsLock}
                />
                Desbloquear dimensões
            </label>
            {@render textStyle(line2)}
        </div>

        {#each fields as f}
            <div class="field">
                <label>
                    {f.label}
                    {#if f.kind === "dim"}
                        <input
                            type="number"
                            min="1"
                            onkeydown={blockArrows}
                            onwheel={blockWheel}
                            bind:value={f.value}
                        />
                    {:else if f.kind === "select"}
                        <select bind:value={f.value}>
                            {#each f.options as opt}
                                <option value={opt}>{opt}</option>
                            {/each}
                        </select>
                    {:else}
                        <input bind:value={f.value} />
                    {/if}
                </label>
                {@render textStyle(f)}
            </div>
        {/each}

        <div class="field">
            <label>
                Tamanho da etiqueta
                <select
                    bind:value={sizeKey}
                    onchange={(e) => changeSize(e.currentTarget.value)}
                >
                    {#each SIZES as s}
                        <option value={s.key}>{s.label}</option>
                    {/each}
                </select>
            </label>

            {#if physHeight > labelSize.h + 0.01}
                <p class="warn">
                    ⚠️ A etiqueta ficou com {physHeight.toFixed(1)} mm de altura,
                    mais que os
                    {labelSize.h} mm da etiqueta.
                </p>
            {/if}
<label>
  Impressora
  <select bind:value={printerName} onchange={savePrinter}>
    {#each printers as p}
      <option value={p}>{p}</option>
    {/each}
  </select>
</label>
            <label>
                Orientação da etiqueta
                <select bind:value={rotation}>
                    <option value={0}>Retrato (60 × 90)</option>
                    <option value={90}>Paisagem, girar horário</option>
                    <option value={270}>Paisagem, girar anti-horário</option>
                </select>
            </label>
            <label>
                Texto
                <select bind:value={textMode}>
                    <option value="image">Roboto (imagem)</option>
                    <option value="native"
                        >Fonte da impressora (texto nativo)</option
                    >
                </select>
            </label>
            <label>
                Cópias
                <input type="number" min="1" max="500" bind:value={copies} />
            </label>
            <button type="button" onclick={printZpl} disabled={!printerName}
                >Imprimir</button
            >
            <button type="button" onclick={downloadZpl}>Baixar .zpl</button>
            {#if status}<p class="warn">{status}</p>{/if}
        </div>
        <button type="button" onclick={download}>Baixar SVG</button>
    </form>

    <div class="preview" bind:this={container}>{@html labelSvg}</div>
</main>

<style>
    main {
        display: flex;
        gap: 2rem;
        padding: 1.5rem;
        align-items: flex-start;
    }
    form {
        display: grid;
        gap: 0.9rem;
        width: 320px;
        text-align: left;
    }
    .field {
        display: grid;
        gap: 0.35rem;
    }
    label {
        display: grid;
        gap: 0.25rem;
        font-size: 0.85rem;
    }
    .check {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.8rem;
    }
    .locked {
        cursor: not-allowed;
    }
    .style-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }
    .style-row button {
        padding: 0.15rem 0.5rem;
        font-size: 0.8rem;
    }
    .style-row select {
        font-size: 0.8rem;
    }
    .size {
        min-width: 2.2rem;
        text-align: center;
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
    }
    .preview {
        width: 340px;
        position: relative;
        height: -webkit-fill-available;
    }
    .preview :global(svg) {
        width: 100%;
        height: auto;
    }
    .warn {
        margin: 0;
        font-size: 0.8rem;
        color: #b45309;
    }

    /* Chrome, Safari, Edge, Opera */
    input[type="number"]::-webkit-inner-spin-button,
    input[type="number"]::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    /* Firefox */
    input[type="number"] {
        -moz-appearance: textfield;
    }
</style>
