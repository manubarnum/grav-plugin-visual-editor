/** Shared editor UI data and helpers: toolbar icons/labels/defaults, messages, DOM and transfer helpers. */

export const icons = {
  undo: '↶', redo: '↷', heading: 'H', bold: 'B', italic: 'I', strike: 'S', link: '🔗', image: '▧',
  bulletList: '•≡', orderedList: '1.≡', blockquote: '❝', alert: 'ⓘ', colorBlock: '▣', alignLeft: '⇤', alignCenter: '↔', alignRight: '⇥', table: '⊞', codeBlock: '{ }',
  raw: '</>', shortcode: '[ ]', source: '⌘', more: '⋯', highlight: '▰', subscript: 'x₂', superscript: 'x²',
  keyboard: '⌨', citation: 'C', abbreviation: 'ab', fullscreen: '⛶', pageSettings: '✦',
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

export const defaults = ['undo', 'redo', 'heading', 'bold', 'italic', 'strike', 'link', 'image', 'bulletList', 'orderedList', 'blockquote', 'alert', 'colorBlock', 'alignLeft', 'alignCenter', 'alignRight', 'table', 'codeBlock', 'raw', 'shortcode', 'source'];
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

export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
