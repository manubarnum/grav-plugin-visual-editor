<?php
/** Independent, Markdown-preserving visual editor for Grav Admin2. */

namespace Grav\Plugin;

use Grav\Common\Plugin;
use Grav\Plugin\VisualEditor\PreviewController;
use RocketTheme\Toolbox\Event\Event;

// classes/ is PSR-4 (composer.json) but the plugin ships no vendor/ autoloader: register it here,
// before the API plugin resolves our route controller.
spl_autoload_register(static function (string $class): void {
    $prefix = 'Grav\\Plugin\\VisualEditor\\';
    if (strpos($class, $prefix) === 0) {
        $file = __DIR__ . '/classes/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require_once $file;
        }
    }
});

class VisualEditorPlugin extends Plugin
{
    /** Admin2 custom field type: `admin-next/fields/<type>.js`, also the content_editor preference value. */
    public const FIELD_TYPE = 'visual-editor';

    /**
     * Page effects: frontmatter value => kind of particles and motion. Anything else is ignored.
     * fall: layers drift down; twinkle: particles pulse.
     */
    public const PAGE_EFFECTS = [
        'snow' => ['label' => 'Falling snow', 'kind' => 'snow', 'fall' => true, 'twinkle' => false],
        'snow-still' => ['label' => 'Snow (still)', 'kind' => 'snow', 'fall' => false, 'twinkle' => false],
        'stars' => ['label' => 'Twinkling stars', 'kind' => 'stars', 'fall' => false, 'twinkle' => true],
        'stars-still' => ['label' => 'Stars (still)', 'kind' => 'stars', 'fall' => false, 'twinkle' => false],
        'sparkles' => ['label' => 'Falling sparkles', 'kind' => 'sparkles', 'fall' => true, 'twinkle' => true],
        'sparkles-still' => ['label' => 'Sparkles (still)', 'kind' => 'sparkles', 'fall' => false, 'twinkle' => false],
    ];

    /** Gradient directions: frontmatter value => [label, CSS gradient opening]. Anything else is ignored. */
    public const GRADIENT_DIRECTIONS = [
        'to bottom' => ['Top to bottom', 'linear-gradient(to bottom'],
        'to right' => ['Left to right', 'linear-gradient(to right'],
        'to bottom right' => ['Diagonal', 'linear-gradient(to bottom right'],
        'radial' => ['From the center', 'radial-gradient(circle at center'],
    ];

    /** Page frontmatter key holding the page background color. */
    public const BACKGROUND_FIELD = 'header.background_color';

    public static function getSubscribedEvents(): array
    {
        return [
            'onAdminListContentEditors' => [['onAdminListContentEditors', 0]],
            'onApiBlueprintResolved' => [['onApiBlueprintResolved', 0]],
            'onApiRegisterRoutes' => [['onApiRegisterRoutes', 0]],
            'onPageContentRaw' => [['addAlertStyles', 0]],
            'onTwigSiteVariables' => [['addPageBackground', 0], ['addTableStyles', 0], ['addPageEffect', 0]],
        ];
    }

    /** Offer the editor in the user profile's "Content editor" list (Admin2 fires this event). */
    public function onAdminListContentEditors(Event $event): void
    {
        if (!$this->isEnabled()) {
            return;
        }
        $options = $event['options'];
        $options[self::FIELD_TYPE] = 'Visual Editor';
        $event['options'] = $options;
    }

    /**
     * Page blueprints served to Admin2: hand the editor its settings on the content field, and make it
     * the field type when it is the site default and the user has not explicitly chosen another editor.
     */
    public function onApiBlueprintResolved(Event $event): void
    {
        if (!$this->isEnabled() || ($event['context'] ?? null) !== 'page' || !is_array($event['fields'] ?? null)) {
            return;
        }
        $user = $event['user'] ?? null;
        $preference = $user ? (string)$user->get('content_editor', '') : '';
        $useByDefault = (bool)$this->config->get('plugins.visual-editor.site_default', true)
            && in_array($preference, ['', 'default', self::FIELD_TYPE], true);

        $this->labelLanguage = $this->adminLanguage($user);
        $event['fields'] = $this->rewriteContentField($event['fields'], $useByDefault);
    }

