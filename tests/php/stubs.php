<?php
/**
 * Minimal stand-ins for the Grav, RocketTheme and shortcode-core classes the plugin touches, so its PHP
 * logic runs without a Grav install. Only what visual-editor.php and classes/ actually call is modelled.
 */

namespace Grav\Common {
    class Plugin
    {
        public $grav;
        public $config;
        public bool $admin = false;

        public function __construct($grav, $config)
        {
            $this->grav = $grav;
            $this->config = $config;
        }

        protected function isAdmin()
        {
            return $this->admin;
        }
    }

    /** Container: array access to services plus fireEvent(), like Grav\Common\Grav. */
    class Grav extends \ArrayObject
    {
        public array $fired = [];

        public function fireEvent($name, $event = null)
        {
            $this->fired[] = $name;
            if (isset($this['listeners'][$name])) {
                ($this['listeners'][$name])($event);
            }

            return $event;
        }
    }
}

namespace RocketTheme\Toolbox\Event {
    class Event implements \ArrayAccess
    {
        public array $items;

        public function __construct(array $items = [])
        {
            $this->items = $items;
        }

        public function offsetExists($offset): bool { return isset($this->items[$offset]); }
        public function offsetGet($offset): mixed { return $this->items[$offset]; }
        public function offsetSet($offset, $value): void { $this->items[$offset] = $value; }
        public function offsetUnset($offset): void { unset($this->items[$offset]); }
    }
}

namespace VeTest {
    class Config
    {
        public function __construct(public array $values = []) {}
        public function get($key, $default = null) { return array_key_exists($key, $this->values) ? $this->values[$key] : $default; }
    }

    class User
    {
        public function __construct(public string $contentEditor = '') {}
        public function get($key, $default = null) { return $key === 'content_editor' ? $this->contentEditor : $default; }
    }

    class Assets
    {
        public array $css = [];
        public function addInlineCss($css, $options = []) { $this->css[] = $css; }
    }

    class Page
    {
        public object $header;
        public string $raw;

        public function __construct(array $header = [], string $raw = '')
        {
            $this->header = (object)$header;
            $this->raw = $raw;
        }

        public function header() { return $this->header; }
        public function rawMarkdown() { return $this->raw; }
        public function getRawContent() { return $this->raw; }
        public function setRawContent($content) { $this->raw = $content; }
    }

    class Routes
    {
        public array $post = [];
        public function post($route, $handler) { $this->post[$route] = $handler; return $this; }
    }

    /** shortcode-core's ShortcodeManager surface used by ShortcodePreview. */
    class ShortcodeManager
    {
        public array $names = [];
        public function getHandlers() { return $this; }
        public function getNames() { return $this->names; }
        public function processShortcodes($source) { return '<div class="rendered">' . $source . '</div>'; }
    }
}

namespace Psr\Http\Message {
    interface ServerRequestInterface {}
    interface ResponseInterface {}
}

namespace Grav\Plugin\Api\Exceptions {
    class ValidationException extends \RuntimeException {}
    class ForbiddenException extends \RuntimeException {}
}

namespace Grav\Plugin\Api\Response {
    class ApiResponse implements \Psr\Http\Message\ResponseInterface
    {
        public function __construct(public $data) {}
        public static function create($data) { return new self($data); }
    }
}

namespace Grav\Plugin\Api\Controllers {
    /**
     * The API plugin's controller base, reduced to what PreviewController uses. `calls` records the
     * permission checks; `deny` makes a check (permission or page action) throw like the real API.
     */
    abstract class AbstractApiController
    {
        public array $calls = [];
        public array $deny = [];
        public array $pages = [];

        public function __construct(protected $grav, protected $config) {}

        protected function requirePermission($request, string $permission): void
        {
            $this->calls[] = "permission:$permission";
            if (in_array($permission, $this->deny, true)) { throw new \Grav\Plugin\Api\Exceptions\ForbiddenException($permission); }
        }

        protected function getRequestBody($request): array { return $request->body; }

        protected function resolvePageByRoute(string $route) { return $this->pages[$route] ?? null; }
    }

    /** API versions with page-level rules (authorizePageAction). */
    abstract class PageAwareApiController extends AbstractApiController
    {
        protected function authorizePageAction($request, ?object $page, string $action, string $permission): void
        {
            $this->calls[] = 'page:' . ($page ? $page->route : 'none') . ":$action:$permission";
            if (in_array($page ? $page->route : 'none', $this->deny, true)) { throw new \Grav\Plugin\Api\Exceptions\ForbiddenException('page'); }
        }
    }
}

namespace VeTest {
    class Request implements \Psr\Http\Message\ServerRequestInterface
    {
        public function __construct(public array $body = []) {}
    }
}
