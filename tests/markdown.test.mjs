import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { documentToMarkdown, markdownToHtml } from '../src/extensions.js';
import { Editor, getSchema } from '@tiptap/core';
import { createExtensions } from '../src/extensions.js';
import { flattenTableCells, normalizeTableRow, protectBlocks, protectInline, githubAlerts, imageWidth, withImageWidth, detectMarkdownStyle, colorBlockTag, gradientFromOpen } from '../src/markdown.js';

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
  // As the editor does: write back with the conventions the page already uses.
  const result = documentToMarkdown(editor.state.doc, detectMarkdownStyle(markdown));
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

test('image widths are stored as Grav cropResize actions, keeping other media actions', () => {
  assert.equal(imageWidth('photo.jpg'), null);
  assert.equal(imageWidth('photo.jpg?lightbox&cropResize=300,200'), 300);
  assert.equal(withImageWidth('photo.jpg', 640), 'photo.jpg?cropResize=640');
  assert.equal(withImageWidth('photo.jpg?lightbox&cropResize=300', 960), 'photo.jpg?lightbox&cropResize=960');
  assert.equal(withImageWidth('photo.jpg?cropResize=300#top', null), 'photo.jpg#top');
});

test('GIF and SVG widths use Grav resize (never resized as files: cropResize is ignored, animation kept)', () => {
  assert.equal(withImageWidth('anim.gif', 320), 'anim.gif?resize=320');
  assert.equal(withImageWidth('LOGO.SVG?lightbox', 200), 'LOGO.SVG?lightbox&resize=200');
  assert.equal(imageWidth('anim.gif?resize=320'), 320);
  assert.equal(withImageWidth('anim.gif?cropResize=300', 480), 'anim.gif?resize=480', 'a former cropResize is replaced');
  assert.equal(withImageWidth('anim.gif?resize=300', null), 'anim.gif');
  assert.equal(roundTrip('![Anim](anim.gif?resize=320)\n'), '![Anim](anim.gif?resize=320)\n');
});

test('resized images round-trip unchanged', () => {
  for (const source of ['![A photo](photo.jpg?cropResize=640)\n', '![A photo](photo.jpg?lightbox&cropResize=320 "Title")\n']) {
    assert.equal(roundTrip(source), source);
  }
});

test('colored blocks round-trip with editable Markdown inside', () => {
  const open = '[div class="ve-block" style="background-color:#fde2e4;color:#1f2329;padding:1em 1.25em;border-radius:8px;margin:1em 0"]';
  const source = `${open}\n\n## Inside\n\nSome **bold** text.\n\n- one\n- two\n\n[notice]Nested[/notice]\n\n\`\`\`js\na();\n\`\`\`\n\n[/div]\n\nAfter\n`;
  const html = markdownToHtml(source);
  assert.match(html, /data-ve-block/);
  assert.match(html, /<strong>bold<\/strong>/, 'content is parsed as Markdown, not protected');
  assert.equal(roundTrip(source), source);
});

test('other [div] shortcodes stay protected verbatim', () => {
  const source = '[div class="table table-striped"]\n| a | b |\n[/div]\n';
  assert.doesNotMatch(markdownToHtml(source), /data-ve-block/);
  assert.equal(roundTrip(source), source);
});

test('alignment shortcodes round-trip with editable Markdown inside', () => {
  for (const align of ['center', 'right', 'left', 'justify']) {
    const source = `[${align}]\n\n## Title\n\nSome **text**.\n\n![](photo.jpg)\n\n[/${align}]\n`;
    const html = markdownToHtml(source);
    assert.match(html, new RegExp(`data-ve-align="${align}"`));
    assert.match(html, /<strong>text<\/strong>/);
    assert.equal(roundTrip(source), source, align);
  }
  // Inline form on one line stays a protected shortcode, verbatim.
  assert.equal(roundTrip('[center]Inline[/center]\n'), '[center]Inline[/center]\n');
});

test('per-table style wrappers round-trip around their table', () => {
  for (const style of ['plain', 'normal']) {
    const source = `[div class="ve-table-${style}"]\n\n| A | B |\n| --- | ---: |\n| 1 | **2** |\n\n[/div]\n\nAfter\n`;
    assert.match(markdownToHtml(source), new RegExp(`data-ve-table-style="${style}"`));
    assert.equal(roundTrip(source), source, style);
  }
});

test('reference-style links keep their form and their definitions', () => {
  const sources = [
    'See [Grav][g] and [the docs][Docs].\n\n[g]: https://getgrav.org\n[docs]: https://learn.getgrav.org "Learn Grav"\n',
    'Collapsed [Grav][] and shortcut [Grav].\n\n[grav]: https://getgrav.org\n',
  ];
  for (const source of sources) assert.equal(roundTrip(source), source);
  assert.match(markdownToHtml(sources[0]), /<a href="https:\/\/getgrav\.org"/);
});

test('an undefined [label] after a link text is still not a reference', () => {
  assert.equal(roundTrip('[notice]Text[/notice]\n'), '[notice]Text[/notice]\n');
  assert.equal(roundTrip('Hello [badge type="new"] there.\n'), 'Hello [badge type="new"] there.\n');
});

test('reference syntax inside code is left alone', () => {
  const source = 'Use `[a][b]` literally.\n\n[b]: https://x.test\n';
  assert.equal(roundTrip(source), source);
});

