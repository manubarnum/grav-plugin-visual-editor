# Visual Editor for Grav

An independent, open-source visual Markdown editor for **Grav 2 and Admin2**. It is not the commercial Editor Pro product and contains no code from that product.

## What it does

- Edits page content visually with TipTap/ProseMirror and keeps Markdown as the saved format.
- Preserves standalone HTML, Twig and shortcode blocks verbatim, including nested shortcodes.
- Keeps the page's own Markdown conventions when saving (`*` or `-` bullets, `_em_`, setext headings, `1)`, `***`, two-space line breaks, `<autolinks>`, tables without outer pipes), reference-style links and their definitions, footnotes, and images inside sentences.
- Provides headings, inline formatting, links, images, lists, blockquotes and fenced code blocks.
- Includes visual Markdown tables with row/column insertion, removal, alignment and cell merging; any table can be shown without background or borders.
- Aligns blocks left, center or right (shortcode-core's `[center]`/`[right]`), and wraps blocks in a colored frame (`[div class="ve-block" style="…"]`) with readable text on any background.
- Resizes images by dragging or with 320/640/960 px presets: Grav serves a resized copy (`photo.jpg?cropResize=640`).
- Inserts and previews GitHub-style `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION` alerts.
- Uses Admin2's page media: pick, upload, paste or drop images; the media panel's insert button inserts at the cursor.
- Has visual/source modes, undo/redo, a draggable block handle, follows Admin2's light/dark mode, and optional smart typography.
- Supports abbreviation, citation, highlight, keyboard, superscript and subscript inline HTML.
- Renders shortcode previews on demand through `shortcode-core`.
- Adds a per-page background color (field under the editor), applied to the whole page on the site with readable text.
- Shows its interface in French when Admin2 is in French (English otherwise).
- Supports Admin2's collaborative editing (Sync plugin): shared document, other participants' cursors and a shared undo history; it uses Admin2's own Yjs instance and ships none.

## Requirements

- Grav 2.2.18 or later with the **Admin2** and **API** plugins (API 1.1.14+).
- PHP 8.1 or later.
- A current Chrome, Edge, Firefox or Safari browser.
- Optional: `shortcode-core` for shortcode previews.

The classic Admin plugin (Grav 1.7) is not supported from version 2.0.

## Install

1. Copy the **`visual-editor` folder from `dist/`** to `user/plugins/visual-editor` (or extract `dist/visual-editor.zip` into `user/plugins/`). Replace any previous version entirely.
2. Enable **Grav Visual Editor** in Admin2 → Plugins.
3. Edit a page: the content field opens in the visual editor.

No `npm install`, Composer install, front-end build, external CDN or web service is needed on the Grav server.

## How it integrates with Admin2

- The editor is an Admin2 **custom field** web component shipped at `admin-next/fields/visual-editor.js` (element `grav-visual-editor--visual-editor`). Admin2 discovers and loads it automatically.
- **Site default** (plugin option, on by default): the page `content` field uses the visual editor for everyone who has not picked another editor.
- **Per user**: *Visual Editor* appears in the profile's *Content editor* list; choosing *CodeMirror* there opts out. Admin2's Expert mode always uses the code editor.
- Shortcode previews call `POST {api}/visual-editor/preview` (requires `api.pages.write`). Raw HTML and Twig are never executed; preview HTML is sanitized before display and never saved.

## Configuration

Plugin options (Admin2 → Plugins → Grav Visual Editor):

| Option | Default | Effect |
|---|---|---|
| `site_default` | on | The visual editor is the content editor for everyone who has not picked another one. |
| `shortcode_previews` | on | Shortcode blocks can be previewed through shortcode-core. |
| `page_background` | on | Adds the *Page background color* field under the editor. |
| `plain_tables` | off | Every table on the site without background or borders (a single table can still be set otherwise from the editor). |
| `theme` | auto | Editor appearance: follow Admin2, light or dark. |
| `smart_typography` | on | Typographic quotes and dashes while typing. |
| `toolbar` | all buttons | Comma-separated list of toolbar buttons. |
| `frontend_alerts` | off | GitHub alert styles on public pages (leave off with the *Github Markdown Alerts* plugin). |

Raw HTML and Twig are preserved as source, not sanitized: only users who may already edit such content should have page access.

Shortcode presets for the *Insert shortcode* dialog can be listed under `shortcodes` in `user/config/plugins/visual-editor.yaml`:

```yaml
shortcodes:
  - { name: notice, label: Notice, attributes: 'type="info"', content: 'Your message' }
```

## Development and verification

```sh
npm install
npm test
npm run build
```

The build produces `dist/visual-editor/` and `dist/visual-editor.zip` with a SHA-256 manifest, and refreshes the committed `admin-next/fields/visual-editor.js` and `THIRD-PARTY-NOTICES.md`. `npm test` runs the Markdown round trips and the Admin2 field contract (mounting, batched change events, value echo, media, preview) in jsdom, configuration consistency checks, and the PHP tests (`php tests/php/run.php`, no PHPUnit needed; skipped without PHP). The real Admin2 integration needs a running Grav 2 site.

## License

MIT. TipTap, ProseMirror, marked and their dependencies retain their respective open-source licenses, included in the distribution's THIRD-PARTY-NOTICES file.