    /** Labels of the fields this plugin adds to the page form, by Admin2 language (English is the key). */
    private const LABELS = [
        'fr' => [
            'Page background color' => 'Couleur de fond de la page',
            'Second color (gradient)' => 'Seconde couleur (dégradé)',
            'Turn it on for a gradient from the page background color to this one.' => 'Activez-la pour un dégradé de la couleur de fond de la page vers celle-ci.',
            'Gradient direction' => 'Direction du dégradé',
            'Top to bottom' => 'De haut en bas',
            'Left to right' => 'De gauche à droite',
            'Diagonal' => 'En diagonale',
            'From the center' => 'Depuis le centre',
            'Page effect' => 'Effet sur la page',
            'A light decoration over the whole page on the site. Visitors who asked their system to reduce motion see it still.'
                => 'Une légère décoration sur toute la page du site. Les visiteurs qui ont demandé à leur système de réduire les animations la voient figée.',
            'Falling snow' => 'Neige qui tombe',
            'Snow (still)' => 'Neige (figée)',
            'Twinkling stars' => 'Étoiles scintillantes',
            'Stars (still)' => 'Étoiles (figées)',
            'Falling sparkles' => 'Paillettes qui tombent',
            'Sparkles (still)' => 'Paillettes (figées)',
            'Background of this page on the site. Leave it off to use the theme background; the text color adapts automatically.'
                => 'Fond de cette page sur le site. Désactivé, la page garde le fond du thème ; la couleur du texte s’adapte automatiquement.',
        ],
    ];

    /** Language of the labels added to the page form, set per blueprint request. */
    private string $labelLanguage = 'en';

    private function label(string $english): string
    {
        return self::LABELS[$this->labelLanguage][$english] ?? $english;
    }

    /**
     * The user's Admin2 interface language (e.g. "fr" for fr-FR). The API translates its own labels with
     * it, but fields added here arrive after that pass, so they are translated by label() instead.
     */
    private function adminLanguage($user): string
    {
        $resolver = 'Grav\\Plugin\\Api\\Services\\PreferencesResolver';
        if (!$user || !class_exists($resolver)) {
            return 'en';
        }
        try {
            $language = (new $resolver($this->grav))->resolve($user, false)['effective']['adminLanguage'] ?? '';
        } catch (\Throwable $e) {
            return 'en';
        }

        return strtolower(substr((string)$language, 0, 2)) ?: 'en';
    }

    /** Front end: paint the page with its `background_color` (frontmatter), text color picked for contrast. */
    public function addPageBackground(): void
    {
        if ($this->isAdmin() || !$this->isEnabled() || !$this->config->get('plugins.visual-editor.page_background', true)) {
            return;
        }
        $page = $this->grav['page'] ?? null;
        if (!$page || !method_exists($page, 'header')) {
            return;
        }
        $header = $page->header();
        $color = self::safeColor((string)($header->background_color ?? ''));
        if ($color === null) {
            return;
        }
        $second = self::safeColor((string)($header->background_color_2 ?? ''));
        $direction = self::GRADIENT_DIRECTIONS[(string)($header->background_direction ?? 'to bottom')] ?? self::GRADIENT_DIRECTIONS['to bottom'];
        // With a gradient the text color is picked on the mix of both colors.
        $text = self::contrastText($second !== null ? (self::mixColors($color, $second) ?? $color) : $color);
        $muted = $text === '#ffffff' ? 'rgba(255,255,255,.72)' : 'rgba(31,35,41,.68)';
        // Quark 2 (Blades/Pico) paints from these variables in both light and dark mode; the plain
        // html/body rules cover other themes. `html:root[data-theme]` outranks the theme's own selectors.
        // Surfaces (content card, alerts, forms) take the page color too, so no theme white is left;
        // recessed areas (code, hovers) get a slightly stronger tint, the header stays translucent.
        $css = "html:root,html:root[data-theme]{--q2-bg:{$color};--q2-bg-elev:{$color};"
            . "--q2-bg-muted:color-mix(in srgb,{$color} 90%,{$text} 10%);"
            . "--q2-nav-bg:color-mix(in srgb,{$color} 82%,transparent);"
            . "--pico-background-color:{$color};--pico-card-background-color:{$color};"
            . "--q2-text:{$text};--q2-text-strong:{$text};--q2-text-muted:{$muted};--pico-color:{$text};--pico-muted-color:{$muted}}"
            . "html,body{background-color:{$color};color:{$text}}";
        if ($second !== null) {
            // The gradient covers the window and stays put while scrolling; surfaces let it through.
            $css .= "html:root,html:root[data-theme]{--q2-bg-elev:transparent;--pico-background-color:transparent;--pico-card-background-color:transparent}"
                . "html{background:{$direction[1]},{$color},{$second}) fixed!important;min-height:100%}"
                . "body,#body-wrapper{background:transparent!important}";
        }
        $this->grav['assets']->addInlineCss($css, ['priority' => 5]);
    }

