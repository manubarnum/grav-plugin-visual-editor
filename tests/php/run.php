<?php
/**
 * PHP tests without PHPUnit: `php tests/php/run.php` (also run by `npm test` via tests/php.test.mjs).
 * Exits non-zero on the first failing expectation of any test and prints a summary.
 */

require __DIR__ . '/stubs.php';
require __DIR__ . '/../../visual-editor.php';
require __DIR__ . '/../../classes/ShortcodePreview.php';

use Grav\Common\Grav;
use Grav\Plugin\VisualEditor\ShortcodePreview;
use Grav\Plugin\VisualEditorPlugin;
use RocketTheme\Toolbox\Event\Event;
use VeTest\{Assets, Config, Page, Routes, ShortcodeManager, User};

$tests = [];
$failures = 0;
function test(string $name, callable $body): void { $GLOBALS['tests'][$name] = $body; }
function same($expected, $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($message ? "$message: " : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}
function ok($value, string $message): void { if (!$value) { throw new RuntimeException($message); } }

function plugin(array $config = [], array $services = []): VisualEditorPlugin
{
    $grav = new Grav(array_merge(['assets' => new Assets(), 'base_url_relative' => ''], $services));
    return new VisualEditorPlugin($grav, new Config($config));
}

/** The site's default page blueprint shape: tabs > tab "content" > fields. */
function pageFields(string $contentType = 'markdown'): array
{
    return [['name' => 'tabs', 'type' => 'tabs', 'fields' => [
        ['name' => 'content', 'type' => 'tab', 'fields' => [
            ['name' => 'header.title', 'type' => 'text'],
            ['name' => 'content', 'type' => $contentType],
            ['name' => 'header.media_order', 'type' => 'pagemedia'],
        ]],
        ['name' => 'options', 'type' => 'tab', 'fields' => [['name' => 'header.published', 'type' => 'toggle']]],
    ]]];
}

function resolve(VisualEditorPlugin $plugin, string $editor = '', string $context = 'page', ?array $fields = null): array
{
    $event = new Event(['context' => $context, 'fields' => $fields ?? pageFields(), 'user' => new User($editor)]);
    $plugin->onApiBlueprintResolved($event);
    return $event['fields'];
}

function contentTab(array $fields): array { return $fields[0]['fields'][0]['fields']; }
function names(array $fields): array { return array_map(fn($field) => $field['name'] . ':' . $field['type'], $fields); }

// --- Blueprint rewrite -------------------------------------------------------------------------------

test('site default: the content field becomes the visual editor, with its client config', function () {
    $tab = contentTab(resolve(plugin(['plugins.visual-editor.toolbar' => 'bold, italic'])));
    same(['header.title:text', 'content:visual-editor', 'header.background_color:colorpicker', 'header.media_order:pagemedia'], names($tab));
    same(['bold', 'italic'], $tab[1]['visual_editor']['toolbar']);
    same(false, $tab[1]['visual_editor']['plainTables']);
});

test('a user who chose CodeMirror keeps the markdown field (config still attached)', function () {
    $tab = contentTab(resolve(plugin(), 'codemirror'));
    same('markdown', $tab[1]['type']);
    ok(isset($tab[1]['visual_editor']), 'client config attached for the preference path');
});

test('the "visual-editor" preference and "default" both use the editor', function () {
    foreach (['default', 'visual-editor'] as $preference) {
        same('visual-editor', contentTab(resolve(plugin(), $preference))[1]['type'], $preference);
    }
});

test('site_default off: the field type is left alone', function () {
    same('markdown', contentTab(resolve(plugin(['plugins.visual-editor.site_default' => false])))[1]['type']);
});

test('the page background field never overwrites a sibling and is not duplicated', function () {
    $plugin = plugin();
    $once = resolve($plugin);
    $twice = resolve($plugin, '', 'page', $once);
    same(4, count(contentTab($twice)));
    same('header.media_order', contentTab($twice)[3]['name']);
});

test('page_background off: no background field', function () {
    same(['header.title:text', 'content:visual-editor', 'header.media_order:pagemedia'], names(contentTab(resolve(plugin(['plugins.visual-editor.page_background' => false])))));
});

test('only page blueprints are touched, and nothing when the plugin is disabled', function () {
    same(pageFields(), resolve(plugin(), '', 'plugin'));
    same(pageFields(), resolve(plugin(['plugins.visual-editor.enabled' => false])));
});

test('upload limit is the smallest of 10 MB and the PHP ini limits', function () {
    $limit = contentTab(resolve(plugin()))[1]['visual_editor']['maxUploadBytes'];
    ok($limit > 0 && $limit <= 10 * 1024 * 1024, "limit $limit");
});

// --- Registration hooks ------------------------------------------------------------------------------

test('the editor is offered in the content editor list', function () {
    $options = ['default' => 'Default', 'codemirror' => 'CodeMirror'];
    $event = new Event(['options' => &$options]);
    plugin()->onAdminListContentEditors($event);
    same('Visual Editor', $options['visual-editor'] ?? null);
});

test('the preview route is registered on the API router', function () {
    $routes = new Routes();
    plugin()->onApiRegisterRoutes(new Event(['routes' => $routes]));
    same([\Grav\Plugin\VisualEditor\PreviewController::class, 'preview'], $routes->post['/visual-editor/preview'] ?? null);
});

// --- Colors ------------------------------------------------------------------------------------------

test('safeColor accepts plain colors only', function () {
    foreach (['#fde2e4', '#FFF', '#11223344', 'rgb(10, 20, 30)', 'rgba(10,20,30,.5)', 'hsl(120deg 50% 50%)'] as $color) {
        ok(VisualEditorPlugin::safeColor($color) !== null, "accepts $color");
    }
    foreach (['red;}body{x', '"><script>', '#12', 'url(x)', 'var(--x)', ''] as $color) {
        same(null, VisualEditorPlugin::safeColor($color), "rejects $color");
    }
});

test('contrastText picks dark text on light backgrounds and white on dark ones', function () {
    same('#1f2329', VisualEditorPlugin::contrastText('#fde2e4'));
    same('#ffffff', VisualEditorPlugin::contrastText('#1d3557'));
    same('#ffffff', VisualEditorPlugin::contrastText('rgb(10, 20, 30)'));
    same('#1f2329', VisualEditorPlugin::contrastText('#fff'));
});

test('page background: theme variables for the frontmatter color, nothing otherwise', function () {
    $assets = new Assets();
    plugin([], ['assets' => $assets, 'page' => new Page(['background_color' => '#1d3557'])])->addPageBackground();
    ok(str_contains($assets->css[0] ?? '', '--q2-bg:#1d3557') && str_contains($assets->css[0], '--q2-bg-elev:#1d3557') && str_contains($assets->css[0], 'color:#ffffff'), 'css for the color');

    foreach ([[], ['background_color' => 'red;}x{'], ['background_color' => '']] as $header) {
        $assets = new Assets();
        plugin([], ['assets' => $assets, 'page' => new Page($header)])->addPageBackground();
        same([], $assets->css, 'no css for ' . json_encode($header));
    }
    $assets = new Assets();
    $admin = plugin([], ['assets' => $assets, 'page' => new Page(['background_color' => '#000'])]);
    $admin->admin = true;
    $admin->addPageBackground();
    same([], $assets->css, 'never in admin');
});

test('the PHP contrast rule matches the shared fixture (the JS tests check the same file)', function () {
    foreach (json_decode(file_get_contents(__DIR__ . '/../fixtures/contrast.json'), true) as $case) {
        $color = VisualEditorPlugin::safeColor($case['color']) ?? $case['color'];
        same($case['text'], VisualEditorPlugin::contrastText($color), $case['color']);
    }
});

// --- Tables ------------------------------------------------------------------------------------------

test('plain tables: site-wide option, per-table class, or no css at all', function () {
    $run = function (bool $global, string $raw): array {
        $assets = new Assets();
        plugin(['plugins.visual-editor.plain_tables' => $global], ['assets' => $assets, 'page' => new Page([], $raw)])->addTableStyles();
        return $assets->css;
    };
    same([], $run(false, 'No tables here.'));
    ok(str_contains($run(false, "[div class=\"ve-table-plain\"]\n\n| a |\n\n[/div]")[0] ?? '', '.ve-table-plain table'), 'per-table css');
    ok(str_contains($run(true, '')[0] ?? '', 'table:not(.ve-table-normal table)'), 'site-wide css keeps normal tables');
});

// --- Front-end alerts --------------------------------------------------------------------------------

test('alert styles are prepended once, only when enabled', function () {
    $page = new Page([], 'Text');
    plugin(['plugins.visual-editor.frontend_alerts' => true])->addAlertStyles(new Event(['page' => $page]));
    plugin(['plugins.visual-editor.frontend_alerts' => true])->addAlertStyles(new Event(['page' => $page]));
    same(1, substr_count($page->raw, 'data-visual-editor-alerts'));
    $off = new Page([], 'Text');
    plugin()->addAlertStyles(new Event(['page' => $off]));
    same('Text', $off->raw);
});

// --- Shortcode preview -------------------------------------------------------------------------------

test('shortcode preview: null without shortcode-core, rendered with it, handlers registered on demand', function () {
    same(null, ShortcodePreview::render(new Grav([]), '[notice]x[/notice]'));
    $manager = new ShortcodeManager();
    $grav = new Grav(['shortcode' => $manager]);
    same('<div class="rendered">[notice]x[/notice]</div>', ShortcodePreview::render($grav, '[notice]x[/notice]'));
    same(['onShortcodeHandlers'], $grav->fired, 'handlers registered when none are');
    $manager->names = ['notice'];
    $grav->fired = [];
    ShortcodePreview::render($grav, '[notice]x[/notice]');
    same([], $grav->fired, 'not re-registered');
    same('<pre class="visual-editor-source-preview">&lt;b&gt;</pre>', ShortcodePreview::escaped('<b>'));
});

// --- Preview controller --------------------------------------------------------------------------

/**
 * Loads PreviewController against a given API base class: the real class extends
 * AbstractApiController; a copy extending PageAwareApiController stands for API versions that have
 * authorizePageAction(), so both code paths run.
 */
function previewController(bool $pageAware)
{
    static $loaded = [];
    $base = $pageAware ? 'PageAwareApiController' : 'AbstractApiController';
    $class = 'Grav\\Plugin\\VisualEditor\\PreviewController' . ($pageAware ? 'PageAware' : '');
    if (!isset($loaded[$class])) {
        $code = file_get_contents(__DIR__ . '/../../classes/PreviewController.php');
        $code = str_replace(['<?php', 'declare(strict_types=1);'], '', $code);
        if ($pageAware) {
            $code = str_replace(['class PreviewController extends AbstractApiController', 'use Grav\\Plugin\\Api\\Controllers\\AbstractApiController;'],
                ['class PreviewControllerPageAware extends PageAwareApiController', 'use Grav\\Plugin\\Api\\Controllers\\PageAwareApiController;'], $code);
        }
        eval($code);
        $loaded[$class] = true;
    }
    return new $class(new Grav(['shortcode' => new ShortcodeManager()]), new Config());
}

test('preview: renders, and validates its input', function () {
    $controller = previewController(false);
    same('<div class="rendered">[notice]x[/notice]</div>', $controller->preview(new VeTest\Request(['source' => '[notice]x[/notice]']))->data['html']);
    foreach ([[], ['source' => ''], ['source' => ['x']], ['source' => str_repeat('x', 200001)]] as $body) {
        try {
            $controller->preview(new VeTest\Request($body));
            throw new RuntimeException('accepted ' . json_encode(array_map(fn($v) => is_string($v) ? strlen($v) : $v, $body)));
        } catch (\Grav\Plugin\Api\Exceptions\ValidationException $expected) {}
    }
});

test('preview without page-level rules (older API): site-wide write permission', function () {
    $controller = previewController(false);
    $controller->preview(new VeTest\Request(['source' => '[x]', 'route' => '/blog']));
    same(['permission:api.pages.write'], $controller->calls);
});

test('preview checks the edited page (update) when the API has page-level rules', function () {
    $controller = previewController(true);
    $controller->pages['/blog'] = (object)['route' => '/blog'];
    $controller->preview(new VeTest\Request(['source' => '[x]', 'route' => '/blog']));
    same(['page:/blog:update:api.pages.write'], $controller->calls);

    $controller->calls = [];
    $controller->deny = ['/blog'];
    try {
        $controller->preview(new VeTest\Request(['source' => '[x]', 'route' => '/blog']));
        throw new RuntimeException('a page the user may not update was previewed');
    } catch (\Grav\Plugin\Api\Exceptions\ForbiddenException $expected) {}

    $controller->calls = [];
    $controller->preview(new VeTest\Request(['source' => '[x]']));
    same(['permission:api.pages.write'], $controller->calls, 'no route: site-wide permission');
});

// --- Runner ------------------------------------------------------------------------------------------

foreach ($tests as $name => $body) {
    try {
        $body();
        echo "ok - $name\n";
    } catch (Throwable $error) {
        $failures++;
        echo "not ok - $name\n  " . $error->getMessage() . "\n";
    }
}
echo '# php tests ' . count($tests) . ', failures ' . $failures . "\n";
exit($failures ? 1 : 0);
