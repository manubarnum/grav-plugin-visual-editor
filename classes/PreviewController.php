<?php

declare(strict_types=1);

namespace Grav\Plugin\VisualEditor;

use Grav\Plugin\Api\Controllers\AbstractApiController;
use Grav\Plugin\Api\Exceptions\ValidationException;
use Grav\Plugin\Api\Response\ApiResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/** POST {api}/visual-editor/preview — `{ source }` → `{ html, rendered }`. Registered via onApiRegisterRoutes. */
class PreviewController extends AbstractApiController
{
    private const MAX_SOURCE_BYTES = 200000;

    public function preview(ServerRequestInterface $request): ResponseInterface
    {
        $body = $this->getRequestBody($request);
        $this->authorizePreview($request, is_string($body['route'] ?? null) ? $body['route'] : '');

        $source = $body['source'] ?? null;
        if (!is_string($source) || $source === '') {
            throw new ValidationException('A non-empty "source" string is required.');
        }
        if (strlen($source) > self::MAX_SOURCE_BYTES) {
            throw new ValidationException('The shortcode source is too large to preview.');
        }

        $html = ShortcodePreview::render($this->grav, $source);

        return ApiResponse::create([
            'html' => $html ?? ShortcodePreview::escaped($source),
            'rendered' => $html !== null,
        ]);
    }

    /**
     * Previews are for people editing the page: the same check as updating it. API versions with
     * page-level rules (authorizePageAction) apply the page's own access rules; without a route, or on
     * older API versions, the site-wide write permission is required.
     */
    private function authorizePreview(ServerRequestInterface $request, string $route): void
    {
        if ($route !== '' && method_exists($this, 'authorizePageAction') && method_exists($this, 'resolvePageByRoute')) {
            $this->authorizePageAction($request, $this->resolvePageByRoute($route), 'update', 'api.pages.write');
            return;
        }
        $this->requirePermission($request, 'api.pages.write');
    }
}
