const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => htmlEntities[char]);
/** Escapes only what Markdown would interpret inside prose; block markers only where a line could start. */
export const escapeMarkdown = (value) => String(value ?? '')
  .replace(/([\\`*_\[\]<]|~~)/g, (char) => char === '~~' ? '\\~\\~' : '\\' + char)
  .replace(/^(\s*)([#>+-])(?=\s|$)/gm, '$1\\$2')
  .replace(/^(\s*\d+)([.)])(?=\s|$)/gm, '$1\\$2');
/** Source stored in a placeholder attribute must be inert for marked, table detection and protectInline. */
const encodeSource = (value) => String(value ?? '').replace(/[^\p{L}\p{N} ]/gu, (char) => `&#${char.codePointAt(0)};`);
export const alertKinds = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];

const inlinePattern = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}|\[\^[^\]\s]+\](?!:)|(?<!!)\[\/?[a-zA-Z][\w:-]*(?:\s+[^\]\n]*)?\](?![(\[:]))|<\/?(?:span|abbr|cite|kbd|mark|sup|sub)(?:\s+[^<>]*)?>/g;

/** Unknown HTML/Twig is never silently interpreted as editable prose. */
export function protectInline(source) {
  // Inline code spans are literal: their brackets and braces are not shortcodes, Twig or footnotes.
  const pattern = new RegExp('(`+)[\\s\\S]*?\\1|' + inlinePattern.source, 'g');
  return String(source).replace(pattern, (raw, ticks) => (ticks ? raw : `<ve-inline data-source="${encodeSource(raw)}"></ve-inline>`));
}

function protectedBlock(source, kind = 'raw') {
  return `<ve-protected data-kind="${kind}" data-source="${encodeSource(source.replace(/\n$/, ''))}"></ve-protected>\n\n`;
}

function extractShortcode(lines, start) {
  const first = lines[start];
  const match = first.match(/^\s*\[([a-zA-Z][\w:-]*)(?:\s+[^\]]*)?\]/);
  if (!match || match[1].startsWith('!')) return -1;
  const name = match[1];
  const stack = [];
  const token = /\[\/?([a-zA-Z][\w:-]*)(?:\s+[^\]]*)?\]/g;
  for (let i = start; i < lines.length; i++) {
    token.lastIndex = 0;
    let part;
    while ((part = token.exec(lines[i]))) {
      if (part[1] !== name) continue;
      if (part[0][1] === '/') stack.pop();
      else if (!part[0].endsWith('/]')) stack.push(name);
    }
    if (stack.length === 0) return i;
  }
  return -1;
}

