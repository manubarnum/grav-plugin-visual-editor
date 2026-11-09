import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { documentToMarkdown, markdownToHtml } from '../src/extensions.js';
import { Editor, getSchema } from '@tiptap/core';
import { createExtensions } from '../src/extensions.js';
import { normalizeTableRow, protectBlocks, protectInline, githubAlerts } from '../src/markdown.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/admin/pages/home' });
global.window = dom.window;
global.document = dom.window.document;
// Node 21+ defines a getter-only global navigator; replace it with jsdom's.
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MutationObserver = dom.window.MutationObserver;
global.getComputedStyle = dom.window.getComputedStyle;
global.DOMParser = dom.window.DOMParser;
global.CustomEvent = dom.window.CustomEvent;
global.requestAnimationFrame = (callback) => callback();
const config = { smartTypography: false, pageMediaUrl: '/blog/' };
const extensions = createExtensions(config);
const schema = getSchema(extensions);
function roundTrip(markdown) {
  const editor = new Editor({ element: document.createElement('div'), extensions, content: markdownToHtml(markdown, '/blog/') });
  const result = documentToMarkdown(editor.state.doc);
  editor.destroy();
  return result;
}

test('paragraphs, headings and marks serialize to Markdown', () => {
  assert.equal(roundTrip('# A title\n\nText with **bold** and *italic*.\n'), '# A title\n\nText with **bold** and *italic*.\n');
});

test('lists, links, images and code round-trip', () => {
  const source = '- One\n- Two\n\n[Grav](https://getgrav.org)\n\n![Screenshot](screen.png "Preview")\n\n```php\necho "Hello";\n```\n';
  assert.equal(roundTrip(source), source);
});

test('nested shortcodes are preserved as one block', () => {
  const source = '[columns]\n[column width=50]\nText\n[/column]\n[column width=50]\n[notice]Nested[/notice]\n[/column]\n[/columns]\n';
  const html = markdownToHtml(source);
  assert.match(html, /data-kind="shortcode"/);
  assert.equal(roundTrip(source), source);
});

test('HTML and Twig blocks remain verbatim', () => {
  const source = '<div class="special">\n  <span>Raw</span>\n</div>\n\n{% if page.header.featured %}\n  {{ page.title }}\n{% endif %}\n';
  assert.equal(roundTrip(source), source);
});

test('five alerts retain their semantic kind', () => {
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const source = `> [!${kind}]\n> Read this carefully.\n`;
    assert.match(roundTrip(source), new RegExp(`\\[!${kind}\\]`));
  }
});

test('tables support escaped pipes, inline marks and alignment', () => {
  const source = '| Name | Description | Value |\n| :--- | :---: | ---: |\n| A\\|B | **Bold** | 42 |\n';
  assert.match(markdownToHtml(source), /<table>/);
  assert.equal(roundTrip(source), source);
});

test('table parsing does not treat escaped pipes as delimiters', () => {
  assert.deepEqual(normalizeTableRow('| one \\| two | `x|y` |'), ['one | two', '`x|y`']);
});

test('inline HTML supported by the editor is retained', () => {
  const source = 'Press <kbd>Ctrl</kbd> and see <abbr title="HyperText Markup Language">HTML</abbr>, <cite>source</cite>, <mark>important</mark>, H<sub>2</sub>O and x<sup>2</sup>.\n';
  assert.equal(roundTrip(source), source);
});

test('inline Twig and shortcode atoms survive without escaping', () => {
  const source = 'Hello {{ page.title }} and [badge type="new"].\n';
  assert.equal(roundTrip(source), source);
});

test('unrecognized block markup stays protected', () => {
  assert.match(protectBlocks('<script>example()</script>'), /ve-protected/);
  assert.match(protectInline('{{ page.title }}'), /ve-inline/);
});

test('fenced code containing blank lines stays one block', () => {
  const source = '```js\na();\n\nb();\n```\n';
  assert.equal(roundTrip(source), source);
});

test('plain blockquotes and multi-paragraph alerts keep their > prefix', () => {
  for (const source of ['> Just a quote.\n', '> One\n>\n> Two\n', '> [!TIP]\n> One\n>\n> Two\n']) {
    assert.equal(roundTrip(source), source);
  }
});

test('blockquotes inside list items stay in the list', () => {
  const sources = [
    '- > nested\n',
    '1. > numbered\n',
    '- Item\n\n  > quote\n',
    '1. One\n\n   > aligned with the item content\n2. Two\n',
    '- > [!NOTE]\n  > Alert in a list\n',
  ];
  for (const source of sources) assert.equal(roundTrip(source), source);
});

test('fences opened on a list item line stay in the item, verbatim', () => {
  const sources = [
    '- ```js\n  a();\n  ```\n',
    '1. ```sh\n   ls\n   ```\n2. Next\n',
    '- ```\n  {{ page.title }} [notice]x[/notice]\n\n  b\n  ```\n- After\n',
  ];
  for (const source of sources) assert.equal(roundTrip(source), source);
});

test('prose punctuation is not over-escaped, but leading block markers are', () => {
  assert.equal(roundTrip('Version 1.0 - (beta) costs 5+3!\n'), 'Version 1.0 - (beta) costs 5+3!\n');
  assert.equal(roundTrip('\\# not a heading\n'), '\\# not a heading\n');
});

test('markdown alert conversion adds explicit semantic data', () => {
  assert.match(githubAlerts('<blockquote><p>[!TIP] Hint</p></blockquote>'), /data-alert="TIP"/);
});
