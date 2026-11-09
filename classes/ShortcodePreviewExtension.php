<?php

namespace Grav\Plugin\VisualEditor;

use Twig\Extension\AbstractExtension;
use Twig\TwigFunction;

/** Keeps shortcode rendering optional; raw HTML and Twig are never executed here. */
class ShortcodePreviewExtension extends AbstractExtension
{
    public function getFunctions(): array
    {
        return [new TwigFunction('visual_editor_shortcodes', [$this, 'processShortcodes'], ['is_safe' => ['html']])];
    }

    public function processShortcodes(string $content): string
    {
        if (class_exists('Grav\\Plugin\\ShortcodeCore\\ShortcodeCorePlugin')) {
            $plugin = \Grav\Common\Grav::instance()['plugins']->get('shortcode-core');
            if ($plugin && method_exists($plugin, 'processShortcodes')) {
                return (string)$plugin->processShortcodes($content);
            }
            if (class_exists('Grav\\Plugin\\ShortcodeCore\\ShortcodeManager')) {
                $manager = \Grav\Common\Grav::instance()['shortcode'] ?? null;
                if ($manager && method_exists($manager, 'processShortcodes')) {
                    return (string)$manager->processShortcodes($content);
                }
            }
        }
        return '<pre class="visual-editor-source-preview">' . htmlspecialchars($content, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</pre>';
    }
}