/** Block-level source protection runs before the Markdown parser. */
export function protectBlocks(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    // A fence may also open on a list item's own line (`- ```js`): keep the marker outside the
    // placeholder and store the code dedented to the item's content column, which is where
    // nodeToMarkdown re-indents it.
    const listFence = line.match(/^(\s*(?:[-+*]|\d{1,9}[.)])\s+)(`{3,}|~{3,})/);
    const fence = listFence || line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const prefix = listFence ? listFence[1] : '';
      const width = prefix.length;
      const dedent = (text) => text.replace(new RegExp('^ {0,' + width + '}'), '');
      const block = [line.slice(width)];
      const marker = fence[listFence ? 2 : 1][0];
      const length = fence[listFence ? 2 : 1].length;
      while (++i < lines.length) {
        block.push(dedent(lines[i]));
        if (new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{' + length + ',}\\s*$').test(lines[i])) break;
      }
      i++;
      out.push(prefix + protectedBlock(block.join('\n'), 'code'));
      continue;
    }
    // Any HTML tag except the inline ones the editor models itself (see inlinePattern).
    if (/^\s*(<[!?/]|<(?!(?:span|abbr|cite|kbd|mark|sup|sub)\b)[a-zA-Z]|\{\{|\{%|\{#)/.test(line)) {
      const block = [line];
      const kind = /^\s*</.test(line) ? 'html' : 'twig';
      while (++i < lines.length && lines[i].trim() !== '') block.push(lines[i]);
      out.push(protectedBlock(block.join('\n'), kind));
      continue;
    }
    // Link reference and footnote definitions: kept verbatim (marked would consume them).
    if ((linkDefinition.test(line) || footnoteDefinition.test(line)) && (i === 0 || lines[i - 1].trim() === '')) {
      const block = [line];
      while (++i < lines.length) {
        const next = lines[i];
        const continuation = footnoteDefinition.test(block[block.length - 1]) || /^(?: {4}|\t)\S/.test(block[block.length - 1])
          ? /^(?: {4}|\t)\S/.test(next) : false;
        if (linkDefinition.test(next) || footnoteDefinition.test(next) || continuation) block.push(next);
        else break;
      }
      out.push(protectedBlock(block.join('\n'), 'reference'));
      continue;
    }
    // Per-table style wrapper: `[div class="ve-table-plain"]` / `ve-table-normal` around one table.
    const tableStyle = line.match(tableStyleOpen);
    if (tableStyle) {
      const end = extractShortcode(lines, i);
      if (end > i && lines[end].trim() === '[/div]') {
        const inner = protectBlocks(lines.slice(i + 1, end).join('\n')).trim();
        out.push(`<div data-ve-table-style="${tableStyle[1]}">\n\n${inner}\n\n</div>\n`);
        i = end + 1;
        continue;
      }
    }
    // Block alignment shortcodes (shortcode-core) on their own lines: keep their content editable.
    const align = line.match(alignBlockOpen);
    if (align) {
      const end = extractShortcode(lines, i);
      if (end > i && lines[end].trim() === `[/${align[1]}]`) {
        const inner = protectBlocks(lines.slice(i + 1, end).join('\n')).trim();
        out.push(`<div data-ve-align="${align[1]}">\n\n${inner}\n\n</div>\n`);
        i = end + 1;
        continue;
      }
    }
    // `[div class="ve-block" …]` is the editor's own colored block: keep its content editable.
    if (colorBlockOpen.test(line)) {
      const end = extractShortcode(lines, i);
      if (end > i && lines[end].trim() === '[/div]') {
        const inner = protectBlocks(lines.slice(i + 1, end).join('\n')).trim();
        out.push(`<div data-ve-block="1" data-open="${encodeSource(line.trim())}">\n\n${inner}\n\n</div>\n`);
        i = end + 1;
        continue;
      }
    }
    if (/^\s*\[[a-zA-Z][\w:-]*(?:\s+[^\]]*)?\]/.test(line)) {
      const end = extractShortcode(lines, i);
      if (end >= i) {
        out.push(protectedBlock(lines.slice(i, end + 1).join('\n'), 'shortcode'));
        i = end + 1;
        continue;
      }
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

export function normalizeTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let value = '', escaped = false, code = false;
  for (const char of trimmed) {
    if (escaped) { value += char === '|' || char === '\\' ? char : '\\' + char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '`') code = !code;
    if (char === '|' && !code) { cells.push(value.trim()); value = ''; } else value += char;
  }
  cells.push(value.trim() + (escaped ? '\\' : ''));
  return cells;
}

export function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function markdownTables(source, renderer) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length - 1;) {
    if (!lines[i].includes('|') || !isTableDivider(lines[i + 1])) { i++; continue; }
    const headers = normalizeTableRow(lines[i]);
    const aligns = normalizeTableRow(lines[i + 1]).map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null);
    const body = [];
    let j = i + 2;
    while (j < lines.length && lines[j].includes('|') && lines[j].trim()) { body.push(normalizeTableRow(lines[j])); j++; }
    let html = '<table><thead><tr>' + headers.map((cell, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderer(cell)}</th>`).join('') + '</tr></thead><tbody>';
    html += body.map((row) => '<tr>' + headers.map((_, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderer(row[k] || '')}</td>`).join('') + '</tr>').join('');
    lines.splice(i, j - i, html + '</tbody></table>');
    i++;
  }
  return lines.join('\n');
}

export function githubAlerts(html) {
  return html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*<br\s*\/?>\s*|\n+)?/gi, (_, kind) => `<blockquote class="ve-alert ve-alert-${kind.toLowerCase()}" data-alert="${kind}"><p class="ve-alert-title">${kind.charAt(0) + kind.slice(1).toLowerCase()}</p><p>`)
    .replace(/<p>\s*<\/p>/g, '');
}

