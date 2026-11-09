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

    /** Page frontmatter key holding the page background color. */
    public const BACKGROUND_FIELD = 'header.background_color';

    public static function getSubscribedEvents(): array
    {
        return [
            'onAdminListContentEditors' => [['onAdminListContentEditors', 0]],
            'onApiBlueprintResolved' => [['onApiBlueprintResolved', 0]],
            'onApiRegisterRoutes' => [['onApiRegisterRoutes', 0]],
            'onPageContentRaw' => [['addAlertStyles', 0]],
            'onTwigSiteVariables' => [['addPageBackground', 0], ['addTableStyles', 0]],
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
        $color = self::safeColor((string)($page->header()->background_color ?? ''));
        if ($color === null) {
            return;
        }
        $text = self::contrastText($color);
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
        $this->grav['assets']->addInlineCss($css, ['priority' => 5]);
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
            . "{$table} :is(thead,tbody,tfoot,tr,th,td){background:transparent!important;border:0!important;box-shadow:none!important}";
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
                && $this->config->get('plugins.visual-editor.page_background', true) && !$this->hasField($fields, self::BACKGROUND_FIELD)) {
                $out[] = [
                    'name' => self::BACKGROUND_FIELD,
                    'type' => 'colorpicker',
                    'label' => 'Page background color',
                    'help' => 'Background of this page on the site. Leave it off to use the theme background; the text color adapts automatically.',
                    'toggleable' => true,
                ];
            }
        }

        return $out;
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
