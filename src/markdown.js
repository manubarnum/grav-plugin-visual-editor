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

const inlinePattern = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}|(?<!!)\[\/?[a-zA-Z][\w:-]*(?:\s+[^\]\n]*)?\](?![(\[:]))|<\/?(?:span|abbr|cite|kbd|mark|sup|sub)(?:\s+[^<>]*)?>/g;

/** Unknown HTML/Twig is never silently interpreted as editable prose. */
export function protectInline(source) {
  return String(source).replace(inlinePattern, (raw) => `<ve-inline data-source="${encodeSource(raw)}"></ve-inline>`);
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
  template.content.querySelectorAll('img').forEach((img) => {
    img.setAttribute('data-markdown-src', img.getAttribute('src') || '');
    img.setAttribute('alt', img.getAttribute('alt') || '');
    const src = img.getAttribute('src') || '';
    if (!/^(?:[a-z]+:|\/|#|data:)/i.test(src)) img.src = pageMediaUrl + src;
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
function inlineChildren(node) { return childrenOf(node).map(inlineNodeToMarkdown).join(''); }

export function inlineNodeToMarkdown(node) {
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
  const link = marks.find((mark) => mark.type.name === 'link');
  if (link) text = `[${text}](${link.attrs.href || ''}${link.attrs.title ? ` "${String(link.attrs.title).replace(/"/g, '\\"')}"` : ''})`;
  return text;
}

export function documentToMarkdown(doc) { return nodeToMarkdown(doc); }