    /**
     * Front end: snow, stars or sparkles over the page (`page_effect` frontmatter). CSS only: two fixed
     * layers (body::before far, body::after near) tiled with dots, moved by transform (cheap to animate),
     * never catching clicks, and still for visitors who prefer reduced motion.
     */
    public function addPageEffect(): void
    {
        if ($this->isAdmin() || !$this->isEnabled() || !$this->config->get('plugins.visual-editor.page_effects', true)) {
            return;
        }
        $page = $this->grav['page'] ?? null;
        if (!$page || !method_exists($page, 'header')) {
            return;
        }
        $header = $page->header();
        $effect = self::PAGE_EFFECTS[(string)($header->page_effect ?? '')] ?? null;
        if ($effect === null) {
            return;
        }
        $this->grav['assets']->addInlineCss(self::pageEffectCss($effect, self::safeColor((string)($header->background_color ?? ''))), ['priority' => 5]);
    }

    /** The CSS of one page effect; `$background` (validated) picks particle colors that show on it. */
    public static function pageEffectCss(array $effect, ?string $background): string
    {
        // Light background (or unknown): soft blue-grey snow and deeper gold; dark background: white and pale gold.
        $dark = $background !== null && self::contrastText($background) === '#ffffff';
        $colors = [
            'snow' => $dark ? ['rgba(255,255,255,.9)', 'rgba(255,255,255,.7)'] : ['rgba(122,146,180,.75)', 'rgba(122,146,180,.55)'],
            'stars' => $dark ? ['rgba(255,236,170,.95)', 'rgba(255,255,255,.85)'] : ['rgba(212,160,23,.85)', 'rgba(232,160,190,.8)'],
            'sparkles' => $dark ? ['rgba(255,214,120,.95)', 'rgba(255,190,230,.9)'] : ['rgba(212,160,23,.85)', 'rgba(219,112,160,.8)'],
        ][$effect['kind']];
        // Fixed dot layouts per tile (no randomness: the same page always looks the same).
        $layers = [
            'before' => ['tile' => 260, 'radius' => $effect['kind'] === 'snow' ? 1.6 : 1.1, 'color' => $colors[1], 'seconds' => 22,
                'dots' => [[30, 40], [120, 15], [210, 80], [70, 150], [180, 190], [240, 230], [15, 220], [140, 110]]],
            'after' => ['tile' => 380, 'radius' => $effect['kind'] === 'snow' ? 3.2 : 1.8, 'color' => $colors[0], 'seconds' => 13,
                'dots' => [[60, 70], [250, 30], [330, 160], [150, 250], [20, 320], [290, 340]]],
        ];
        $css = '';
        foreach ($layers as $pseudo => $layer) {
            $images = [];
            foreach ($layer['dots'] as [$x, $y]) {
                $edge = $layer['radius'] + 1;
                $images[] = "radial-gradient(circle at {$x}px {$y}px,{$layer['color']} 0 {$layer['radius']}px,transparent {$edge}px)";
            }
            $animations = [];
            if ($effect['fall']) {
                $seconds = $effect['kind'] === 'sparkles' ? (int)round($layer['seconds'] * 1.6) : $layer['seconds'];
                $animations[] = "ve-fx-fall {$seconds}s linear infinite";
            }
            if ($effect['twinkle']) {
                $animations[] = 've-fx-twinkle ' . ($pseudo === 'before' ? '3.2s' : '4.6s') . ' ease-in-out infinite alternate';
            }
            $tile = $layer['tile'];
            $css .= "body::{$pseudo}{content:\"\";position:fixed;left:0;right:0;top:-{$tile}px;height:calc(100% + {$tile}px);"
                . "pointer-events:none;z-index:2147483000;--ve-fx-tile:{$tile}px;"
                . 'background-image:' . implode(',', $images) . ";background-size:{$tile}px {$tile}px;"
                . ($animations ? 'animation:' . implode(',', $animations) . ';will-change:' . ($effect['fall'] ? 'transform' : 'opacity') : '')
                . '}';
        }
        if ($effect['fall']) {
            $css .= '@keyframes ve-fx-fall{from{transform:translateY(0)}to{transform:translateY(var(--ve-fx-tile))}}';
        }
        if ($effect['twinkle']) {
            $css .= '@keyframes ve-fx-twinkle{from{opacity:.35}to{opacity:1}}';
        }

        return $css . '@media (prefers-reduced-motion:reduce){body::before,body::after{animation:none!important}}';
    }

