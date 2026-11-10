import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The shipped module on a site without collaborative editing: Admin2 publishes no window.__GRAV_YJS__
// and passes no fragment. The Yjs relays must never be touched (own process: nothing bound them).
const bundle = new URL('../admin-next/fields/visual-editor.js', import.meta.url);

test('the built field works without collaboration and without Admin2\'s Yjs', { skip: !existsSync(bundle) && 'run npm run build first' }, async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://grav.example/admin2/pages/edit/x', pretendToBeVisual: true });
  const { window } = dom;
  for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'CustomEvent', 'Event', 'customElements', 'FormData']) {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (callback) => callback();
  // jsdom has no layout: ProseMirror's scroll-into-view needs these to exist.
  for (const proto of [window.Element.prototype, window.Range.prototype]) {
    proto.getClientRects ??= () => [];
    proto.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 });
  }
  window.__GRAV_FIELD_TAG = 'grav-visual-editor--visual-editor';
  assert.equal(window.__GRAV_YJS__, undefined);
  const { VisualEditorField } = await import(bundle.href);
  VisualEditorField.changeDelay = 0;
  const el = document.createElement(window.__GRAV_FIELD_TAG);
  const changes = [];
  el.addEventListener('change', (event) => changes.push(event.detail));
  el.field = { name: 'content', visual_editor: {} };
  el.value = '# Hi\n';
  document.body.append(el);
  assert.equal(el.querySelector('.ProseMirror h1').textContent, 'Hi');
  // The module carries every style the editor needs, alert styles included (no separate stylesheet in Admin2).
  const css = document.getElementById('grav-visual-editor-styles')?.textContent || '';
  assert.match(css, /\.ve-alert\{/);
  assert.match(css, /\.ve-alert-warning\{/);
  assert.match(css, /\[data-theme=dark\] \.ve-alert/);
  const tiptap = el.editor.editor;
  tiptap.commands.setTextSelection(3);
  tiptap.commands.insertContent('!');
  assert.equal(changes.at(-1), '# Hi!\n');
  el.editor.toolbar.querySelector('[data-action="undo"]').click();
  assert.equal(el.editor.getMarkdown(), '# Hi\n', 'TipTap history undo');
  el.remove();
});
