import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as Y from 'yjs';
import * as awareness from 'y-protocols/awareness';

// The shipped bundle carries no copy of Yjs: `yjs` and `y-protocols/awareness` are relays bound to
// Admin2's window.__GRAV_YJS__ when collaboration starts (build.mjs). This test loads the built module
// the way Admin2 does and checks that two peers edit the same document through Admin2's Yjs.
const bundle = new URL('../admin-next/fields/visual-editor.js', import.meta.url);

test('the built field collaborates through Admin2\'s shared Yjs instance', { skip: !existsSync(bundle) && 'run npm run build first' }, async () => {
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
  window.__GRAV_YJS__ = { yjs: Y, Y, awareness, Awareness: awareness.Awareness }; // what Admin2 publishes

  const { VisualEditorField } = await import(bundle.href);
  VisualEditorField.changeDelay = 0;

  const docs = [new Y.Doc(), new Y.Doc()];
  docs[0].on('update', (update, origin) => { if (origin !== 'peer') Y.applyUpdate(docs[1], update, 'peer'); });
  docs[1].on('update', (update, origin) => { if (origin !== 'peer') Y.applyUpdate(docs[0], update, 'peer'); });
  const peers = docs.map((doc) => ({ fragment: doc.getXmlFragment('content'), awareness: new awareness.Awareness(doc) }));
  try {
    const mount = (value, peer) => {
      const el = document.createElement(window.__GRAV_FIELD_TAG);
      el.yFragment = peer.fragment;
      el.yAwareness = peer.awareness;
      el.yUser = { name: 'Editor', color: '#3d7eff' };
      el.field = { name: 'content', visual_editor: {} };
      el.value = value;
      document.body.append(el);
      return el;
    };
    const a = mount('Hello\n', peers[0]);
    const b = mount('stale\n', peers[1]);
    assert.equal(b.editor.getMarkdown(), 'Hello\n', 'second peer joins the shared document');
    const tiptap = a.editor.editor;
    tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
    tiptap.commands.insertContent(' world');
    assert.equal(b.querySelector('.ProseMirror p').textContent, 'Hello world');
    a.remove();
    b.remove();
  } finally {
    peers.forEach((peer) => peer.awareness.destroy());
    docs.forEach((doc) => doc.destroy());
  }
});
