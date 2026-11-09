import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Mimic Admin2's page editor: globals set by the SPA, then the field module imported with its tag.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://grav.example/admin2/pages/edit/blog/post', pretendToBeVisual: true });
const { window } = dom;
for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'CustomEvent', 'Event', 'customElements', 'DragEvent', 'ClipboardEvent', 'FormData']) {
  if (window[name] !== undefined) Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
}
// Node 21+ defines a getter-only navigator; replace it with jsdom's.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
globalThis.requestAnimationFrame = (callback) => callback();
window.requestAnimationFrame = globalThis.requestAnimationFrame;
// jsdom has no layout: ProseMirror's scroll-into-view needs these to exist.
const noRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
for (const proto of [window.Element.prototype, window.Range.prototype]) {
  proto.getClientRects ??= () => [];
  proto.getBoundingClientRect ??= () => noRect;
}
window.__GRAV_FIELD_TAG = 'grav-visual-editor--visual-editor';
window.__GRAV_API_SERVER_URL = 'https://grav.example';
window.__GRAV_API_PREFIX = '/api/v1';
window.__GRAV_API_TOKEN = 'token-123';
window.__GRAV_PAGE_ROUTE = '/blog/post';
window.__GRAV_PAGE_MEDIA = () => [
  { filename: 'photo.jpg', type: 'image/jpeg', url: 'https://grav.example/user/pages/blog/post/photo.jpg', thumb: 'https://grav.example/t/photo.jpg', alt: 'Photo', title: '' },
  { filename: 'notes.pdf', type: 'application/pdf', url: 'https://grav.example/notes.pdf', thumb: undefined, alt: '', title: '' },
];

await import('../src/admin2-field.js');
const tag = window.__GRAV_FIELD_TAG;

/** Mount the element the way CustomFieldWrapper.svelte does and record its change events. */
function mount(value, field = { name: 'content', type: 'visual-editor', visual_editor: { smartTypography: false } }) {
  const el = document.createElement(tag);
  const changes = [];
  el.field = field;
  el.value = value;
  el.addEventListener('change', (event) => { if (event.target === el) changes.push(event.detail); });
  document.body.append(el);
  return { el, changes };
}

test('the module registers the Admin2 field tag', () => {
  assert.ok(customElements.get(tag));
});

test('mounting renders the editor without reporting a change', () => {
  const { el, changes } = mount('# Title\n\nSome **bold** text.\n');
  assert.ok(el.querySelector('.ve-editor .ProseMirror'));
  assert.equal(el.querySelector('.ProseMirror h1').textContent, 'Title');
  assert.deepEqual(changes, []);
  assert.ok(document.getElementById('grav-visual-editor-styles') === null || document.getElementById('grav-visual-editor-styles'));
  el.remove();
});

test('edits are reported as Markdown and the echoed value does not reset the document', () => {
  const { el, changes } = mount('Hello\n');
  const tiptap = el.editor.editor;
  tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
  tiptap.commands.insertContent(' world');
  assert.equal(changes.at(-1), 'Hello world\n');
  const docBefore = tiptap.state.doc;
  el.value = changes.at(-1); // Admin2 echoes the reported value back
  assert.equal(tiptap.state.doc, docBefore, 'echo must be a no-op');
  el.remove();
});

test('an outside value change replaces the content silently', () => {
  const { el, changes } = mount('First\n');
  el.value = '## Second\n';
  assert.equal(el.querySelector('.ProseMirror h2').textContent, 'Second');
  assert.equal(el.value, '## Second\n');
  assert.deepEqual(changes, []);
  el.remove();
});

test('page images display through Admin2 media URLs while Markdown keeps the file name', () => {
  const { el, changes } = mount('![A photo](photo.jpg)\n');
  const image = el.querySelector('.ProseMirror img');
  assert.equal(image.getAttribute('src'), 'https://grav.example/user/pages/blog/post/photo.jpg');
  assert.equal(image.getAttribute('data-markdown-src'), 'photo.jpg');
  const tiptap = el.editor.editor;
  tiptap.commands.setTextSelection(tiptap.state.doc.content.size);
  tiptap.commands.insertContent('<p>After</p>');
  assert.match(changes.at(-1), /!\[A photo\]\(photo\.jpg\)/);
  el.remove();
});

test('the media panel insert event adds Markdown at the cursor', () => {
  const { el, changes } = mount('Intro\n');
  el.editor.editor.commands.setTextSelection(el.editor.editor.state.doc.content.size - 1);
  window.dispatchEvent(new CustomEvent('grav:editor:insert-content', { detail: { content: '![](photo.jpg)', mode: 'insert-at-cursor' } }));
  assert.match(changes.at(-1), /photo\.jpg/);
  el.remove();
});

/** Minimal DataTransfer stand-in (jsdom has none). */
function transfer(data, files = []) {
  return { files, getData: (type) => data[type] || '' };
}

