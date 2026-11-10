/** Shared editor UI data and helpers: toolbar icons/labels/defaults, messages, DOM and transfer helpers. */

/** Toolbar icons: SVG content on a 24×24 grid, drawn with the current text color (see iconSvg()). */
export const icons = {
  undo: "<path d='M9 14 4 9l5-5'/><path d='M4 9h11a5 5 0 0 1 0 10h-4'/>",
  redo: "<path d='m15 14 5-5-5-5'/><path d='M20 9H9a5 5 0 0 0 0 10h4'/>",
  heading: "<path d='M6 4v16M18 4v16M6 12h12'/>",
  bold: "<path d='M7 4h6.5a4 4 0 0 1 0 8H7zM7 12h7.5a4 4 0 0 1 0 8H7z'/>",
  italic: "<path d='M19 4h-9M14 20H5M15 4 9 20'/>",
  strike: "<path d='M16.5 7C15.8 5.3 14.1 4 12 4 9.5 4 7.5 5.5 7.5 7.5c0 1.3.7 2.3 2 3M4 12h16M15.6 14c.6.7.9 1.5.9 2.5 0 2-2 3.5-4.5 3.5-2.2 0-3.9-1.1-4.5-2.8'/>",
  link: "<path d='M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1'/>",
  more: "<path d='M5 12h.01M12 12h.01M19 12h.01' stroke-width='3.2'/>",
  bulletList: "<path d='M9 6h11M9 12h11M9 18h11'/><path d='M4.5 6h.01M4.5 12h.01M4.5 18h.01' stroke-width='3'/>",
  orderedList: "<path d='M10 6h10M10 12h10M10 18h10'/><path d='M4 4.5h1.2V9M3.8 9h2.6M3.8 14.6c.4-.7 2.6-.8 2.6.5 0 1.2-2.6 1.7-2.6 3.4h2.7' stroke-width='1.5'/>",
  blockquote: "<path d='M4 5v14'/><path d='M9 7h11M9 12h11M9 17h7'/>",
  alert: "<circle cx='12' cy='12' r='9'/><path d='M12 11v5'/><path d='M12 7.6h.01' stroke-width='2.8'/>",
  codeBlock: "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9.5 2.5 2.5L7 14.5M12 15h4'/>",
  raw: "<path d='m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'/>",
  shortcode: "<path d='M8 4H5v16h3M16 4h3v16h-3'/><path d='M12 12h.01' stroke-width='3'/>",
  source: "<rect x='2.5' y='5' width='19' height='14' rx='2'/><path d='M6 15V9l3 3 3-3v6M16.5 9v6M14.5 13l2 2 2-2'/>",
  table: "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M3 10h18M3 15h18M10 4v16'/>",
  alignLeft: "<path d='M4 6h16M4 10h10M4 14h16M4 18h10'/>",
  alignCenter: "<path d='M4 6h16M7 10h10M4 14h16M7 18h10'/>",
  alignRight: "<path d='M4 6h16M10 10h10M4 14h16M10 18h10'/>",
  image: "<rect x='3' y='4' width='18' height='16' rx='2'/><circle cx='9' cy='9.5' r='1.7'/><path d='m21 15-5-5-10 10'/>",
  colorBlock: "<rect x='3' y='4' width='18' height='16' rx='3'/><rect x='6.5' y='7.5' width='11' height='9' rx='1.5' fill='currentColor' fill-opacity='.35' stroke='none'/>",
  theme: "<circle cx='12' cy='12' r='8.5'/><path d='M12 3.5a8.5 8.5 0 0 1 0 17z' fill='currentColor' stroke='none'/>",
  pageSettings: "<path d='M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z'/><path d='m18.5 15 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' stroke-width='1.5'/>",
};
export const labels = {
  undo: 'Undo', redo: 'Redo', heading: 'Heading and paragraph', bold: 'Bold', italic: 'Italic', strike: 'Strikethrough',
  link: 'Insert link', image: 'Insert image from page media', bulletList: 'Bulleted list', orderedList: 'Numbered list',
  blockquote: 'Blockquote', alert: 'GitHub-style alert', colorBlock: 'Colored block (background color)', alignLeft: 'Align left', alignCenter: 'Center', alignRight: 'Align right', table: 'Insert or edit table', codeBlock: 'Code block',
  raw: 'HTML or Twig block', shortcode: 'Insert shortcode', source: 'Markdown source', more: 'More formatting',
  highlight: 'Highlight', subscript: 'Subscript', superscript: 'Superscript', keyboard: 'Keyboard text', citation: 'Citation', abbreviation: 'Abbreviation',
  pageSettings: 'Page background and effects',
};
/** Where shortcode-backed blocks may be created: their tags must start a line (not inside a list or quote). */
export const shortcodeContainers = ['doc', 'colorBlock', 'alignBlock'];

/** Toolbar order, by group (a separator between groups): history, text, blocks, table, media and colors. */
export const toolbarGroups = [
  ['undo', 'redo'],
  ['heading', 'bold', 'italic', 'strike', 'link', 'more'],
  ['bulletList', 'orderedList', 'blockquote', 'alert', 'codeBlock', 'raw', 'shortcode', 'source'],
  ['table', 'alignLeft', 'alignCenter', 'alignRight'],
  ['image', 'colorBlock', 'pageSettings'],
];
export const defaults = toolbarGroups.flat();
export const messages = {
  visual: 'Visual', source: 'Source', saved: 'Edits are kept as Markdown and saved with the page.', copied: 'Source copied.',
};

/** A lone Markdown image or link in transferred text (always accepted when it comes from Grav's media panel). */
const markdownMediaPattern = /^!?\[[^\]\n]*\]\([^()\s]+(?:\s+"[^"\n]*")?\)$/;
export function markdownSnippet(transfer, fromGravMedia) {
  const text = String(transfer?.getData?.('text/plain') || '').trim();
  if (!text) return '';
  return fromGravMedia || markdownMediaPattern.test(text) ? text : '';
}

/** A toolbar icon as an inline SVG element (constant markup from `icons`). */
export function iconSvg(name) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
  return template.content.firstElementChild;
}

export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
