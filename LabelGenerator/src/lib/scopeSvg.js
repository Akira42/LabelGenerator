// Makes an SVG's <style> rules apply only to that SVG, so two exports that both
// use .cls-1, .cls-2... don't restyle each other. The class goes on the <svg>
// itself, so it also keeps working in the print and download copies.
export function scopeSvg(text, scope) {
  return text
    .replace(/<svg\b/, `<svg class="${scope}"`)
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css) =>
      '<style>' +
      css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, brace, sel) =>
        `${brace}\n${sel.split(',').map((s) => `.${scope} ${s.trim()}`).join(', ')} {`
      ) +
      '</style>'
    );
}