test('footnotes keep their references and definitions', () => {
  const source = 'Text[^1] and more[^note].\n\n[^1]: First note.\n[^note]: Second note\n    continued.\n';
  assert.equal(roundTrip(source), source);
});

test('images inside a sentence stay inline; linked images keep their link', () => {
  for (const source of ['Look ![a](a.jpg) here\n', 'Logo: [![Grav](logo.png)](https://getgrav.org) end.\n', '[![Grav](logo.png)](https://getgrav.org)\n']) {
    assert.equal(roundTrip(source), source);
  }
});

test('a link around mixed formatting stays one link', () => {
  const source = 'See [a **b** *c*](https://x.test "T") end.\n';
  assert.equal(roundTrip(source), source);
});

test('shortcodes, Twig and footnote syntax inside inline code stay literal', () => {
  const source = 'Write `[notice]Hi[/notice]`, `{{ page.title }}` or `[^1]` as text.\n';
  assert.equal(roundTrip(source), source);
});

test('a link around inline code keeps its link', () => {
  for (const source of ['[use `x`](https://x.test)\n', 'Run [`npm test`](https://docs.npmjs.com "npm") first.\n']) {
    assert.equal(roundTrip(source), source);
  }
});

test('saving keeps the page own Markdown conventions', () => {
  const sources = {
    'star bullets': '* one\n* two\n',
    'plus bullets': '+ one\n+ two\n',
    'underscore emphasis': 'Some _em_ and __strong__.\n',
    'setext headings': 'Title\n=====\n\nSub\n---\n\nText\n',
    'ordered with )': '1) one\n2) two\n',
    'star rule': 'A\n\n***\n\nB\n',
    'two-space hard break': 'Line one  \nLine two\n',
    'autolink': 'Visit <https://getgrav.org> now.\n',
    'table without outer pipes': 'A | B\n--- | ---\n1 | 2\n',
  };
  for (const [name, source] of Object.entries(sources)) assert.equal(roundTrip(source), source, name);
});

test('pages without those variants are written as before', () => {
  const source = '# Title\n\n- one\n- two\n\n1. a\n2. b\n\nSome *em*, **strong**, [https://x.test](https://x.test)\\\nnext\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  assert.equal(roundTrip(source), source);
});

test('* and _ are escaped only where they could become formatting', () => {
  for (const source of ['Price 5 * 3 = 15 and a_b_c and snake_case_name.\n', 'A \\*literal\\* star and \\_literal\\_ underscore.\n', '\\* not a list\n']) {
    assert.equal(roundTrip(source), source);
  }
});

test('tight nested lists stay tight', () => {
  for (const source of ['- A\n  - B\n  - C\n- D\n', '1. A\n   1. B\n2. C\n']) assert.equal(roundTrip(source), source);
});

test('colored block gradients: written in the shortcode style, read back, round-trip verbatim', () => {
  const tag = colorBlockTag('#fde2e4', '', { to: '#ece4fb', direction: 'to right' });
  assert.equal(tag, '[div class="ve-block" style="background-color:#fde2e4;background-image:linear-gradient(to right,#fde2e4,#ece4fb);color:#1f2329;padding:1em 1.25em;border-radius:8px;margin:1em 0"]');
  assert.deepEqual(gradientFromOpen(tag), { to: '#ece4fb', direction: 'to right' });
  assert.equal(gradientFromOpen(colorBlockTag('#fde2e4')), null);
  // Changing the colors of an existing tag keeps its other declarations; removing the gradient removes it.
  const night = colorBlockTag('#1d3557', tag, { to: '#6a4c93', direction: 'radial' });
  assert.match(night, /background-color:#1d3557;background-image:radial-gradient\(circle at center,#1d3557,#6a4c93\);color:#ffffff;padding/);
  assert.doesNotMatch(colorBlockTag('#1d3557', night, null), /background-image/);
  const source = `${tag}\n\nFairy **text**.\n\n[/div]\n`;
  assert.match(markdownToHtml(source), /data-ve-block/);
  assert.equal(roundTrip(source), source);
});

test('table cells stay one line: paragraphs and line breaks become <br>, pasted headings and lists become text', () => {
  const source = '| A | B |\n| --- | --- |\n| one<br>two | x |\n';
  assert.equal(roundTrip(source), source, 'a <br> in a cell round-trips');
  const editor = new Editor({
    element: document.createElement('div'), extensions,
    content: flattenTableCells('<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><h2>Title</h2><p>First</p><p>Second</p></td><td><ul><li><p>item</p></li></ul></td></tr></table>'),
  });
  const markdown = documentToMarkdown(editor.state.doc);
  editor.destroy();
  assert.equal(markdown, '| A | B |\n| --- | --- |\n| Title<br>First<br>Second | item |\n');
});

test('images in table cells stay in their cell (inline), with or without a table style', () => {
  for (const source of [
    '| A | B |\n| --- | --- |\n| text | ![Photo](p.jpg?cropResize=339) |\n',
    '| A |\n| --- |\n| x ![Photo](p.jpg) y |\n',
    '[div class="ve-table-plain"]\n\n| A | B |\n| --- | --- |\n| text | ![Foulees](f.jpg "Clio") |\n\n[/div]\n',
  ]) assert.equal(roundTrip(source), source);
});
