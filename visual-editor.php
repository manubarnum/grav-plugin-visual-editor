<?php
/** Independent, Markdown-preserving visual editor for Grav. */

namespace Grav\Plugin;

use Grav\Common\Plugin;
use Grav\Common\Page\Interfaces\PageInterface;
use Grav\Common\Utils;
use Grav\Plugin\VisualEditor\AdminBridge;
use Grav\Plugin\VisualEditor\ShortcodePreviewExtension;
use RocketTheme\Toolbox\Event\Event;

class VisualEditorPlugin extends Plugin
{
    public static function getSubscribedEvents(): array
    {
        return [
            'onPluginsInitialized' => [['onPluginsInitialized', 0]],
            'onTwigTemplatePaths' => [['onTwigTemplatePaths', 0]],
            'onTwigSiteVariables' => [['onTwigSiteVariables', 0]],
            'onPageContentRaw' => [['addAlertStyles', 0]],
        ];
    }

    public function onPluginsInitialized(): void
    {
        if (!$this->config->get('plugins.visual-editor.enabled', true) || !$this->isAdmin()) {
            return;
        }

        $this->enable([
            'onAssetsInitialized' => ['onAssetsInitialized', -1000],
            'onTwigExtensions' => ['registerPreviewExtension', 0],
            'onAdminTaskExecute' => ['onAdminTaskExecute', 0],
        ]);
    }

    public function onTwigTemplatePaths(): void
    {
        $this->grav['twig']->twig_paths[] = __DIR__ . '/templates';
    }

    public function registerPreviewExtension(): void
    {
        if (class_exists('Grav\\Plugin\\ShortcodeCore\\ShortcodeCorePlugin')) {
            $this->grav['twig']->twig()->addExtension(new ShortcodePreviewExtension());
        }
    }

    public function onAdminTaskExecute(Event $event): void
    {
        $controller = $event['controller'];
        $method = (string)$event['method'];
        if (!in_array($method, ['taskVisualEditorUpload', 'taskVisualEditorPreview', 'taskVisualEditorMedia'], true)) {
            return;
        }
        $event->stopPropagation();
        $bridge = new AdminBridge($this->grav, $this->config);
        $bridge->handleTask($method, $controller);
    }

    public function onTwigSiteVariables(): void
    {
        if (!$this->isAdmin() || !$this->config->get('plugins.visual-editor.enabled', true) || !$this->isPageEditor()) {
            return;
        }
        $page = $this->grav['page'] ?? null;
        $this->grav['twig']->twig_vars['visual_editor_config'] = [
            'theme' => $this->config->get('plugins.visual-editor.theme', 'auto'),
            'smartTypography' => (bool)$this->config->get('plugins.visual-editor.smart_typography', true),
            'shortcodePreviews' => (bool)$this->config->get('plugins.visual-editor.shortcode_previews', true),
            'toolbar' => preg_split('/\s*,\s*/', (string)$this->config->get('plugins.visual-editor.toolbar', ''), -1, PREG_SPLIT_NO_EMPTY),
            'uploadUrl' => $this->adminUrl('visualEditorUpload'),
            'previewUrl' => $this->adminUrl('visualEditorPreview'),
            'mediaUrl' => $this->adminUrl('visualEditorMedia'),
            'pageRoute' => $page instanceof PageInterface ? $page->route() : '',
            'pageMediaUrl' => $page instanceof PageInterface ? $this->grav['base_url_relative'] . $page->route() . '/' : '',
            'nonce' => Utils::getNonce('admin-form'),
            'shortcodes' => $this->config->get('plugins.visual-editor.shortcodes', []),
            'maxUploadBytes' => min(10 * 1024 * 1024, $this->uploadLimit()),
            'version' => '1.0.0',
        ];
    }

    public function onAssetsInitialized(): void
    {
        if (!$this->isPageEditor()) {
            return;
        }
        $this->grav['assets']->addCss('plugin://visual-editor/assets/css/editor.css', ['priority' => 90]);
        $this->grav['assets']->addCss('plugin://visual-editor/assets/css/alerts.css', ['priority' => 89]);
        $this->grav['assets']->addInlineJs('window.GravVisualEditorConfig = ' . json_encode($this->grav['twig']->twig_vars['visual_editor_config'] ?? [], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ';', ['priority' => 91]);
        $this->grav['assets']->addJs('plugin://visual-editor/assets/js/editor.js', ['priority' => 90, 'loading' => 'defer']);
    }

    public function addAlertStyles(Event $event): void
    {
        if ($this->isAdmin() || !$this->config->get('plugins.visual-editor.enabled', true)
            || !$this->config->get('plugins.visual-editor.frontend_alerts', true)) {
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

    private function isPageEditor(): bool
    {
        if (!$this->config->get('plugins.visual-editor.enabled', true)) {
            return false;
        }
        $route = trim($this->grav['uri']->route(), '/');
        $adminRoute = trim((string)$this->config->get('plugins.admin.route', '/admin'), '/');
        return $route === $adminRoute . '/pages' || strpos($route, $adminRoute . '/pages/') === 0;
    }

    private function adminUrl(string $task): string
    {
        $route = trim((string)$this->config->get('plugins.admin.route', '/admin'), '/');
        return $this->grav['base_url_relative'] . '/' . $route . '/task:' . $task;
    }

    private function uploadLimit(): int
    {
        $limits = [];
        foreach (['upload_max_filesize', 'post_max_size'] as $key) {
            $value = trim((string)ini_get($key));
            if ($value === '') {
                continue;
            }
            $number = (float)$value;
            $unit = strtolower(substr($value, -1));
            if ($unit === 'g') { $number *= 1024; }
            if ($unit === 'm' || $unit === 'g') { $number *= 1024; }
            if ($unit === 'k' || $unit === 'm' || $unit === 'g') { $number *= 1024; }
            $limits[] = (int)$number;
        }
        return $limits ? min($limits) : 10 * 1024 * 1024;
    }
}
