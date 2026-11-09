<?php

namespace Grav\Plugin\VisualEditor;

use Grav\Common\Grav;
use Grav\Common\Page\Interfaces\PageInterface;
use Grav\Common\User\Interfaces\UserInterface;
use Grav\Common\Utils;

/** Authenticated, narrowly scoped Admin operations. All output is JSON. */
class AdminBridge
{
    private $grav;
    private $config;

    public function __construct(Grav $grav, $config)
    {
        $this->grav = $grav;
        $this->config = $config;
    }

    public function handleTask(string $method, $controller): void
    {
        $admin = $this->grav['admin'] ?? null;
        $user = $admin && isset($admin->user) ? $admin->user : ($this->grav['user'] ?? null);
        if (!$user instanceof UserInterface || !$user->authorize('admin.pages')) {
            $this->respond(403, ['status' => 'error', 'message' => 'You do not have permission to edit this page.']);
        }
        if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            $this->respond(405, ['status' => 'error', 'message' => 'POST required.']);
        }
        // Legacy Admin has already checked the session and admin-form nonce. Verify it here
        // as well because this bridge is also usable by Admin's newer router.
        $post = $controller->post ?? ($_POST ?: []);
        $nonce = $post['admin-nonce'] ?? $this->grav['uri']->param('admin-nonce');
        if (!$nonce || !Utils::verifyNonce($nonce, 'admin-form')) {
            $this->respond(403, ['status' => 'error', 'message' => 'Invalid or expired security token. Reload the editor.']);
        }
        try {
            $page = $this->page((string)($post['page_route'] ?? ''));
            if (!$page) {
                $this->respond(404, ['status' => 'error', 'message' => 'The page could not be found. Save it before adding media.']);
            }
            if ($method === 'taskVisualEditorMedia') {
                $this->media($page);
            } elseif ($method === 'taskVisualEditorPreview') {
                $this->preview($post);
            } else {
                $this->upload($page);
            }
        } catch (\InvalidArgumentException $e) {
            $this->respond(422, ['status' => 'error', 'message' => $e->getMessage()]);
        } catch (\RuntimeException $e) {
            $this->respond(500, ['status' => 'error', 'message' => $e->getMessage()]);
        }
    }

    private function page(string $route)
    {
        if ($route === '' || strpos($route, "\0") !== false || strpos($route, '..') !== false || preg_match('/^[a-z]+:/i', $route)) {
            return null;
        }
        $route = '/' . trim($route, '/');
        $pages = $this->grav['admin']->enablePages();
        $page = $pages->find($route);
        return $page instanceof PageInterface ? $page : null;
    }

    private function media(PageInterface $page): void
    {
        $items = [];
        $directory = $page->path();
        foreach (glob($directory . '/*') ?: [] as $path) {
            if (!is_file($path)) { continue; }
            $name = basename($path);
            $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            if (!in_array($extension, ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'], true)) { continue; }
            $items[] = [
                'name' => $name,
                'path' => rawurlencode($name),
                'url' => $this->mediaUrl($page, $name),
                'size' => filesize($path),
                'type' => $extension === 'svg' ? 'image/svg+xml' : 'image/' . ($extension === 'jpg' ? 'jpeg' : $extension),
            ];
        }
        usort($items, static function (array $a, array $b): int { return strnatcasecmp($a['name'], $b['name']); });
        $this->respond(200, ['status' => 'success', 'items' => $items]);
    }

    private function upload(PageInterface $page): void
    {
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new \InvalidArgumentException('Choose an image to upload.');
        }
        $limit = min(10 * 1024 * 1024, max(1, (int)$this->config->get('plugins.visual-editor.max_upload_bytes', 10485760)));
        if (!isset($file['size']) || $file['size'] > $limit || !is_uploaded_file($file['tmp_name'])) {
            throw new \InvalidArgumentException('The image is too large or the upload was not accepted.');
        }
        $original = basename(str_replace('\\', '/', (string)$file['name']));
        $extension = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        $allowed = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'];
        if (!isset($allowed[$extension])) {
            throw new \InvalidArgumentException('Allowed formats: JPEG, PNG, GIF, WebP and SVG.');
        }
        if ($extension !== 'svg' && function_exists('getimagesize') && !@getimagesize($file['tmp_name'])) {
            throw new \InvalidArgumentException('The file is not a valid image.');
        }
        $base = strtolower(pathinfo($original, PATHINFO_FILENAME));
        $base = trim(preg_replace('/[^a-z0-9_-]+/', '-', $base), '-_');
        if ($base === '') { $base = 'image'; }
        $base = substr($base, 0, 80);
        $directory = $page->path();
        if (!is_dir($directory) || !is_writable($directory)) {
            throw new \RuntimeException('The page media folder is not writable.');
        }
        $name = $base . '.' . $extension;
        if (file_exists($directory . '/' . $name)) {
            $name = $base . '-' . bin2hex(random_bytes(4)) . '.' . $extension;
        }
        if (!move_uploaded_file($file['tmp_name'], $directory . '/' . $name)) {
            throw new \RuntimeException('The uploaded image could not be stored.');
        }
        @chmod($directory . '/' . $name, 0644);
        $this->respond(200, ['status' => 'success', 'item' => [
            'name' => $name, 'path' => rawurlencode($name), 'url' => $this->mediaUrl($page, $name),
            'size' => (int)$file['size'], 'type' => $allowed[$extension],
        ]]);
    }

    private function preview(array $post): void
    {
        $source = (string)($post['source'] ?? '');
        if (strlen($source) > 131072) {
            throw new \InvalidArgumentException('The shortcode preview is too large.');
        }
        if (!class_exists('Grav\\Plugin\\ShortcodeCore\\ShortcodeCorePlugin')) {
            $this->respond(200, ['status' => 'unavailable', 'message' => 'Install shortcode-core to execute shortcode previews.']);
        }
        $page = $this->page((string)($post['page_route'] ?? ''));
        $this->grav['page'] = $page;
        $extension = new ShortcodePreviewExtension();
        $html = $extension->processShortcodes($source);
        $this->respond(200, ['status' => 'success', 'html' => $html]);
    }

    private function mediaUrl(PageInterface $page, string $name): string
    {
        return $this->grav['base_url_relative'] . $page->route() . '/' . rawurlencode($name);
    }

    private function respond(int $status, array $data): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES);
        exit;
    }
}
