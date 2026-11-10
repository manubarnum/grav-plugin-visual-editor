import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Mimic Admin2's page editor: globals set by the SPA, then the field module imported with its tag.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://grav.example/admin2/pages/edit/blog/post', pretendToBeVisual: true });
const { window } = dom;
for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'CustomEvent', 'Event', 'customElements', 'DragEvent', 'ClipboardEvent', 'FormData', 'MouseEvent', 'FocusEvent', 'KeyboardEvent']) {
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

const { VisualEditorField } = await import('../src/admin2-field.js');
const tag = window.__GRAV_FIELD_TAG;
// Most tests check what one edit reports: report it at once. The batching tests set their own delay.
VisualEditorField.changeDelay = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Isolation: a test that fails before its own cleanup must not leave an editor (and its window
// listeners), a replaced fetch or a changed delay behind for the next tests.
const mounted = new Set();
const disposers = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  mounted.forEach((el) => el.remove());
  mounted.clear();
  globalThis.fetch = originalFetch;
  VisualEditorField.changeDelay = 0;
});

/** Mount the element the way CustomFieldWrapper.svelte does and record its change events. */
function mount(value, field = { name: 'content', type: 'visual-editor', visual_editor: { smartTypography: false } }) {
  const el = document.createElement(tag);
  mounted.add(el);
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
  mounted.add(el);
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
    editor.dialogElement.querySelector(`[data-action="format-${format}"]`).click();
    if (format === 'abbreviation') {
      assert.ok(editor.dialogElement, 'the abbreviation dialog stays open');
      editor.dialogElement.querySelector('input[name="title"]').value = 'Expanded';
      editor.dialogElement.querySelector('button[type="submit"]').click();
    }
    assert.equal(changes.at(-1), `Hello ${html}\n`, format);
    el.remove();
  }
});