export function addMediaAttributes(html, pageMediaUrl = '') {
  if (typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  // Images are block nodes in the editor: a paragraph holding only images would leave an empty
  // paragraph behind when ProseMirror lifts them out, so unwrap it here.
  template.content.querySelectorAll('p').forEach((paragraph) => {
    const nodes = [...paragraph.childNodes].filter((node) => !(node.nodeType === 3 && !node.textContent.trim()));
    if (nodes.length && nodes.every((node) => node.nodeName === 'IMG')) paragraph.replaceWith(...nodes);
    // Images that share their paragraph with text (or sit in a link) stay inline in that paragraph.
    else paragraph.querySelectorAll('img').forEach((img) => img.setAttribute('data-ve-inline', ''));
  });
  template.content.querySelectorAll('img').forEach((img) => {
    img.setAttribute('data-markdown-src', img.getAttribute('src') || '');
    img.setAttribute('alt', img.getAttribute('alt') || '');
    const src = img.getAttribute('src') || '';
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return;
    const resolved = typeof pageMediaUrl === 'function' ? pageMediaUrl(src) : pageMediaUrl + src;
    if (resolved) img.src = resolved;
  });
  return template.innerHTML;
}

export function tableCellToMarkdown(node) {
  let text = inlineChildren(node).trim().replace(/\n+/g, '<br>');
  text = text.replace(/\|/g, '\\|');
  if (node.attrs.colspan > 1 || node.attrs.rowspan > 1) {
    return `<${node.type.name === 'tableHeader' ? 'th' : 'td'} colspan="${node.attrs.colspan}" rowspan="${node.attrs.rowspan}">${text}</${node.type.name === 'tableHeader' ? 'th' : 'td'}>`;
  }
  return text;
}

export function nodeToMarkdown(node, depth = 0) {
  const children = () => node.content ? Array.from({ length: node.childCount }, (_, i) => node.child(i)) : [];
  const blocks = () => children().map((child) => nodeToMarkdown(child, depth)).filter(Boolean).join('\n\n');
  switch (node.type.name) {
    case 'doc': return blocks().trim() + '\n';
    case 'paragraph': return inlineChildren(node);
    case 'heading': return '#'.repeat(node.attrs.level) + ' ' + inlineChildren(node);
    case 'text': return node.text || '';
    case 'hardBreak': return '\\\n';
    case 'protectedBlock': return node.attrs.source;
    case 'tableStyle': {
      const body = blocks();
      return `[div class="ve-table-${node.attrs.style}"]\n\n${body ? body + '\n\n' : ''}[/div]`;
    }
    case 'alignBlock': {
      const body = blocks();
      return `[${node.attrs.align}]\n\n${body ? body + '\n\n' : ''}[/${node.attrs.align}]`;
    }
    case 'colorBlock': {
      const body = blocks();
      return `${node.attrs.open}\n\n${body ? body + '\n\n' : ''}[/div]`;
    }
    case 'inlineImage':
    case 'image': return `![${String(node.attrs.alt || '').replace(/([\[\]\\])/g, '\\$1')}](${node.attrs.src || ''}${node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''})`;
    case 'codeBlock': {
      const language = node.attrs.language || '';
      let length = 3;
      (node.textContent.match(/`+/g) || []).forEach((run) => { length = Math.max(length, run.length + 1); });
      const fence = '`'.repeat(length);
      return fence + language + '\n' + node.textContent + '\n' + fence;
    }
    case 'blockquote': {
      const alert = node.attrs.alert;
      const body = children().filter((child) => child.type.name !== 'alertTitle').map((child) => nodeToMarkdown(child, depth + 1)).join('\n\n');
      return ((alert ? `[!${alert}]\n` : '') + body).split('\n').map((line) => (line ? '> ' + line : '>')).join('\n');
    }
    case 'bulletList': return children().map((child) => '- ' + indentContinuation(nodeToMarkdown(child, depth + 1), 2)).join('\n');
    case 'orderedList': {
      const start = Number(node.attrs.start || 1);
      return children().map((child, i) => {
        const marker = `${start + i}. `;
        return marker + indentContinuation(nodeToMarkdown(child, depth + 1), marker.length);
      }).join('\n');
    }
    case 'listItem': return blocks();
    case 'horizontalRule': return '---';
    case 'table': {
      const rows = children().map((row) => childrenOf(row));
      if (!rows.length) return '';
      const header = rows[0] || [];
      const aligns = header.map((cell) => cell.attrs.align === 'right' ? '---:' : cell.attrs.align === 'center' ? ':---:' : cell.attrs.align === 'left' ? ':---' : '---');
      return [header, ...rows.slice(1)].map((row, i) => {
        const line = '| ' + row.map(tableCellToMarkdown).join(' | ') + ' |';
        return i === 0 ? line + '\n| ' + aligns.join(' | ') + ' |' : line;
      }).join('\n');
    }
    default: return node.isText ? node.text || '' : node.isBlock ? blocks() : inlineChildren(node);
  }
}

function childrenOf(node) { return Array.from({ length: node.childCount }, (_, i) => node.child(i)); }
/** Continuation lines align with the item content (CommonMark); blank lines stay empty. */
function indentContinuation(text, width) { return text.replace(/\n(?!\n|$)/g, '\n' + ' '.repeat(width)); }
/** Inline content; consecutive nodes sharing one link mark are written as a single link. */
function inlineChildren(node) {
  const nodes = childrenOf(node);
  let out = '';
  for (let i = 0; i < nodes.length;) {
    const link = nodes[i].marks?.find((mark) => mark.type.name === 'link');
    if (!link) { out += inlineNodeToMarkdown(nodes[i]); i++; continue; }
    let content = '';
    while (i < nodes.length && nodes[i].marks?.some((mark) => mark.eq(link))) {
      content += inlineNodeToMarkdown(nodes[i], { withoutLink: true });
      i++;
    }
    out += linkMarkdown(content, link.attrs);
  }
  return out;
}

export function inlineNodeToMarkdown(node, { withoutLink = false } = {}) {
  let text = nodeToMarkdown(node);
  if (node.type.name === 'inlineRaw') return node.attrs.source;
  if (node.isText) text = escapeMarkdown(node.text || '');
  const marks = node.marks || [];
  const has = (name) => marks.some((mark) => mark.type.name === name);
  if (has('code')) text = '`' + String(node.text || '').replace(/`/g, '\\`') + '`';
  if (has('bold')) text = '**' + text + '**';
  if (has('italic')) text = '*' + text + '*';
  if (has('strike')) text = '~~' + text + '~~';
  if (has('highlight')) text = '<mark>' + text + '</mark>';
  if (has('superscript')) text = '<sup>' + text + '</sup>';
  if (has('subscript')) text = '<sub>' + text + '</sub>';
  if (has('keyboard')) text = '<kbd>' + text + '</kbd>';
  if (has('citation')) text = '<cite>' + text + '</cite>';
  if (has('abbreviation')) {
    const mark = marks.find((item) => item.type.name === 'abbreviation');
    text = `<abbr title="${String(mark.attrs.title || '').replace(/"/g, '&quot;')}">${text}</abbr>`;
  }
  const link = withoutLink ? null : marks.find((mark) => mark.type.name === 'link');
  if (link) text = linkMarkdown(text, link.attrs);
  return text;
}

export function documentToMarkdown(doc) { return nodeToMarkdown(doc); }

/**
 * Image width as Grav's `cropResize` media action in the Markdown URL (`photo.jpg?cropResize=640`):
 * Grav serves a resized copy, height derived from the aspect ratio, never cropped.
 */
const resizeParam = /^cropResize=(\d+)(?:,\d*)?$/i;

function splitImageUrl(src) {
  const value = String(src ?? '');
  const hashAt = value.indexOf('#');
  const hash = hashAt >= 0 ? value.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? value.slice(0, hashAt) : value;
  const queryAt = beforeHash.indexOf('?');
  return {
    path: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash,
    params: queryAt >= 0 ? beforeHash.slice(queryAt + 1).split('&').filter(Boolean) : [],
    hash,
  };
}

/** The `cropResize` width of a Markdown image URL, or null. */
export function imageWidth(src) {
  for (const param of splitImageUrl(src).params) {
    const match = param.match(resizeParam);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Sets (or, with a falsy width, removes) the `cropResize` width; other Grav media actions are kept in order. */
export function withImageWidth(src, width) {
  const { path, params, hash } = splitImageUrl(src);
  const kept = params.filter((param) => !resizeParam.test(param));
  const size = Math.round(Number(width) || 0);
  if (size > 0) kept.push(`cropResize=${size}`);
  return path + (kept.length ? '?' + kept.join('&') : '') + hash;
}

/**
 * Colored blocks are shortcode-core `[div]` shortcodes marked with the `ve-block` class, so Grav renders
 * them without raw HTML: `[div class="ve-block" style="background-color:#fde2e4;color:#1f2329;…"]`.
 */
/** Table look: `plain` (no background or borders) or `normal` (theme look, even when tables are plain site-wide). */
export const tableStyles = ['plain', 'normal'];
const tableStyleOpen = /^\s*\[div class="ve-table-(plain|normal)"\]\s*$/;

/** shortcode-core's block alignment shortcodes: `[center]` … `[/center]`, each tag on its own line. */
export const alignments = ['left', 'center', 'right', 'justify'];
const alignBlockOpen = /^\s*\[(left|center|right|justify)\]\s*$/;

const colorBlockOpen = /^\s*\[div\b(?=[^\]]*\bve-block\b)[^\]]*\]\s*$/;
const hexColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value) { return hexColor.test(String(value ?? '').trim()); }

