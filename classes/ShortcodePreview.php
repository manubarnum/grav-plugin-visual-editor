<?php

namespace Grav\Plugin\VisualEditor;

use Grav\Common\Grav;

/** Renders shortcodes for the editor preview through shortcode-core. Raw HTML and Twig are never executed. */
final class ShortcodePreview
{
    /** HTML from shortcode-core, or null when it is not available for this request. */
    public static function render(Grav $grav, string $source): ?string
    {
        if (!isset($grav['shortcode'])) {
            return null;
        }
        $manager = $grav['shortcode'];
        if (!method_exists($manager, 'processShortcodes')) {
            return null;
        }
        // shortcode-core registers its handlers on onThemeInitialized; make sure they exist for API requests.
        if (method_exists($manager, 'getHandlers')) {
            $handlers = $manager->getHandlers();
            if (is_object($handlers) && method_exists($handlers, 'getNames') && !$handlers->getNames()) {
                $grav->fireEvent('onShortcodeHandlers');
            }
        }

        return (string)$manager->processShortcodes($source);
    }

    public static function escaped(string $source): string
    {
        return '<pre class="visual-editor-source-preview">' . htmlspecialchars($source, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</pre>';
    }
}