test('More formatting previews each format on the selected text', () => {
  const { el } = mount('Hello world\n');
  const editor = el.editor;
  editor.editor.commands.setTextSelection({ from: 7, to: 12 });
  editor.more();
  const sample = (format, tag) => editor.dialogElement.querySelector(`[data-action="format-${format}"] .ve-format-sample ${tag}`);
  for (const [format, tag] of [['highlight', 'mark'], ['keyboard', 'kbd'], ['citation', 'cite'], ['subscript', 'sub'], ['superscript', 'sup'], ['abbreviation', 'abbr']]) {
    assert.equal(sample(format, tag)?.textContent, 'world', format);
  }
  assert.equal(editor.dialogElement.querySelector('button[type="submit"]'), null, 'a click applies: no Apply button');
  editor.closeDialog();

  editor.editor.commands.setTextSelection(3); // no selection: example text
  editor.more();
  assert.equal(sample('highlight', 'mark').textContent, 'Example text');
  editor.closeDialog();
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

test('page settings button: background, gradient and effect kept as a hidden comment opening the content', () => {
  const { el, changes } = mount('# Title\n\nText\n');
  const editor = el.editor;
  const dialog = () => editor.dialogElement;
  const submit = () => dialog().querySelector('button[type="submit"]').click();
  const button = editor.toolbar.querySelector('[data-action="pageSettings"]');
  assert.ok(button, 'button in the toolbar');
  assert.equal(button.getAttribute('aria-pressed'), 'false');

  editor.command('pageSettings');
  assert.equal(dialog().querySelector('select[name="background"]').value, 'none');
  dialog().querySelector('select[name="background"]').value = '#1d3557';
  dialog().querySelector('select[name="background2"]').value = 'custom';
  dialog().querySelector('input[name="custom2"]').value = '#6a4c93';
  dialog().querySelector('select[name="direction"]').value = 'radial';
  dialog().querySelector('select[name="effect"]').value = 'stars';
  assert.equal(dialog().querySelector('select[name="intensity"]').value, 'normal');
  dialog().querySelector('select[name="intensity"]').value = 'strong';
  submit();
  assert.equal(changes.at(-1), '<!-- ve-page background="#1d3557" background2="#6a4c93" direction="radial" effect="stars" intensity="strong" -->\n\n# Title\n\nText\n');
  const wrap = editor.editorWrap;
  assert.match(wrap.style.background, /radial-gradient/);
  assert.equal(editor.content.style.getPropertyValue('--ve-text'), '#ffffff', 'text color on the content');
  assert.equal(wrap.style.getPropertyValue('--ve-text'), '', 'not on the area: the floating bars keep the editor colors');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(el.querySelector('.ProseMirror').textContent, /ve-page/, 'comment hidden from the visual view');

  editor.setMode('source');
  assert.equal(editor.source.value, '# Title\n\nText\n', 'comment hidden from the source view');
  editor.source.value += '\nMore\n';
  editor.source.dispatchEvent(new window.Event('input'));
  assert.match(changes.at(-1), /^<!-- ve-page [^>]+ -->\n\n# Title\n\nText\n\nMore\n$/, 'kept while editing the source');
  editor.setMode('visual');

  editor.command('pageSettings');
  assert.equal(dialog().querySelector('select[name="effect"]').value, 'stars', 'dialog shows the current settings');
  assert.equal(dialog().querySelector('select[name="intensity"]').value, 'strong');
  dialog().querySelector('select[name="background"]').value = 'none';
  dialog().querySelector('select[name="effect"]').value = 'none';
  submit();
  assert.equal(changes.at(-1), '# Title\n\nText\n\nMore\n', 'nothing left: no comment');
  assert.equal(wrap.style.background, '');
  el.remove();
});

test('page settings: an existing comment loads without marking the page changed, byte for byte', () => {
  const markdown = '<!--  ve-page effect="snow"   background="#FDE2E4" -->\n\nText\n';
  const { el, changes } = mount(markdown);
  assert.equal(changes.length, 0);
  assert.equal(el.value, markdown);
  assert.equal(el.editor.content.style.getPropertyValue('--ve-text'), '#1f2329');
  el.editor.editor.commands.insertContentAt(1, 'New ');
  assert.equal(changes.at(-1), '<!--  ve-page effect="snow"   background="#FDE2E4" -->\n\nNew Text\n', 'the comment is kept as written');
  el.remove();
});

test('page settings: former header fields are shown and overridden, even by an empty choice', () => {
  const form = { 'header.background_color': '#EB094D42', 'header.page_effect': 'snow' };
  const el = document.createElement(tag);
  mounted.add(el);
  const changes = [];
  el.addEventListener('change', (event) => changes.push(event.detail));
  el.field = { name: 'content', visual_editor: {} };
  el.getValue = (path) => form[path];
  el.value = 'Text\n';
  document.body.append(el);
  const editor = el.editor;
  assert.match(editor.editorWrap.style.background, /rgba\(235, 9, 77|#eb094d42/);
  editor.command('pageSettings');
  const background = editor.dialogElement.querySelector('select[name="background"]');
  assert.equal(background.value, '#eb094d42', 'a color outside the presets stays selectable as it is');
  assert.equal(editor.dialogElement.querySelector('select[name="effect"]').value, 'snow');
  background.value = 'none';
  editor.dialogElement.querySelector('select[name="effect"]').value = 'none';
  editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.equal(changes.at(-1), '<!-- ve-page -->\n\nText\n');
  assert.equal(editor.editorWrap.style.background, '');
  el.remove();
});

test('toolbar: only the configured buttons, grouped in the reference order; an empty list is an empty toolbar', () => {
  const actions = (toolbar) => {
    const { el } = mount('Text\n', { name: 'content', type: 'visual-editor', visual_editor: { toolbar } });
    const names = [...el.editor.toolbar.querySelectorAll('[data-action]')].map((button) => button.dataset.action);
    el.remove();
    return names;
  };
  assert.deepEqual(actions(['bold', 'link', 'more']), ['bold', 'link', 'more']);
  assert.deepEqual(actions(['pageSettings', 'image', 'alignLeft', 'table', 'bold']), ['bold', 'table', 'alignLeft', 'image', 'pageSettings'], 'reference order whatever the configured order');
  assert.deepEqual(actions([]), []);
  const all = actions(null);
  assert.deepEqual(all.slice(-7), ['table', 'alignLeft', 'alignCenter', 'alignRight', 'image', 'colorBlock', 'pageSettings'], 'table with alignment, then media and colors at the right');
  const { el } = mount('Text\n', { name: 'content', type: 'visual-editor', visual_editor: { toolbar: ['undo', 'bold', 'table', 'alignLeft', 'image'] } });
  const layout = [...el.editor.toolbar.children].map((item) => item.dataset.action || '|');
  assert.deepEqual(layout, ['undo', '|', 'bold', '|', 'table', 'alignLeft', '|', 'image'], 'a separator between groups');
  el.remove();
});

test('page settings: no button when both site options are off', () => {
  const { el } = mount('Text\n', { name: 'content', type: 'visual-editor', visual_editor: { pageBackground: false, pageEffects: false } });
  assert.equal(el.editor.toolbar.querySelector('[data-action="pageSettings"]'), null);
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

test('table style: plain, normal, back to site default, and deleting a styled table', () => {
  const table = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  const { el, changes } = mount(`${table}\nAfter\n`);
  const editor = el.editor;
  const choose = (style) => {
    editor.tableBar.querySelector('[data-action="tableStyle"]').click();
    editor.dialogElement.querySelector('select[name="style"]').value = style;
    editor.dialogElement.querySelector('button[type="submit"]').click();
  };
  editor.editor.commands.setTextSelection(4);
  assert.equal(editor.tableBar.hidden, false);

  choose('plain');
  assert.equal(changes.at(-1), `[div class="ve-table-plain"]\n\n${table}\n[/div]\n\nAfter\n`);
  assert.equal(el.querySelector('.ProseMirror .ve-table-style').getAttribute('data-style'), 'plain');

  choose('normal');
  assert.equal(changes.at(-1), `[div class="ve-table-normal"]\n\n${table}\n[/div]\n\nAfter\n`);

  choose('default');
  assert.equal(changes.at(-1), `${table}\nAfter\n`);

  choose('plain');
  editor.tableBar.querySelector('[data-action="deleteTable"]').click();
  assert.equal(changes.at(-1), 'After\n', 'the wrapper goes with its table');
  el.remove();
});

test('a reference link keeps its form unless its URL is changed in the link dialog', () => {
  const { el, changes } = mount('See [Grav][g].\n\n[g]: https://getgrav.org\n');
  const editor = el.editor;
  assert.equal(el.querySelector('.ProseMirror a').getAttribute('href'), 'https://getgrav.org');
  editor.editor.commands.setTextSelection({ from: 5, to: 9 }); // the link text "Grav"
  editor.link();
  editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.deepEqual(changes, [], 'same URL: nothing changes');
  editor.link();
  editor.dialogElement.querySelector('input[name="href"]').value = 'https://example.org';
  editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.match(changes.at(-1), /^See \[Grav\]\(https:\/\/example\.org\)\.\n\n\[g\]: https:\/\/getgrav\.org\n$/);
  el.remove();
});

test('typing is reported to Admin2 once per pause, not once per keystroke', async () => {
  VisualEditorField.changeDelay = 40;
  try {
    const { el, changes } = mount('Hello\n');
    const tiptap = el.editor.editor;
    tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
    for (const letter of ' world') tiptap.commands.insertContent(letter);
    assert.deepEqual(changes, [], 'nothing reported while typing');
    assert.equal(el.value, 'Hello world\n', 'value is always current');
    await wait(80);
    assert.deepEqual(changes, ['Hello world\n'], 'one change after the pause, with the final text');
    el.remove();
  } finally { VisualEditorField.changeDelay = 0; }
});

test('pending edits are reported at once on blur, Ctrl+S, grav:editor:save and removal', async () => {
  VisualEditorField.changeDelay = 10000;
  try {
    const type = (el, text) => { const t = el.editor.editor; t.commands.setTextSelection(t.state.doc.content.size - 1); t.commands.insertContent(text); };
    const outside = document.createElement('button');
    document.body.append(outside);

    let { el, changes } = mount('A\n');
    type(el, '1');
    el.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    assert.deepEqual(changes, ['A1\n'], 'blur');

    let order = [];
    const adminSave = (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 's') order.push('admin2 save'); };
    window.addEventListener('keydown', adminSave);
    el.addEventListener('change', () => order.push('change'));
    type(el, '2');
    window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    assert.deepEqual(order, ['change', 'admin2 save'], 'Ctrl+S: reported before Admin2 saves');
    window.removeEventListener('keydown', adminSave);

    type(el, '3');
    window.dispatchEvent(new CustomEvent('grav:editor:save'));
    assert.equal(changes.at(-1), 'A123\n', 'grav:editor:save');

    type(el, '4');
    el.remove();
    assert.equal(changes.at(-1), 'A1234\n', 'removal');
    assert.equal(changes.length, 4);
    outside.remove();
  } finally { VisualEditorField.changeDelay = 0; }
});

test('inline code still refuses formatting marks (unchanged), while keeping a link', () => {
  const { el, changes } = mount('Use `x` here and [`y`](https://x.test).\n');
  const tiptap = el.editor.editor;
  tiptap.commands.setTextSelection({ from: 5, to: 6 }); // the code "x"
  tiptap.commands.toggleBold();
  tiptap.commands.setTextSelection({ from: 1, to: 4 });
  tiptap.commands.toggleItalic();
  assert.equal(changes.at(-1), '*Use* `x` here and [`y`](https://x.test).\n');
  el.remove();
});

test('link dialog with the cursor inside a link edits that link instead of inserting its URL', () => {
  const { el, changes } = mount('See [Grav](https://getgrav.org) now.\n');
  const editor = el.editor;
  const apply = (href) => {
    editor.link();
    if (href !== undefined) editor.dialogElement.querySelector('input[name="href"]').value = href;
    editor.dialogElement.querySelector('button[type="submit"]').click();
  };
  editor.editor.commands.setTextSelection(7); // inside "Grav", no selection
  apply();
  assert.deepEqual(changes, [], 'same URL: nothing inserted, nothing changed');
  editor.editor.commands.setTextSelection(7);
  apply('https://example.org');
  assert.equal(changes.at(-1), 'See [Grav](https://example.org) now.\n');

  editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 1); // after "now.", outside the link
  apply('https://new.test');
  assert.equal(changes.at(-1), 'See [Grav](https://example.org) now.[https://new.test](https://new.test)\n', 'outside a link: inserts a new link as before');
  el.remove();
});

test('the toolbar state is computed once per keystroke, with one lookup per block kind', () => {
  const { el } = mount('Hello\n');
  const editor = el.editor;
  const tiptap = editor.editor;
  tiptap.commands.setTextSelection(3);
  let refreshes = 0;
  let lookups = 0;
  const querySelectorAll = editor.toolbar.querySelectorAll.bind(editor.toolbar);
  editor.toolbar.querySelectorAll = (selector) => { refreshes += 1; return querySelectorAll(selector); };
  const findAncestor = editor.findAncestor.bind(editor);
  editor.findAncestor = (type) => { lookups += 1; return findAncestor(type); };
  tiptap.commands.insertContent('x');
  assert.equal(refreshes, 1, 'one toolbar refresh per keystroke');
  assert.ok(lookups <= 2, `ancestor lookups per refresh: ${lookups}`);
  assert.equal(editor.toolbar.querySelector('[data-action="alignLeft"]').getAttribute('aria-pressed'), 'true');
});

test('page media is read once per render, not once per image', () => {
  const original = window.__GRAV_PAGE_MEDIA;
  let reads = 0;
  window.__GRAV_PAGE_MEDIA = () => { reads += 1; return original(); };
  try {
    const { el } = mount(Array.from({ length: 20 }, (_, i) => `![p${i}](photo.jpg)\n`).join('\n'));
    assert.equal(el.querySelectorAll('.ProseMirror img[src="https://grav.example/user/pages/blog/post/photo.jpg"]').length, 20);
    assert.ok(reads <= 2, `media snapshot reads while mounting 20 images: ${reads}`);
    reads = 0;
    el.refreshImages();
    assert.ok(reads <= 1, `reads per refresh: ${reads}`);
  } finally { window.__GRAV_PAGE_MEDIA = original; }
});

test('distraction-free editing lifts the editor above the admin page, then puts it back', async () => {
  VisualEditorField.changeDelay = 10000;
  const pageFrame = document.createElement('div'); // stands for an Admin2 container with its own stacking context
  document.body.append(pageFrame);
  const el = document.createElement(tag);
  mounted.add(el);
  const changes = [];
  el.field = { name: 'content', visual_editor: {} };
  el.value = 'Text\n';
  el.addEventListener('change', (event) => { if (event.target === el) changes.push(event.detail); });
  pageFrame.append(el);
  const editor = el.editor;
  const toggle = () => editor.root.querySelector('[data-action="fullscreen"]').click();

  toggle();
  assert.ok(editor.root.parentElement === document.body, 'out of every admin container');
  assert.ok(editor.root.classList.contains('ve-fullscreen'));

  // Pending edits still reach Admin2 when focus leaves the full-screen editor.
  editor.editor.commands.setTextSelection(3);
  editor.editor.commands.insertContent('x');
  const outside = document.createElement('button');
  document.body.append(outside);
  editor.root.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
  assert.deepEqual(changes, ['Texxt\n']);

  toggle();
  assert.ok(editor.root.parentElement === el, 'back in the field');
  assert.ok(!editor.root.classList.contains('ve-fullscreen'));

  toggle();
  el.remove();
  assert.ok(document.querySelector('.ve-editor') === null, 'removing the field also removes a full-screen editor');
  pageFrame.remove();
  outside.remove();
});

test('the footer describes how edits are saved in Admin2', () => {
  const { el } = mount('Text\n');
  assert.equal(el.querySelector('.ve-footer span').textContent, 'Edits are kept as Markdown and saved with the page.');
});

test('the interface follows Admin2 in French, and stays English otherwise', () => {
  try {
    Object.defineProperty(window, '__GRAV_I18N', { value: { locale: 'fr', t: (key) => key }, configurable: true });
    const { el } = mount('Text\n');
    const editor = el.editor;
    assert.equal(editor.toolbar.querySelector('[data-action="bold"]').title, 'Gras');
    assert.equal(el.querySelector('.ve-footer span').textContent, 'Les modifications sont conservées en Markdown et enregistrées avec la page.');
    assert.match(editor.count.textContent, /caractères/);
    editor.link();
    assert.equal(editor.dialogElement.querySelector('h2').textContent, 'Insérer un lien');
    assert.equal(editor.dialogElement.querySelector('button[type="submit"]').textContent, 'Appliquer');
    editor.closeDialog();
    el.remove();
  } finally { delete window.__GRAV_I18N; }
  const { el } = mount('Text\n');
  assert.equal(el.editor.toolbar.querySelector('[data-action="bold"]').title, 'Bold');
});

/** Two peers: two Y.Docs that forward their updates to each other, as Admin2's sync providers do. */
async function collabPeers() {
  const Y = await import('yjs');
  const { Awareness } = await import('y-protocols/awareness');
  const docs = [new Y.Doc(), new Y.Doc()];
  docs[0].on('update', (update, origin) => { if (origin !== 'peer') Y.applyUpdate(docs[1], update, 'peer'); });
  docs[1].on('update', (update, origin) => { if (origin !== 'peer') Y.applyUpdate(docs[0], update, 'peer'); });
  const peers = docs.map((doc, i) => ({ fragment: doc.getXmlFragment('content'), awareness: new Awareness(doc), user: { name: `User ${i + 1}`, color: '#3d7eff' } }));
  // Awareness keeps a timer running: destroy peers after the test so the process can exit.
  disposers.push(() => { mounted.forEach((el) => el.remove()); peers.forEach((peer) => peer.awareness.destroy()); docs.forEach((doc) => doc.destroy()); });
  return peers;
}

/** Mount like CustomFieldWrapper does when collaboration is on: yFragment/yAwareness/yUser before connecting. */
function mountCollab(value, peer) {
  const el = document.createElement(tag);
  mounted.add(el);
  const changes = [];
  el.yFragment = peer.fragment;
  el.yAwareness = peer.awareness;
  el.yUser = peer.user;
  el.field = { name: 'content', visual_editor: { smartTypography: false } };
  el.value = value;
  el.addEventListener('change', (event) => { if (event.target === el) changes.push(event.detail); });
  document.body.append(el);
  return { el, changes };
}

test('collaboration: the first editor seeds the shared fragment, the second one gets its content', async () => {
  const [one, two] = await collabPeers();
  const a = mountCollab('# Title\n\nShared **text**.\n', one);
  assert.ok(one.fragment.length > 0, 'fragment seeded from the Markdown');
  const b = mountCollab('stale value from the form\n', two);
  assert.equal(b.el.editor.getMarkdown(), '# Title\n\nShared **text**.\n');
  assert.equal(b.el.querySelector('.ProseMirror h1').textContent, 'Title');
  assert.deepEqual(a.changes, [], 'mounting reports nothing');
});

test('collaboration: an edit in one editor reaches the other, and both report it', async () => {
  const [one, two] = await collabPeers();
  const a = mountCollab('Hello\n', one);
  const b = mountCollab('Hello\n', two);
  const tiptap = a.el.editor.editor;
  tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
  tiptap.commands.insertContent(' world');
  assert.equal(a.changes.at(-1), 'Hello world\n');
  assert.equal(b.el.querySelector('.ProseMirror p').textContent, 'Hello world');
  assert.equal(b.changes.at(-1), 'Hello world\n');
});

test('collaboration: undo uses the shared history; value echoes are ignored; replaceContent replaces', async () => {
  const [one, two] = await collabPeers();
  const a = mountCollab('Hello\n', one);
  const b = mountCollab('Hello\n', two);
  const tiptap = a.el.editor.editor;
  tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
  tiptap.commands.insertContent('!');
  a.el.editor.toolbar.querySelector('[data-action="undo"]').click();
  assert.equal(a.el.editor.getMarkdown(), 'Hello\n', 'toolbar undo');
  assert.equal(b.el.querySelector('.ProseMirror p').textContent, 'Hello');
  a.el.value = 'Something else from the form\n';
  assert.equal(a.el.editor.getMarkdown(), 'Hello\n', 'the shared fragment is the source of truth');
  a.el.replaceContent('## Replaced\n');
  assert.equal(b.el.querySelector('.ProseMirror h2')?.textContent, 'Replaced');
});

test('collaboration: other participants show as cursors', async () => {
  const [one] = await collabPeers();
  mountCollab('Hello\n', one);
  assert.deepEqual(one.awareness.getLocalState().user, { name: 'User 1', color: '#3d7eff' });
});

test('Insert alert adds an alert block with the chosen type and message', () => {
  const { el, changes } = mount('Intro\n\nOutro\n');
  const editor = el.editor;
  const insert = (kind, text) => {
    editor.alertDialog();
    editor.dialogElement.querySelector('select[name="kind"]').value = kind;
    editor.dialogElement.querySelector('textarea[name="text"]').value = text;
    editor.dialogElement.querySelector('button[type="submit"]').click();
  };
  editor.editor.commands.setTextSelection(3); // inside "Intro"
  insert('WARNING', 'Careful here.');
  assert.equal(changes.at(-1), 'Intro\n\n> [!WARNING]\n> Careful here.\n\nOutro\n');
  const alert = el.querySelector('.ProseMirror blockquote.ve-alert-warning');
  assert.equal(alert?.querySelector('.ve-alert-title')?.textContent, 'Warning');

  insert('TIP', 'One\nTwo');
  assert.match(changes.at(-1), /> \[!WARNING\]\n> Careful here\.\n\n> \[!TIP\]\n> One\n>\n> Two\n\nOutro\n$/, 'inserted after the current block, one paragraph per line');
});

test('Insert alert replaces an empty paragraph', () => {
  const { el, changes } = mount('');
  el.editor.alertDialog();
  el.editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.equal(changes.at(-1), '> [!NOTE]\n> Write something worth noticing.\n');
});

test('dialog selects default to their first option (alert type, HTML/Twig block type)', () => {
  const { el, changes } = mount('Intro\n');
  const editor = el.editor;
  editor.alertDialog();
  assert.equal(editor.dialogElement.querySelector('select[name="kind"]').value, 'NOTE');
  editor.closeDialog();
  editor.editor.commands.setTextSelection(3);
  editor.rawDialog();
  assert.equal(editor.dialogElement.querySelector('select[name="kind"]').value, 'html');
  editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.match(changes.at(-1), /<div class="notice">/);
  assert.equal(el.querySelector('.ProseMirror .ve-protected-html') !== null, true);
});

test('the block handle drags the current block to another place', () => {
  const { el, changes } = mount('First\n\nSecond\n\nThird\n');
  const editor = el.editor;
  const view = editor.editor.view;
  const handle = el.querySelector('.ve-drag-handle');
  assert.ok(handle && handle.draggable, 'one handle, outside the document, draggable');
  assert.equal(view.dom.contains(handle), false);

  editor.editor.commands.setTextSelection(3); // in "First"
  assert.equal(handle.hidden, false);
  handle.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(view.state.selection.node?.textContent, 'First', 'pressing the handle selects its block');
  assert.equal(handle.isConnected && !handle.hidden, true, 'the handle stays in place while pressed');

  const data = {};
  const dataTransfer = { files: [], effectAllowed: '', setData: (type, value) => { data[type] = value; }, getData: (type) => data[type] || '', clearData() {}, setDragImage() {} };
  const start = new window.Event('dragstart', { bubbles: true, cancelable: true });
  start.dataTransfer = dataTransfer;
  handle.dispatchEvent(start);
  assert.equal(start.defaultPrevented, false);
  assert.equal(view.dragging?.slice.content.firstChild.textContent, 'First');
  assert.equal(data['text/plain'], 'First');

  // Drop at the end of the document (jsdom has no layout: give ProseMirror the position).
  view.posAtCoords = () => ({ pos: view.state.doc.content.size, inside: -1 });
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  drop.dataTransfer = dataTransfer;
  view.dom.dispatchEvent(drop);
  assert.equal(changes.at(-1), 'Second\n\nThird\n\nFirst\n');
  handle.dispatchEvent(new window.Event('dragend', { bubbles: true }));

  el.remove();
  assert.equal(handle.isConnected, false, 'removed with the editor');
});

test('Insert table goes after the current block, not inside it, and puts the cursor in the first cell', () => {
  const { el, changes } = mount('Hello world\n\nAfter\n');
  const editor = el.editor;
  const insert = (rows, columns) => {
    editor.tableDialog();
    editor.dialogElement.querySelector('input[name="rows"]').value = String(rows);
    editor.dialogElement.querySelector('input[name="columns"]').value = String(columns);
    editor.dialogElement.querySelector('button[type="submit"]').click();
  };
  editor.editor.commands.setTextSelection(4); // in the middle of "Hello world"
  insert(2, 2);
  assert.equal(changes.at(-1), 'Hello world\n\n|  |  |\n| --- | --- |\n|  |  |\n\nAfter\n');
  const { $from } = editor.editor.state.selection;
  assert.equal($from.node($from.depth - 1).type.name, 'tableHeader', 'cursor in the first header cell');
  assert.equal($from.index($from.depth - 2), 0);

  const empty = mount('');
  empty.el.editor.tableDialog();
  empty.el.editor.dialogElement.querySelector('button[type="submit"]').click();
  assert.equal(empty.changes.at(-1), '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n', 'an empty paragraph is replaced');
});

test('colored block dialog: gradient to a preset or custom color, direction, and back to a solid color', () => {
  const { el, changes } = mount('Fairy text\n');
  const editor = el.editor;
  const open = () => { editor.editor.commands.setTextSelection(3); editor.command('colorBlock'); };
  const field = (name) => editor.dialogElement.querySelector(`[name="${name}"]`);
  const submit = () => editor.dialogElement.querySelector('button[type="submit"]').click();

  open();
  assert.equal(field('gradient').value, 'none');
  field('gradient').value = '#ece4fb';
  field('direction').value = 'to bottom right';
  submit();
  assert.match(changes.at(-1), /^\[div class="ve-block" style="background-color:#fde2e4;background-image:linear-gradient\(to bottom right,#fde2e4,#ece4fb\);/);
  assert.match(el.querySelector('.ProseMirror .ve-color-block').getAttribute('style'), /linear-gradient/);

  open();
  assert.equal(field('gradient').value, '#ece4fb', 'the dialog shows the current gradient');
  assert.equal(field('direction').value, 'to bottom right');
  field('gradient').value = 'custom';
  field('custom2').value = '#1d3557';
  field('direction').value = 'radial';
  submit();
  assert.match(changes.at(-1), /radial-gradient\(circle at center,#fde2e4,#1d3557\)/);

  open();
  field('gradient').value = 'none';
  submit();
  assert.doesNotMatch(changes.at(-1), /background-image/);
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

test('table cells: Enter makes a line break, the heading button explains instead of breaking the cell', () => {
  const { el, changes } = mount('| A | B |\n| --- | --- |\n| one | x |\n');
  const editor = el.editor;
  let cell = 0;
  editor.editor.state.doc.descendants((node, pos) => { if (!cell && node.isText && node.text === 'one') cell = pos + 3; });
  editor.editor.commands.setTextSelection(cell);
  editor.editor.commands.splitBlock();
  editor.editor.commands.insertContent('two');
  assert.equal(changes.at(-1), '| A | B |\n| --- | --- |\n| one<br>two | x |\n');
  editor.command('heading');
  assert.ok(!editor.dialogElement, 'no heading dialog in a table');
  assert.match(editor.status.textContent, /une ligne de texte|one line of text/);
  el.remove();
});
