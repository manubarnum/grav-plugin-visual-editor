# v2.1.0
## 11/09/2026

1. [](#new)
    * Resize images by dragging a corner handle or with 320/640/960 px presets; Grav serves a resized copy (`?cropResize=`), never enlarged
    * Image bar for the selected image: width presets, custom width, alt text and title
    * Colored blocks: wrap blocks in a frame with a background color (presets or any color), saved as a shortcode-core `[div]`
    * Page background color: field under the editor, applied to the whole page on the site (Quark 2 surfaces included) with readable text
    * Align blocks left, center or right (`[center]`, `[right]`, `[left]`); inside a table, align the column
    * Tables without background or borders, site-wide (`plain_tables` option) or per table (table bar → Table style)
1. [](#improved)
    * Saving keeps the page's own Markdown conventions instead of rewriting untouched syntax (bullets, emphasis, headings, rules, line breaks, autolinks, table pipes, escaping, tight lists)
    * Edits are reported to Admin2 once per typing pause, not per keystroke: no auto-save at every pause, no undo entry per character
    * Faster editing on long pages: one toolbar refresh per keystroke, one media lookup per render
    * Shortcode previews check the edited page's own permissions
    * Smaller bundle (unused Turndown removed); the license of every bundled package is listed in THIRD-PARTY-NOTICES.md
    * PHP tests and configuration consistency tests run with `npm test`
1. [](#bugfix)
    * Reference-style links, footnotes, link titles, links around formatting or inline code, and images inside a sentence no longer break when a page is saved
    * Brackets and braces inside inline code are kept literal
    * Dialog *Apply* buttons now apply their change
    * The link dialog no longer inserts the URL inside an existing link
    * The *More formatting → Abbreviation* dialog no longer closes immediately
    * Bullet and number markers, cite/abbr/sub/sup styles are visible under Admin2
    * Distraction-free editing is no longer covered by Admin2's page header
    * No empty paragraph above images; images follow the site's left alignment in the editor

# v2.0.0
## 11/09/2026

1. [](#new)
    * Admin2 support: the editor ships as an Admin2 custom field web component (`admin-next/fields/visual-editor.js`)
    * Site-wide default editor option, plus a *Visual Editor* choice in each user's *Content editor* preference
    * Images use Admin2 page media (picker, upload, paste/drop, media panel insert) and the site media picker
    * Shortcode previews through a plugin API route, with sanitized output
1. [](#improved)
    * Editing a protected HTML/Twig/shortcode block uses a multi-line dialog instead of a single-line prompt
    * Follows Admin2's light/dark mode
1. [](#bugfix)
    * Shortcode preview button no longer throws
1. [](#breaking)
    * Requires Grav 2.2.18+, Admin2 and the API plugin; the classic Admin (Grav 1.7) is no longer supported

# v1.0.0
## 11/09/2026

1. [](#new)
    * Initial release
