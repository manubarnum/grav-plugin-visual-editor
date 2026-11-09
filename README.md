# Visual Editor for Grav

An independent, open-source visual Markdown editor plugin for **Grav 1.7+ and Grav Admin**. It is not the commercial Editor Pro product and contains no code from that product.

## What it does

- Edits page content visually with TipTap/ProseMirror and keeps Markdown as the saved format.
- Preserves standalone HTML, Twig and shortcode blocks verbatim, including nested shortcodes.
- Provides headings, inline formatting, links, images, lists, blockquotes and fenced code blocks.
- Includes visual Markdown tables with row/column insertion, removal, alignment and cell merging.
- Inserts and previews GitHub-style `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION` alerts.
- Uploads dropped images to the current page's media folder and resolves page-relative image paths.
- Has visual/source modes, undo/redo, a draggable block handle, light/dark themes and optional smart typography.
- Supports abbreviation, citation, highlight, keyboard, superscript and subscript inline HTML.
- Exposes browser events and a small registry for third-party shortcode definitions.

## Requirements

- Grav 1.7 or later with the Admin plugin.
- PHP 7.3 or later (the PHP version required by your Grav installation).
- A current Chrome, Edge, Firefox or Safari browser.
- Optional: `shortcode-core` for executing shortcode previews.

## Install

1. Copy the **`visual-editor` folder from `dist/`** to `user/plugins/visual-editor` in your Grav installation. You can also extract the generated ZIP into `user/plugins/`.
2. In Grav Admin, open **Plugins → Grav Visual Editor** and enable it.
3. Edit a page. The standard Markdown textarea is enhanced in place; saving continues to use Grav's normal page form and permissions.
4. Select **Source** in the editor if you need to edit raw Markdown directly.

No `npm install`, Composer install, front-end build, external CDN or web service is needed on the Grav server. All runtime JavaScript and CSS are bundled.

## Shortcode preview and custom blocks

Shortcode source remains intact even when no preview provider is available. The plugin sends preview requests through Grav Admin's authenticated AJAX endpoint. If `shortcode-core` is installed, its processors are invoked; Twig and raw HTML are not executed in the preview response.

Third-party code can register a shortcode definition before the editor initializes:

```js
window.GravVisualEditorShortcodes.push({
  name: 'notice',
  label: 'Notice',
  fields: [{ name: 'type', label: 'Type', default: 'info' }],
  content: 'Your message'
});
```

`visual-editor:before-init`, `visual-editor:ready`, `visual-editor:change` and `visual-editor:save` are dispatched on the enhanced textarea. Extensions can listen there and use `event.detail.editor` or `event.detail.markdown`.

## Configuration

The plugin blueprint exposes enable/disable, automatic/light/dark appearance, smart typography, front-end alert styling and a comma-separated toolbar. Raw HTML and Twig are preserved as source, not sanitized: only users who already have permission to edit such page content should be granted editor access.

## Development and verification

```sh
npm install
npm test
npm run build
```

The build produces an installable plugin in `dist/visual-editor/` and `dist/visual-editor.zip`, with a SHA-256 manifest. Parser tests cover Markdown round trips, nested shortcodes, protected raw blocks, alerts, inline HTML and table escaping. Browser/Admin integration requires a running Grav site; PHP unit or integration execution is only reported when PHP is available.

## Security

Uploads are limited to common raster images and SVG, require an active Grav Admin session, a valid Grav nonce, `admin.pages` permission and the current page route. Uploaded file names are normalized and random suffixes prevent overwriting existing media. Preview output is inserted as untrusted preview HTML; it is never saved to the page unless the author edits the corresponding source block.

## License

MIT. TipTap, marked, Turndown and their dependencies retain their respective open-source licenses, included in the distribution's THIRD-PARTY-NOTICES file.
