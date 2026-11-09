/**
 * Admin2 custom field: `user/plugins/visual-editor/admin-next/fields/visual-editor.js`.
 *
 * Admin2 discovers the file, imports it as an ES module with `window.__GRAV_FIELD_TAG`
 * set (`grav-visual-editor--visual-editor`), then mounts the element for the page
 * `content` field when it is the site default (blueprint rewrite in visual-editor.php)
 * or the user's preferred content editor. Contract (CustomFieldWrapper.svelte):
 * Admin2 sets `field` and `value`; the element reports edits with a `change`
 * CustomEvent dispatched on itself whose `detail` is the Markdown string. Admin2
 * echoes every reported value back through the `value` setter.
 */
import { VisualEditor } from './editor.js';
import { contrastText } from './markdown.js';

/** Page frontmatter field (added next to the editor by visual-editor.php) previewed as the editing surface color. */
const PAGE_BACKGROUND = 'header.background_color';
const safeCssColor = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%\/deg]+\))$/i;

/* global __VE_CSS__ */
const STYLE_ID = 'grav-visual-editor-styles';
const css = typeof __VE_CSS__ === 'string' ? __VE_CSS__ : '';

function injectStyles() {
  if (!css || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  if (window.__GRAV_CSP_NONCE__) style.nonce = window.__GRAV_CSP_NONCE__;
  style.textContent = css;
  document.head.append(style);
}

const adminIsDark = () => document.documentElement.classList.contains('dark');

/** Page media from Admin2's live snapshot, as the editor's `{ name, path, url, thumb, alt }`. */
function pageMedia() {
  const items = typeof window.__GRAV_PAGE_MEDIA === 'function' ? window.__GRAV_PAGE_MEDIA() : [];
  return (items || [])
    .filter((item) => /^image\//.test(item.type || '') || /\.(?:jpe?g|png|gif|webp|svg|avif)$/i.test(item.filename || ''))
    .map((item) => ({ name: item.filename, path: item.filename, url: item.url, thumb: item.thumb, alt: item.alt || '' }));
}

/**
 * file name → display URL, built once per synchronous render: resolving every image of a page used to
 * rebuild the whole media list per image. Dropped after the current task, so later uploads are seen.
 */
let mediaUrls = null;
function pageMediaUrl(name) {
  if (!mediaUrls) {
    mediaUrls = new Map(pageMedia().map((item) => [item.name, item.url]));
    queueMicrotask(() => { mediaUrls = null; });
  }
  return mediaUrls.get(name) || '';
}

function apiUrl(path) {
  const server = window.__GRAV_API_SERVER_URL || '';
  const prefix = window.__GRAV_API_PREFIX || '/api/v1';
  return `${server}${prefix}${path}`;
}

async function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  // Admin2 uses X-API-Token because FastCGI setups strip the Authorization header.
  if (window.__GRAV_API_TOKEN) headers['X-API-Token'] = window.__GRAV_API_TOKEN;
  if (window.__GRAV_ENVIRONMENT) headers['X-Grav-Environment'] = window.__GRAV_ENVIRONMENT;
  const response = await fetch(apiUrl(path), { method: 'POST', headers, body: JSON.stringify(body), credentials: 'same-origin' });
  let json = null;
  try { json = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !json) throw new Error(json?.detail || json?.message || json?.error?.message || `Request failed (${response.status}).`);
  return json.data ?? json;
}

export class VisualEditorField extends HTMLElement {
  /**
   * Admin2 treats every `change` from a custom field as a commit (undo entry with two full copies of
   * the page, and an auto-save after 500 ms). Report edits once typing pauses instead of per keystroke;
   * pending edits are flushed on blur, Ctrl/Cmd+S, `grav:editor:save` and removal, so none is lost.
   * 0 reports at once.
   */
  static changeDelay = 400;

  constructor() {
    super();
    this._field = null;
    this._value = '';
    this.editor = null;
    this.uploaded = new Map();
    // Admin2 calls formChanged() when a watched form value changes (CustomFieldWrapper.svelte).
    this.watch = [PAGE_BACKGROUND];
  }

  formChanged() { this.applyPageBackground(); }

  /** Preview the page background color on the editing surface, with readable text. */
  applyPageBackground() {
    const wrap = this.editor?.editorWrap;
    if (!wrap) return;
    const raw = typeof this.getValue === 'function' ? this.getValue(PAGE_BACKGROUND) : null;
    const color = typeof raw === 'string' && safeCssColor.test(raw.trim()) ? raw.trim() : '';
    wrap.style.background = color;
    if (color) {
      const text = contrastText(color);
      wrap.style.setProperty('--ve-text', text);
      wrap.style.setProperty('--ve-muted', text === '#ffffff' ? 'rgba(255,255,255,.72)' : 'rgba(31,35,41,.68)');
    } else {
      wrap.style.removeProperty('--ve-text');
      wrap.style.removeProperty('--ve-muted');
    }
  }

  set field(field) { this._field = field || null; }
  get field() { return this._field; }

  set value(value) {
    this._value = typeof value === 'string' ? value : value == null ? '' : String(value);
    this.editor?.setMarkdown(this._value);
  }
  get value() { return this.editor ? this.editor.getMarkdown() : this._value; }

  connectedCallback() {
    if (this.editor) return;
    injectStyles();
    const options = this._field?.visual_editor || {};
    const config = {
      ...options,
      theme: !options.theme || options.theme === 'auto' ? (adminIsDark() ? 'dark' : 'light') : options.theme,
      resolveMediaUrl: (src) => this.resolveMedia(src),
    };
    const readonly = Boolean(this._field?.readonly || this._field?.disabled);
    this.editor = new VisualEditor(this, {
      markdown: this._value,
      config,
      services: this.services(),
      onChange: (markdown) => {
        this._value = markdown;
        this.scheduleChange();
      },
    });
    if (readonly) this.editor.editor.setEditable(false);
    this.applyPageBackground();
    // Report pending edits before anything can read or save the page.
    this.onFocusOut = (event) => { if (!this.contains(event.relatedTarget)) this.flushChange(); };
    this.onSaveKey = (event) => { if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 's') this.flushChange(); };
    this.onSaveEvent = () => this.flushChange();
    this.addEventListener('focusout', this.onFocusOut);
    // Capture on window: runs before Admin2's own save shortcut and `grav:editor:save` listeners.
    window.addEventListener('keydown', this.onSaveKey, true);
    window.addEventListener('grav:editor:save', this.onSaveEvent, true);
    // Admin2's media panel "insert" button asks the active editor to insert at the cursor.
    this.onInsert = (event) => {
      if (!this.isConnected || event.detail?.mode !== 'insert-at-cursor' || typeof event.detail.content !== 'string') return;
      this.editor.insertMarkdown(event.detail.content);
    };
    window.addEventListener('grav:editor:insert-content', this.onInsert);
    // The page media snapshot may arrive after the first render: re-resolve image URLs then.
    this.onInvalidate = () => this.refreshImages();
    window.addEventListener('grav:invalidate', this.onInvalidate);
    [300, 1500, 4000].forEach((delay) => window.setTimeout(() => this.refreshImages(), delay));
    if (!options.theme || options.theme === 'auto') {
      this.themeObserver = new MutationObserver(() => { this.editor.root.dataset.theme = adminIsDark() ? 'dark' : 'light'; });
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
  }

  disconnectedCallback() {
    this.flushChange();
    this.removeEventListener('focusout', this.onFocusOut);
    window.removeEventListener('keydown', this.onSaveKey, true);
    window.removeEventListener('grav:editor:save', this.onSaveEvent, true);
    this.themeObserver?.disconnect();
    window.removeEventListener('grav:editor:insert-content', this.onInsert);
    window.removeEventListener('grav:invalidate', this.onInvalidate);
    this.editor?.destroy();
    this.editor = null;
  }

  scheduleChange() {
    this.changePending = true;
    window.clearTimeout(this.changeTimer);
    const delay = VisualEditorField.changeDelay;
    if (delay > 0) this.changeTimer = window.setTimeout(() => this.flushChange(), delay);
    else this.flushChange();
  }

  /** Report the pending edit (if any) to Admin2 now. */
  flushChange() {
    window.clearTimeout(this.changeTimer);
    if (!this.changePending) return;
    this.changePending = false;
    this.dispatchEvent(new CustomEvent('change', { detail: this._value }));
  }

  /** Page-relative image paths are shown through Admin2's media URLs; Markdown keeps the bare path. */
  resolveMedia(src) {
    const name = decodeURIComponent(String(src).split(/[?#]/)[0]);
    if (this.uploaded.has(name)) return this.uploaded.get(name);
    return pageMediaUrl(name);
  }

  refreshImages() {
    this.editor?.root.querySelectorAll('img[data-markdown-src]').forEach((image) => {
      const source = image.getAttribute('data-markdown-src');
      const resolved = source && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(source) ? this.resolveMedia(source) : '';
      if (resolved && image.getAttribute('src') !== resolved) image.setAttribute('src', resolved);
    });
  }

  services() {
    return {
      listMedia: async () => pageMedia(),
      upload: typeof window.__GRAV_UPLOAD_PAGE_MEDIA === 'function'
        ? async (file) => {
          const [image] = await window.__GRAV_UPLOAD_PAGE_MEDIA([file]);
          if (!image) return null; // Admin2 already reported the failure in a toast.
          if (image.url) this.uploaded.set(image.filename, image.url);
          return { name: image.filename, path: image.filename, url: image.url, alt: image.alt };
        }
        : null,
      pickSiteMedia: typeof window.__GRAV_MEDIA_PICKER === 'function' ? () => window.__GRAV_MEDIA_PICKER() : null,
      preview: async (source) => {
        const data = await apiPost('/visual-editor/preview', { source, route: window.__GRAV_PAGE_ROUTE || '' });
        return data.html || '';
      },
    };
  }
}

const tag = window.__GRAV_FIELD_TAG || 'grav-visual-editor--visual-editor';
if (!customElements.get(tag)) customElements.define(tag, VisualEditorField);
