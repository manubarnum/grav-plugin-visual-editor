# Visual Editor for Grav

An independent, open-source visual Markdown editor for **Grav 2 and Admin2**. It is not the commercial Editor Pro product and contains no code from that product.

## What it does

- Edits page content visually with TipTap/ProseMirror and keeps Markdown as the saved format.
- Preserves standalone HTML, Twig and shortcode blocks verbatim, including nested shortcodes.
- Provides headings, inline formatting, links, images, lists, blockquotes and fenced code blocks.
- Includes visual Markdown tables with row/column insertion, removal, alignment and cell merging.
- Inserts and previews GitHub-style `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION` alerts.
- Uses Admin2's page media: pick, upload, paste or drop images; the media panel's insert button inserts at the cursor.
- Has visual/source modes, undo/redo, a draggable block handle, follows Admin2's light/dark mode, and optional smart typography.
- Supports abbreviation, citation, highlight, keyboard, superscript and subscript inline HTML.
- Renders shortcode previews on demand through `shortcode-core`.

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

Plugin options: enable/disable, site default editor, automatic/light/dark appearance, smart typography, shortcode previews, a comma-separated toolbar, and optional GitHub alert styles on public pages (leave off when the *Github Markdown Alerts* plugin is installed). Raw HTML and Twig are preserved as source, not sanitized: only users who may already edit such content should have page access.

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

The build produces `dist/visual-editor/` and `dist/visual-editor.zip` with a SHA-256 manifest, and refreshes the committed `admin-next/fields/visual-editor.js`. Tests cover Markdown round trips and the Admin2 field contract (mounting, change events, value echo, media, preview) in jsdom; the real Admin2 integration needs a running Grav 2 site.

## License

MIT. TipTap, ProseMirror, marked and their dependencies retain their respective open-source licenses, included in the distribution's THIRD-PARTY-NOTICES file.