/** The background color written in a colored block's opening tag. */
export function colorFromOpen(open) {
  const match = String(open ?? '').match(/background(?:-color)?\s*:\s*([^;"\]]+)/i);
  return match ? match[1].trim() : '';
}

/** Dark or white text, whichever reads better on the background (WCAG relative luminance). */
export function contrastText(color) {
  const value = String(color ?? '').trim();
  let rgb = null;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    let hex = value.slice(1);
    if (hex.length <= 4) hex = hex.replace(/./g, '$&$&');
    rgb = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  } else {
    const match = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (match) rgb = match.slice(1, 4).map(Number);
  }
  if (!rgb) return '#1f2329';
  const [r, g, b] = rgb.map((value8) => {
    const channel = value8 / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.36 ? '#1f2329' : '#ffffff';
}

/** Opening tag for a colored block; with an existing tag, only its background and text colors change. */
export function colorBlockTag(color, open = '') {
  const background = isHexColor(color) ? color.trim().toLowerCase() : '#fde2e4';
  const text = contrastText(background);
  if (!open) {
    return `[div class="ve-block" style="background-color:${background};color:${text};padding:1em 1.25em;border-radius:8px;margin:1em 0"]`;
  }
  let tag = open.replace(/(background(?:-color)?\s*:\s*)[^;"\]]+/i, `$1${background}`);
  tag = /([;"\s])color\s*:/i.test(tag)
    ? tag.replace(/([;"\s])(color\s*:\s*)[^;"\]]+/i, `$1$2${text}`)
    : tag.replace(/(background(?:-color)?\s*:\s*[^;"\]]+)/i, `$1;color:${text}`);
  return tag;
}

/**
 * Link reference definitions (`[label]: url "title"`) and footnote definitions (`[^id]: text`).
 * Definitions are protected verbatim; reference usages are resolved here so they display as links
 * and keep their form (`[text][label]`, `[label][]`, `[label]`) when saved.
 */
const linkDefinition = /^ {0,3}\[(?!\^)([^\]\n]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?[ \t]*$/;
const footnoteDefinition = /^ {0,3}\[\^[^\]\s]+\]:/;

const normalizeLabel = (label) => String(label).trim().replace(/\s+/g, ' ').toLowerCase();

/** label (normalized) → { href, title }, ignoring fenced code. First definition wins, as in CommonMark. */
export function referenceDefinitions(markdown) {
  const definitions = new Map();
  let fence = null;
  for (const line of String(markdown).replace(/\r\n?/g, '\n').split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(linkDefinition);
    if (match && !definitions.has(normalizeLabel(match[1]))) {
      definitions.set(normalizeLabel(match[1]), { href: match[2], title: match[3] ?? match[4] ?? match[5] ?? '' });
    }
  }
  return definitions;
}

/** Turn reference usages into `<a data-ve-ref>` so the editor shows links and can write the same form back. */
export function resolveReferences(source, definitions) {
  if (!definitions.size) return source;
  const usage = /(`+)[\s\S]*?\1|(\\?)(!?)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?(?![(:[])/g;
  return String(source).replace(usage, (raw, ticks, escaped, bang, text, label) => {
    if (ticks || escaped || bang) return raw;
    const form = label === undefined ? 'shortcut' : label === '' ? 'collapsed' : 'full';
    const key = form === 'full' ? label : text;
    const target = definitions.get(normalizeLabel(key));
    if (!target) return raw;
    const title = target.title ? ` title="${escapeHtml(target.title)}"` : '';
    return `<a href="${escapeHtml(target.href)}"${title} data-ve-ref="${escapeHtml(key)}" data-ve-ref-form="${form}">${text}</a>`;
  });
}

/** Markdown for a link around already-serialized content, in its original reference form when it had one. */
export function linkMarkdown(content, attrs) {
  const reference = attrs.reference;
  if (reference) {
    const form = attrs.referenceForm;
    if (form === 'shortcut' && content === reference) return `[${content}]`;
    if (form === 'collapsed' && content === reference) return `[${content}][]`;
    return `[${content}][${reference}]`;
  }
  return `[${content}](${attrs.href || ''}${attrs.title ? ` "${String(attrs.title).replace(/"/g, '\\"')}"` : ''})`;
}
