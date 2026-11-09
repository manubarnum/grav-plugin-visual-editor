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

    public static function getSubscribedEvents(): array
    {
        return [
            'onAdminListContentEditors' => [['onAdminListContentEditors', 0]],
            'onApiBlueprintResolved' => [['onApiBlueprintResolved', 0]],
            'onApiRegisterRoutes' => [['onApiRegisterRoutes', 0]],
            'onPageContentRaw' => [['addAlertStyles', 0]],
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
