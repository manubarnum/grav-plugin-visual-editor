import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Mimic Admin2's page editor: globals set by the SPA, then the field module imported with its tag.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://grav.example/admin2/pages/edit/blog/post', pretendToBeVisual: true });
const { window } = dom;
for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'CustomEvent', 'Event', 'customElements', 'DragEvent', 'ClipboardEvent', 'FormData', 'MouseEvent']) {
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

test('More formatting applies every inline HTML format, including the chained abbreviation dialog', () => {
  const expected = { highlight: '<mark>world</mark>', keyboard: '<kbd>world</kbd>', citation: '<cite>world</cite>', subscript: '<sub>world</sub>', superscript: '<sup>world</sup>', abbreviation: '<abbr title="Expanded">world</abbr>' };
  for (const [format, html] of Object.entries(expected)) {
    const { el, changes } = mount('Hello world\n');
    const editor = el.editor;
    editor.editor.commands.setTextSelection({ from: 7, to: 12 });
    editor.more();
    editor.dialogElement.querySelector('select[name="format"]').value = format;
    editor.dialogElement.querySelector('button[type="submit"]').click();
    if (format === 'abbreviation') {
      assert.ok(editor.dialogElement, 'the abbreviation dialog stays open');
      editor.dialogElement.querySelector('input[name="title"]').value = 'Expanded';
      editor.dialogElement.querySelector('button[type="submit"]').click();
    }
    assert.equal(changes.at(-1), `Hello ${html}\n`, format);
    el.remove();
  }
});

test('resizing an image: presets, original size, custom width, details and the drag handle', () => {
  const { el, changes } = mount('![A photo](photo.jpg)\n\nText\n');
  const editor = el.editor;
  const wrapper = el.querySelector('.ProseMirror .ve-image');
  const image = wrapper.querySelector('img');
  assert.ok(wrapper.querySelector('.ve-image-resize'), 'resize handle');
  assert.equal(image.getAttribute('src'), 'https://grav.example/user/pages/blog/post/photo.jpg');
  Object.defineProperty(image, 'naturalWidth', { value: 2000, configurable: true });

  editor.editor.commands.setNodeSelection(0);
  assert.equal(editor.imageBar.hidden, false, 'image bar shows for a selected image');
  editor.imageBar.querySelector('[data-action="width-640"]').click();
  assert.equal(changes.at(-1), '![A photo](photo.jpg?cropResize=640)\n\nText\n');
  assert.equal(el.querySelector('.ProseMirror .ve-image img').style.width, '640px');
  assert.equal(editor.imageSize.textContent, 'Shown at 640 px');

  editor.imageBar.querySelector('[data-action="width-custom"]').click();
  editor.dialogElement.querySelector('input[name="width"]').value = '500';
  editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.match(changes.at(-1), /photo\.jpg\?cropResize=500\)/);

  editor.imageBar.querySelector('[data-action="image-details"]').click();
  editor.dialogElement.querySelector('input[name="alt"]').value = 'Roses';
  editor.dialogElement.querySelector('input[name="title"]').value = 'Race';
  editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.match(changes.at(-1), /^!\[Roses\]\(photo\.jpg\?cropResize=500 "Race"\)/);

  editor.imageBar.querySelector('[data-action="width-original"]').click();
  assert.match(changes.at(-1), /^!\[Roses\]\(photo\.jpg "Race"\)/);

  // Drag the corner handle 200px to the left from a 900px display width.
  const shown = el.querySelector('.ProseMirror .ve-image img');
  Object.defineProperty(shown, 'naturalWidth', { value: 2000, configurable: true });
  shown.getBoundingClientRect = () => ({ width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600 });
  const handle = el.querySelector('.ProseMirror .ve-image-resize');
  const pointer = (type, x) => { const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }); return event; };
  handle.dispatchEvent(pointer('pointerdown', 900));
  window.dispatchEvent(pointer('pointermove', 700));
  window.dispatchEvent(pointer('pointerup', 700));
  assert.match(changes.at(-1), /photo\.jpg\?cropResize=700 "Race"\)/);

  editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 1);
  assert.equal(editor.imageBar.hidden, true, 'image bar hides when the image is not selected');
  el.remove();
});

