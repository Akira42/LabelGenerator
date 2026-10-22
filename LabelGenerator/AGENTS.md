# Repository Guidance

## Project
- This is a browser-based label editor built with Svelte 5 and Vite. The UI is primarily in Portuguese.
- `src/App.svelte` owns the editor tabs. Label editors and shared print helpers live under `src/lib/`.
- Label artwork is stored as SVG in `src/lib/labels/`; components import templates as raw text and manipulate the SVG in the browser.
- `src/lib/zpl.js` converts SVG artwork to ZPL, and label components use QZ Tray for printer discovery and printing.

## Development
- Install dependencies with `npm install`.
- Start the Vite development server with `npm run dev`.
- Verify production compilation with `npm run build`; there are currently no test or lint scripts in `package.json`.
- Use `npm run preview` to serve a production build locally.

## Conventions
- Follow the existing Svelte 5 runes style (`$state`, `$derived`, `$effect`) in components.
- Keep label-specific editing behavior in its editor component; put shared SVG/ZPL behavior in the existing helpers where appropriate.
- Preserve the SVG geometry and print dimensions when changing label artwork or print transforms. Validate print-related changes with a build and, when available, a preview or test print.
- Keep changes focused and preserve existing UI wording and units unless the task calls for a user-facing change.