    /**
     * Front end: tables without background or borders, site-wide (`plain_tables`) and per table
     * (`[div class="ve-table-plain"]`; `ve-table-normal` keeps the theme look when the site option is on).
     */
    public function addTableStyles(): void
    {
        if ($this->isAdmin() || !$this->isEnabled()) {
            return;
        }
        $css = '';
        if ($this->config->get('plugins.visual-editor.plain_tables', false)) {
            $css .= self::plainTableCss('table:not(.ve-table-normal table)');
        }
        $page = $this->grav['page'] ?? null;
        $raw = $page && method_exists($page, 'rawMarkdown') ? (string)$page->rawMarkdown() : '';
        if (strpos($raw, 've-table-plain') !== false) {
            $css .= self::plainTableCss('.ve-table-plain table');
        }
        if ($css !== '') {
            $this->grav['assets']->addInlineCss($css, ['priority' => 5]);
        }
    }

    /** CSS removing backgrounds and borders from the tables matched by `$table`. */
    public static function plainTableCss(string $table): string
    {
        return "{$table}{--pico-table-row-stripped-background-color:transparent;--pico-table-border-color:transparent;background:transparent!important;border:0!important}"
            . "{$table} :is(thead,tbody,tfoot,tr,th,td){background:transparent!important;border:0!important;box-shadow:none!important}"
            // Markdown always makes the first row a header; in a plain (layout) table it reads as ordinary text.
            . "{$table} th{font-weight:inherit!important}";
    }

    /** A CSS color we can safely print: hex, rgb[a]() or hsl[a]() with plain numbers only. */
    public static function safeColor(string $value): ?string
    {
        $value = strtolower(trim($value));
        if (preg_match('/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/', $value)
            || preg_match('/^(?:rgb|hsl)a?\(\s*[0-9.]+(?:deg)?%?\s*(?:[,\s\/]\s*[0-9.]+%?\s*){2,3}\)$/', $value)) {
            return $value;
        }

        return null;
    }

    /** The average of two hex or rgb() colors as hex, or null when either cannot be read. */
    public static function mixColors(string $first, string $second): ?string
    {
        $a = self::rgb($first);
        $b = self::rgb($second);
        if ($a === null || $b === null) {
            return null;
        }

        return vsprintf('#%02x%02x%02x', array_map(static fn($x, $y) => (int)round(($x + $y) / 2), $a, $b));
    }

