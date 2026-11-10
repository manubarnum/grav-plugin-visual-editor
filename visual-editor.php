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

    /** Page settings written by the editor's button: an HTML comment opening the content. */
    private const SETTINGS_COMMENT = '/^<!--\s*ve-page\b(.*?)-->[ \t]*(?:\r?\n(?:[ \t]*\r?\n)?|$)/s';

    public static function getSubscribedEvents(): array
    {
        return [
            'onAdminListContentEditors' => [['onAdminListContentEditors', 0]],
            'onApiBlueprintResolved' => [['onApiBlueprintResolved', 0]],
            'onApiRegisterRoutes' => [['onApiRegisterRoutes', 0]],
            'onPageContentRaw' => [['stripPageSettings', 10], ['addAlertStyles', 0]],
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

        $event['fields'] = $this->rewriteContentField($event['fields'], $useByDefault);
    }

    /**
     * A page's background and effect: from the `<!-- ve-page … -->` comment opening its content (written by
     * the editor's button), else from the former frontmatter fields (`background_color`, `background_color_2`,
     * `background_direction`, `page_effect`). A comment, even empty, replaces those fields entirely.
     */
    public static function pageSettings($page): array
    {
        $raw = method_exists($page, 'rawMarkdown') ? (string)$page->rawMarkdown() : '';
        if (preg_match(self::SETTINGS_COMMENT, ltrim($raw, "\u{FEFF}"), $match)) {
            preg_match_all('/([a-z0-9_-]+)\s*=\s*"([^"]*)"/i', $match[1], $pairs, PREG_SET_ORDER);
            $values = [];
            foreach ($pairs as [, $key, $value]) {
                $values[strtolower($key)] = trim($value);
            }
        } else {
            $header = method_exists($page, 'header') ? $page->header() : null;
            $read = static fn(string $key): string => is_object($header) && is_scalar($header->{$key} ?? null) ? trim((string)$header->{$key}) : '';
            $values = ['background' => $read('background_color'), 'background2' => $read('background_color_2'),
                'direction' => $read('background_direction'), 'effect' => $read('page_effect')];
        }

        return [
            'background' => $values['background'] ?? '',
            'background2' => $values['background2'] ?? '',
            'direction' => $values['direction'] ?? '',
            'effect' => $values['effect'] ?? '',
            'intensity' => $values['intensity'] ?? '',
        ];
    }

    /** Front end: paint the page with its background color or gradient, text color picked for contrast. */
    public function addPageBackground(): void
    {
        if ($this->isAdmin() || !$this->isEnabled() || !$this->config->get('plugins.visual-editor.page_background', true)) {
            return;
        }
        $page = $this->grav['page'] ?? null;
        if (!$page || !method_exists($page, 'header')) {
            return;
        }
        $settings = self::pageSettings($page);
        $color = self::safeColor($settings['background']);
        if ($color === null) {
            return;
        }
        $second = self::safeColor($settings['background2']);
        $direction = self::GRADIENT_DIRECTIONS[$settings['direction']] ?? self::GRADIENT_DIRECTIONS['to bottom'];
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
        $settings = self::pageSettings($page);
        $effect = self::PAGE_EFFECTS[$settings['effect']] ?? null;
        if ($effect === null) {
            return;
        }
        $background = $this->config->get('plugins.visual-editor.page_background', true) ? self::safeColor($settings['background']) : null;
        $this->grav['assets']->addInlineCss(self::pageEffectCss($effect, $background, $settings['intensity']), ['priority' => 5]);
    }

    /** The CSS of one page effect; `$background` (validated) picks particle colors that show on it. */
    /** Effect intensities: frontmatter value => [particle count, size, duration] factors. Anything else is normal. */
    public const EFFECT_INTENSITIES = [
        'light' => [0.5, 0.85, 1.5],
        'normal' => [1, 1, 1],
        'strong' => [1.6, 1.2, 0.7],
    ];

    public static function pageEffectCss(array $effect, ?string $background, string $intensity = 'normal'): string
    {
        [$more, $bigger, $slower] = self::EFFECT_INTENSITIES[$intensity] ?? self::EFFECT_INTENSITIES['normal'];
        // Light background (or none): blue-grey snow and deep gold; dark background: white and pale gold.
        $dark = $background !== null && self::contrastText($background) === '#ffffff';
        $colors = [
            'snow' => $dark ? ['rgba(255,255,255,.95)', 'rgba(255,255,255,.75)'] : ['rgba(122,146,180,.9)', 'rgba(122,146,180,.7)'],
            'stars' => $dark ? ['rgba(255,236,170,.95)', 'rgba(255,255,255,.9)'] : ['rgba(212,160,23,.9)', 'rgba(219,112,160,.85)'],
            'sparkles' => $dark ? ['rgba(255,214,120,.95)', 'rgba(255,190,230,.9)'] : ['rgba(212,160,23,.9)', 'rgba(219,112,160,.85)'],
        ][$effect['kind']];
        // Far layer (before): many small particles, slow; near layer (after): fewer, bigger, faster.
        $layers = [
            'before' => ['tile' => 300, 'count' => 26, 'size' => [2.5, 5], 'seconds' => 11, 'seed' => 7],
            'after' => ['tile' => 440, 'count' => 18, 'size' => [5, 10], 'seconds' => 7, 'seed' => 3],
        ];
        $css = '';
        foreach ($layers as $pseudo => $layer) {
            $tile = $layer['tile'];
            $size = [$layer['size'][0] * $bigger, $layer['size'][1] * $bigger];
            $image = self::particleTile($effect['kind'], $tile, (int)round($layer['count'] * $more), $size, $colors, $layer['seed']);
            $animations = [];
            if ($effect['fall']) {
                $seconds = (int)round($layer['seconds'] * $slower * ($effect['kind'] === 'sparkles' ? 1.3 : 1));
                $animations[] = "ve-fx-fall {$seconds}s linear infinite";
            }
            if ($effect['twinkle']) {
                $animations[] = 've-fx-twinkle ' . ($pseudo === 'before' ? '1.6s' : '2.4s') . ' ease-in-out infinite alternate';
            }
            $css .= "body::{$pseudo}{content:\"\";position:fixed;left:0;right:0;top:-{$tile}px;height:calc(100% + {$tile}px);"
                . "pointer-events:none;z-index:2147483000;--ve-fx-tile:{$tile}px;"
                . "background-image:url(\"{$image}\");background-size:{$tile}px {$tile}px;background-repeat:repeat;"
                . ($animations ? 'animation:' . implode(',', $animations) . ';will-change:' . ($effect['fall'] ? 'transform' : 'opacity') : '')
                . '}';
        }
        if ($effect['fall']) {
            $css .= '@keyframes ve-fx-fall{from{transform:translateY(0)}to{transform:translateY(var(--ve-fx-tile))}}';
        }
        if ($effect['twinkle']) {
            $css .= '@keyframes ve-fx-twinkle{from{opacity:.5}to{opacity:1}}';
        }

        return $css . '@media (prefers-reduced-motion:reduce){body::before,body::after{animation:none!important}}';
    }

    /**
     * One square SVG tile (data URI) of particles at fixed pseudo-random places (the same page always
     * looks the same): soft glowing dots for snow, four-pointed stars for stars, a mix for sparkles.
     */
    private static function particleTile(string $kind, int $tile, int $count, array $size, array $colors, int $seed): string
    {
        $next = static function () use (&$seed): float {
            $seed = ($seed * 1103515245 + 12345) % 2147483648;
            return $seed / 2147483648;
        };
        $svg = "<svg xmlns='http://www.w3.org/2000/svg' width='{$tile}' height='{$tile}'>"
            . "<defs><radialGradient id='a'><stop offset='0' stop-color='{$colors[0]}'/><stop offset='.45' stop-color='{$colors[0]}'/>"
            . "<stop offset='1' stop-color='{$colors[0]}' stop-opacity='0'/></radialGradient>"
            . "<radialGradient id='b'><stop offset='0' stop-color='{$colors[1]}'/><stop offset='.45' stop-color='{$colors[1]}'/>"
            . "<stop offset='1' stop-color='{$colors[1]}' stop-opacity='0'/></radialGradient></defs>";
        for ($i = 0; $i < $count; $i++) {
            $x = round(8 + $next() * ($tile - 16), 1);
            $y = round(8 + $next() * ($tile - 16), 1);
            $r = round(($size[0] + $next() * ($size[1] - $size[0])) * ($kind === 'snow' ? 1.3 : 1), 1);
            $second = $i % 3 === 2;
            $star = $kind === 'stars' ? $i % 4 !== 3 : ($kind === 'sparkles' && $i % 2 === 0);
            if ($star) {
                // Four-pointed star: points at r * 2.2, pinched toward the center.
                $s = round($r * 2.2, 1);
                $fill = $colors[$second ? 1 : 0];
                $svg .= "<path fill='{$fill}' d='M{$x} " . ($y - $s) . "Q{$x} {$y} " . ($x + $s) . " {$y}Q{$x} {$y} {$x} " . ($y + $s)
                    . "Q{$x} {$y} " . ($x - $s) . " {$y}Q{$x} {$y} {$x} " . ($y - $s) . "Z'/>";
            } else {
                $svg .= "<circle cx='{$x}' cy='{$y}' r='{$r}' fill='url(%23" . ($second ? 'b' : 'a') . ")'/>";
            }
        }
        $svg .= '</svg>';

        return 'data:image/svg+xml,' . strtr($svg, ['<' => '%3C', '>' => '%3E', '#' => '%23']);
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

    /** The page settings comment is not content: keep it out of the rendered page. */
    public function stripPageSettings(Event $event): void
    {
        if ($this->isAdmin() || !$this->isEnabled()) {
            return;
        }
        $page = $event['page'];
        $content = (string)$page->getRawContent();
        $stripped = preg_replace(self::SETTINGS_COMMENT, '', $content, 1);
        if (is_string($stripped) && $stripped !== $content) {
            $page->setRawContent($stripped);
        }
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
        }

        return $out;
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
            'pageBackground' => (bool)$config->get('plugins.visual-editor.page_background', true),
            'pageEffects' => (bool)$config->get('plugins.visual-editor.page_effects', true),
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
