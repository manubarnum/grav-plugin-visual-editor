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