    /** [r, g, b] of a hex or rgb() color, or null. */
    private static function rgb(string $color): ?array
    {
        if (preg_match('/^#([0-9a-f]{3,8})$/i', $color, $m)) {
            $hex = strlen($m[1]) <= 4 ? preg_replace('/(.)/', '$1$1', $m[1]) : $m[1];
            return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
        }
        if (preg_match('/^rgba?\\(\\s*([0-9.]+)[,\\s]+([0-9.]+)[,\\s]+([0-9.]+)/i', $color, $m)) {
            return [(float)$m[1], (float)$m[2], (float)$m[3]];
        }

        return null;
    }

    /** Dark or white text for a background (WCAG relative luminance); dark text when unknown. */
    public static function contrastText(string $color): string
    {
        $rgb = null;
        if (preg_match('/^#([0-9a-f]{3,8})$/', $color, $m)) {
            $hex = $m[1];
            if (strlen($hex) <= 4) {
                $hex = preg_replace('/(.)/', '$1$1', $hex);
            }
            $rgb = [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
        } elseif (preg_match('/^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/', $color, $m)) {
            $rgb = [(float)$m[1], (float)$m[2], (float)$m[3]];
        }
        if ($rgb === null) {
            return '#1f2329';
        }
        $channel = static function (float $value): float {
            $value /= 255;
            return $value <= 0.03928 ? $value / 12.92 : (($value + 0.055) / 1.055) ** 2.4;
        };
        $luminance = 0.2126 * $channel($rgb[0]) + 0.7152 * $channel($rgb[1]) + 0.0722 * $channel($rgb[2]);

        return $luminance > 0.36 ? '#1f2329' : '#ffffff';
    }

    public function onApiRegisterRoutes(Event $event): void
    {
        if (!$this->isEnabled()) {
            return;
        }
        $event['routes']->post('/visual-editor/preview', [PreviewController::class, 'preview']);
    }

    public function addAlertStyles(Event $event): void
    {
        if ($this->isAdmin() || !$this->isEnabled() || !$this->config->get('plugins.visual-editor.frontend_alerts', false)) {
            return;
        }
        $page = $event['page'];
        $content = $page->getRawContent();
        if (strpos($content, '<link data-visual-editor-alerts') !== false) {
            return;
        }
        $href = htmlspecialchars($this->grav['base_url_relative'] . '/user/plugins/visual-editor/assets/css/alerts.css', ENT_QUOTES, 'UTF-8');
        $page->setRawContent('<link data-visual-editor-alerts rel="stylesheet" href="' . $href . '">' . $content);
    }

    private function isEnabled(): bool
    {
        return (bool)$this->config->get('plugins.visual-editor.enabled', true);
    }

    /** Recursively finds the field named `content` (any nesting: tabs, sections). */
    private function rewriteContentField(array $fields, bool $useByDefault): array
    {
        $isList = array_keys($fields) === range(0, count($fields) - 1);
        $out = [];
        foreach ($this->rewriteContentFieldIn($fields, $useByDefault) as $key => $field) {
            // Lists are rebuilt by appending, so an inserted field never takes (or loses) a sibling's index.
            if ($isList) {
                $out[] = $field;
            } else {
                $out[$key] = $field;
            }
            // Page background color right below the editor (lists only: Admin2 serializes field lists).
            if ($isList && is_array($field) && ($field['name'] ?? null) === 'content' && isset($field['visual_editor'])
                && !$this->hasField($fields, self::BACKGROUND_FIELD) && !$this->hasField($fields, 'header.page_effect')) {
                foreach ($this->pageFields() as $pageField) {
                    $out[] = $pageField;
                }
            }
        }

        return $out;
    }

    /** Fields added right below the editor: page background (solid or gradient), page effect. */
    private function pageFields(): array
    {
        $fields = $this->config->get('plugins.visual-editor.page_background', true) ? $this->backgroundFields() : [];
        if ($this->config->get('plugins.visual-editor.page_effects', true)) {
            $effects = [];
            foreach (self::PAGE_EFFECTS as $value => $definition) {
                $effects[] = ['value' => $value, 'label' => $this->label($definition['label'])];
            }
            $fields[] = [
                'name' => 'header.page_effect',
                'type' => 'select',
                'label' => $this->label('Page effect'),
                'help' => $this->label('A light decoration over the whole page on the site. Visitors who asked their system to reduce motion see it still.'),
                'default' => 'snow',
                'options' => $effects,
                'toggleable' => true,
            ];
        }

        return $fields;
    }

    private function backgroundFields(): array
    {
        $directions = [];
        foreach (self::GRADIENT_DIRECTIONS as $value => $definition) {
            $directions[] = ['value' => $value, 'label' => $this->label($definition[0])];
        }

        return [
            [
                'name' => self::BACKGROUND_FIELD,
                'type' => 'colorpicker',
                'label' => $this->label('Page background color'),
                'help' => $this->label('Background of this page on the site. Leave it off to use the theme background; the text color adapts automatically.'),
                'toggleable' => true,
            ],
            [
                'name' => 'header.background_color_2',
                'type' => 'colorpicker',
                'label' => $this->label('Second color (gradient)'),
                'help' => $this->label('Turn it on for a gradient from the page background color to this one.'),
                'toggleable' => true,
            ],
            [
                'name' => 'header.background_direction',
                'type' => 'select',
                'label' => $this->label('Gradient direction'),
                'default' => 'to bottom',
                'options' => $directions,
                'toggleable' => true,
            ],
        ];
    }

    private function hasField(array $fields, string $name): bool
    {
        foreach ($fields as $field) {
            if (is_array($field) && ($field['name'] ?? null) === $name) {
                return true;
            }
        }

        return false;
    }

    private function rewriteContentFieldIn(array $fields, bool $useByDefault): array
    {
        foreach ($fields as $key => $field) {
            if (!is_array($field)) {
                continue;
            }
            $name = $field['name'] ?? (is_string($key) ? $key : null);
            if ($name === 'content' && in_array($field['type'] ?? '', ['markdown', 'editor', self::FIELD_TYPE], true)) {
                $field['visual_editor'] = $this->clientConfig();
                if ($useByDefault) {
                    $field['type'] = self::FIELD_TYPE;
                }
                $fields[$key] = $field;
                continue;
            }
            if (isset($field['fields']) && is_array($field['fields'])) {
                $field['fields'] = $this->rewriteContentField($field['fields'], $useByDefault);
                $fields[$key] = $field;
            }
        }

        return $fields;
    }

    private function clientConfig(): array
    {
        $config = $this->config;
        $shortcodes = $config->get('plugins.visual-editor.shortcodes', []);

        return [
            'theme' => (string)$config->get('plugins.visual-editor.theme', 'auto'),
            'smartTypography' => (bool)$config->get('plugins.visual-editor.smart_typography', true),
            'shortcodePreviews' => (bool)$config->get('plugins.visual-editor.shortcode_previews', true),
            'toolbar' => preg_split('/\s*,\s*/', (string)$config->get('plugins.visual-editor.toolbar', ''), -1, PREG_SPLIT_NO_EMPTY),
            'shortcodes' => is_array($shortcodes) ? array_values($shortcodes) : [],
            'maxUploadBytes' => $this->uploadLimit(),
            'plainTables' => (bool)$config->get('plugins.visual-editor.plain_tables', false),
        ];
    }

    private function uploadLimit(): int
    {
        $limits = [10 * 1024 * 1024];
        foreach (['upload_max_filesize', 'post_max_size'] as $key) {
            $value = trim((string)ini_get($key));
            if ($value === '' || $value === '0') {
                continue;
            }
            $number = (float)$value;
            $unit = strtolower(substr($value, -1));
            $factor = ['k' => 1024, 'm' => 1024 ** 2, 'g' => 1024 ** 3][$unit] ?? 1;
            $limits[] = (int)($number * $factor);
        }

        return min($limits);
    }
}