test('dragging a thumbnail from the Admin2 media panel inserts an image, not escaped text', () => {
  const { el, changes } = mount('Intro\n');
  const event = new window.Event('drop', { cancelable: true });
  event.dataTransfer = transfer({ 'text/plain': '![Foulees Roses](Foulees-Roses_2026_02-980x450.jpg)', 'application/x-grav-media': '{"filename":"x"}' });
  assert.equal(el.editor.dropFiles(event, false), true);
  assert.ok(event.defaultPrevented);
  assert.match(changes.at(-1), /!\[Foulees Roses\]\(Foulees-Roses_2026_02-980x450\.jpg\)/);
  assert.doesNotMatch(changes.at(-1), /\\\[|\\_/);
  el.remove();
});

test('pasting a lone Markdown image becomes an image; ordinary text is left to the editor', () => {
  const { el, changes } = mount('Intro\n');
  const image = new window.Event('paste', { cancelable: true });
  image.clipboardData = transfer({ 'text/plain': '![](photo.jpg)' });
  assert.equal(el.editor.pasteFiles(image), true);
  assert.match(changes.at(-1), /!\[\]\(photo\.jpg\)/);
  const prose = new window.Event('paste', { cancelable: true });
  prose.clipboardData = transfer({ 'text/plain': 'Just [some] words' });
  assert.equal(el.editor.pasteFiles(prose), false);
  el.remove();
});

test('dialog Apply buttons run their action (link, heading, table)', () => {
  const { el, changes } = mount('Hello world\n');
  const editor = el.editor;
  const tiptap = editor.editor;
  const apply = () => editor.dialogElement.querySelector('button[type="submit"]').click();

  tiptap.commands.setTextSelection({ from: 1, to: 6 });
  editor.link();
  editor.dialogElement.querySelector('input[name="href"]').value = 'https://getgrav.org';
  apply();
  assert.equal(editor.dialogElement, null, 'dialog closes after Apply');
  assert.match(changes.at(-1), /\[Hello\]\(https:\/\/getgrav\.org\)/);

  editor.heading();
  editor.dialogElement.querySelector('select[name="style"]').value = '2';
  apply();
  assert.match(changes.at(-1), /^## /m);

  tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
  editor.tableDialog();
  apply();
  assert.match(changes.at(-1), /\| --- \|/);
  el.remove();
});

test('submitting a dialog does not bubble to the Admin2 page form', () => {
  const pageForm = document.createElement('form');
  let pageSubmits = 0;
  pageForm.addEventListener('submit', (event) => { pageSubmits += 1; event.preventDefault(); });
  document.body.append(pageForm);
  const el = document.createElement(tag);
  el.field = { name: 'content', visual_editor: {} };
  el.value = 'Text\n';
  pageForm.append(el);
  el.editor.abbreviation();
  el.editor.dialogElement.querySelector('input[name="title"]').value = 'Expanded';
  el.editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.equal(pageSubmits, 0);
  pageForm.remove();
});

test('list buttons produce Markdown lists', async () => {
  const { el, changes } = mount('One\n');
  await el.editor.command('bulletList');
  assert.equal(changes.at(-1), '- One\n');
  await el.editor.command('orderedList');
  assert.equal(changes.at(-1), '1. One\n');
  el.remove();
});

test('editor styles restore list markers removed by Admin2 (Tailwind preflight)', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../assets/css/editor.css', import.meta.url), 'utf8');
  assert.match(css, /\.ve-content \.ProseMirror ul\{list-style:disc/);
  assert.match(css, /\.ve-content \.ProseMirror ol\{list-style:decimal/);
});

test('media listing keeps images only and maps Admin2 fields', async () => {
  const { el } = mount('x\n');
  const items = await el.services().listMedia();
  assert.deepEqual(items.map((item) => item.name), ['photo.jpg']);
  assert.equal(items[0].path, 'photo.jpg');
  el.remove();
});

test('shortcode preview calls the plugin API route with the Admin2 token', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ data: { html: '<div onclick="x()">Rendered<script>bad()</script></div>', rendered: true } }) };
  };
  const { el } = mount('[notice]Hi[/notice]\n');
  const html = await el.services().preview('[notice]Hi[/notice]');
  assert.equal(calls[0].url, 'https://grav.example/api/v1/visual-editor/preview');
  assert.equal(calls[0].options.headers['X-API-Token'], 'token-123');
  assert.deepEqual(JSON.parse(calls[0].options.body), { source: '[notice]Hi[/notice]', route: '/blog/post' });
  assert.match(html, /Rendered/);
  el.remove();
});

test('preview HTML is sanitized before display', async () => {
  const { sanitizePreview } = await import('../src/extensions.js');
  const holder = document.createElement('div');
  holder.append(sanitizePreview('<p onclick="x()">Ok <a href="javascript:alert(1)">l</a></p><script>bad()</script><iframe src="https://x"></iframe>'));
  assert.equal(holder.innerHTML, '<p>Ok <a>l</a></p>');
});