test('colored block: wrap the selection, change its color, remove it', () => {
  const { el, changes } = mount('First paragraph\n\nSecond\n');
  const editor = el.editor;
  const submit = () => editor.dialogElement.querySelector('button[type="submit"]').click();
  editor.editor.commands.setTextSelection(3);

  editor.command('colorBlock');
  assert.equal(editor.dialogElement.querySelector('select[name="preset"]').value, '#fde2e4');
  submit();
  assert.match(changes.at(-1), /^\[div class="ve-block" style="background-color:#fde2e4;color:#1f2329;[^"]*"\]\n\nFirst paragraph\n\n\[\/div\]\n\nSecond\n$/);
  const block = el.querySelector('.ProseMirror .ve-color-block');
  assert.ok(block, 'rendered as a colored block');
  assert.match(block.getAttribute('style'), /background-color:\s*(?:#fde2e4|rgb\(253, 226, 228\))/);
  assert.equal(editor.toolbar.querySelector('[data-action="colorBlock"]').getAttribute('aria-pressed'), 'true');

  editor.command('colorBlock');
  editor.dialogElement.querySelector('select[name="preset"]').value = 'custom';
  editor.dialogElement.querySelector('input[name="custom"]').value = '#1d3557';
  submit();
  assert.match(changes.at(-1), /background-color:#1d3557;color:#ffffff;/, 'dark background gets white text');

  editor.command('colorBlock');
  editor.dialogElement.querySelector('[data-action="remove"]').click();
  assert.equal(changes.at(-1), 'First paragraph\n\nSecond\n');
  el.remove();
});

test('the editing surface previews the page background color from the form', () => {
  const form = { 'header.background_color': '#1d3557' };
  const el = document.createElement(tag);
  el.field = { name: 'content', visual_editor: {} };
  el.getValue = (path) => form[path];
  el.value = 'Text\n';
  document.body.append(el);
  assert.deepEqual(el.watch, ['header.background_color']);
  const wrap = el.editor.editorWrap;
  assert.match(wrap.style.background, /rgb\(29, 53, 87\)|#1d3557/);
  assert.equal(wrap.style.getPropertyValue('--ve-text'), '#ffffff');
  form['header.background_color'] = '#fde2e4';
  el.formChanged();
  assert.equal(wrap.style.getPropertyValue('--ve-text'), '#1f2329');
  form['header.background_color'] = 'red;} body {';
  el.formChanged();
  assert.equal(wrap.style.background, '', 'unsafe values are ignored');
  el.remove();
});

test('alignment buttons wrap, change and remove [center]/[right] blocks', () => {
  const { el, changes } = mount('First\n\nSecond\n');
  const editor = el.editor;
  const pressed = (name) => editor.toolbar.querySelector(`[data-action="${name}"]`).getAttribute('aria-pressed');
  editor.editor.commands.setTextSelection(2);
  assert.equal(pressed('alignLeft'), 'true');

  editor.command('alignCenter');
  assert.equal(changes.at(-1), '[center]\n\nFirst\n\n[/center]\n\nSecond\n');
  assert.equal(el.querySelector('.ProseMirror .ve-align-block').getAttribute('data-align'), 'center');
  assert.equal(pressed('alignCenter'), 'true');

  editor.command('alignRight');
  assert.equal(changes.at(-1), '[right]\n\nFirst\n\n[/right]\n\nSecond\n');

  editor.command('alignLeft');
  assert.equal(changes.at(-1), 'First\n\nSecond\n');
  el.remove();
});

test('aligning inside a list wraps the whole list (shortcode tags must start their line)', () => {
  const { el, changes } = mount('- one\n- two\n');
  el.editor.editor.commands.setTextSelection(3);
  el.editor.command('alignCenter');
  assert.equal(changes.at(-1), '[center]\n\n- one\n- two\n\n[/center]\n');
  el.remove();
});

test('alignment buttons align the column inside a table', () => {
  const { el, changes } = mount('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  el.editor.editor.commands.setTextSelection(4);
  el.editor.command('alignRight');
  assert.match(changes.at(-1), /^\| A \| B \|\n\| ---: \| --- \|/);
  assert.doesNotMatch(changes.at(-1), /\[right\]/);
  el.remove();
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
