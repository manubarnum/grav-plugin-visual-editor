import { Node, Mark, mergeAttributes, Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import ListItem from '@tiptap/extension-list-item';
import Code from '@tiptap/extension-code';
import Link from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Typography from '@tiptap/extension-typography';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { alertKinds, addMediaAttributes, colorFromOpen, referenceDefinitions, resolveReferences, contrastText, documentToMarkdown, escapeHtml, githubAlerts, imageWidth, markdownTables, protectBlocks, protectInline, withImageWidth } from './markdown.js';

marked.setOptions({ gfm: true, breaks: false });

function inlineMark(name, tag, attributes = {}) {
  return Mark.create({
    name,
    inclusive: false,
    addAttributes() { return attributes; },
    parseHTML() { return [{ tag }]; },
    renderHTML({ HTMLAttributes }) { return [tag, mergeAttributes(HTMLAttributes), 0]; },
    addCommands() {
      return {
        [`toggle${name[0].toUpperCase()}${name.slice(1)}`]: (attrs) => ({ commands }) => commands.toggleMark(name, attrs),
      };
    },
  });
}

const Keyboard = inlineMark('keyboard', 'kbd');
const Citation = inlineMark('citation', 'cite');
const Abbreviation = inlineMark('abbreviation', 'abbr', {
  title: { default: '', parseHTML: (element) => element.getAttribute('title') || '' },
});

const ImageWithSource = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, parseHTML: (element) => element.getAttribute('data-markdown-src') || element.getAttribute('src') },
    };
  },
  addOptions() { return { ...this.parent?.(), resolve: null }; },
  renderHTML({ HTMLAttributes }) {
    const { align, float, ...attributes } = HTMLAttributes;
    // Markdown keeps the page-relative path; the editor shows the resolved media URL.
    const markdownSrc = attributes.src || '';
    const display = resolveMedia(this.options.resolve, markdownSrc);
    const width = imageWidth(markdownSrc);
    return ['img', mergeAttributes(attributes, { src: display, 'data-markdown-src': markdownSrc }, width ? { style: `width:${width}px` } : {})];
  },
  /** Shows the image at its `cropResize` width with a corner handle; dragging rewrites that width. */
  addNodeView() {
    const options = this.options;
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 've-image';
      dom.contentEditable = 'false';
      const image = document.createElement('img');
      const handle = document.createElement('span');
      handle.className = 've-image-resize';
      handle.title = 'Drag to resize';
      handle.setAttribute('aria-hidden', 'true');
      dom.append(image, handle);

      const render = () => {
        const src = node.attrs.src || '';
        const display = resolveMedia(options.resolve, src);
        if (image.getAttribute('src') !== display) image.setAttribute('src', display);
        image.setAttribute('data-markdown-src', src);
        image.alt = node.attrs.alt || '';
        if (node.attrs.title) image.title = node.attrs.title; else image.removeAttribute('title');
        const width = imageWidth(src);
        image.style.width = width ? `${width}px` : '';
        dom.dataset.width = width ? `${width}px` : 'Original';
      };
      render();

      handle.addEventListener('pointerdown', (event) => {
        if (!editor.isEditable || typeof getPos !== 'function') return;
        event.preventDefault(); event.stopPropagation();
        const startX = event.clientX;
        const startWidth = image.getBoundingClientRect().width || image.width || 0;
        const natural = image.naturalWidth || Infinity;
        let width = startWidth;
        dom.classList.add('is-resizing');
        const move = (moveEvent) => {
          width = Math.max(40, Math.min(natural, Math.round(startWidth + moveEvent.clientX - startX)));
          image.style.width = `${width}px`;
          dom.dataset.width = `${width}px`;
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
          dom.classList.remove('is-resizing');
          if (Math.round(width) === Math.round(startWidth)) return;
          // At (or above) the file's own width, drop the resize so Grav serves the original.
          const src = withImageWidth(node.attrs.src, width >= natural ? null : width);
          editor.chain().command(({ tr }) => { tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, src }); return true; }).run();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
      });

      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated; render(); return true;
        },
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
        stopEvent(event) { return event.target === handle; },
        ignoreMutation() { return true; },
      };
    };
  },
});

/**
 * Inline code still excludes every formatting mark (as TipTap's `excludes: '_'` did) but allows a link
 * around it: otherwise `[use \`x\`](url)` lost its link on the code part when loaded.
 */
const CodeInLink = Code.extend({
  excludes: 'bold italic strike highlight subscript superscript keyboard citation abbreviation',
});

/** Links remember a reference-style origin (`[text][label]`) so they are saved in the same form. */
const ReferenceLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // TipTap's Link has no title: without it `[text](url "Title")` lost its title on save.
      title: { default: null, parseHTML: (element) => element.getAttribute('title') },
      reference: { default: null, parseHTML: (element) => element.getAttribute('data-ve-ref'), renderHTML: (attrs) => (attrs.reference ? { 'data-ve-ref': attrs.reference } : {}) },
      referenceForm: { default: null, parseHTML: (element) => element.getAttribute('data-ve-ref-form'), renderHTML: (attrs) => (attrs.referenceForm ? { 'data-ve-ref-form': attrs.referenceForm } : {}) },
    };
  },
});

/** An image inside a sentence (or a link): inline, so its paragraph is not split. Standalone images stay blocks. */
const InlineImage = Node.create({
  name: 'inlineImage', inline: true, group: 'inline', atom: true, draggable: true,
  addOptions() { return { resolve: null }; },
  addAttributes() {
    return {
      src: { default: null, parseHTML: (element) => element.getAttribute('data-markdown-src') || element.getAttribute('src') },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'img[data-ve-inline]', priority: 60 }]; },
  renderHTML({ HTMLAttributes }) {
    const markdownSrc = HTMLAttributes.src || '';
    return ['img', mergeAttributes(HTMLAttributes, { src: resolveMedia(this.options.resolve, markdownSrc), 'data-markdown-src': markdownSrc, 'data-ve-inline': '', class: 've-inline-image' })];
  },
});

/** Resolves a Markdown image path for display; `resolver` is a URL prefix or a function. */
export function resolveMedia(resolver, src) {
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return src;
  if (typeof resolver === 'function') return resolver(src) || src;
  return resolver ? resolver + src : src;
}

const blockedPreviewTags = 'script,iframe,object,embed,link,meta,base,form,style';
/** Shortcode previews are server HTML shown inside the admin: drop active content before inserting it. */
export function sanitizePreview(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  template.content.querySelectorAll(blockedPreviewTags).forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || (['href', 'src', 'xlink:href', 'action', 'formaction'].includes(name) && /^\s*(?:javascript|data|vbscript):/i.test(attribute.value))) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.content;
}

const BlockquoteWithAlert = Node.create({
  name: 'blockquote', content: 'block+', group: 'block', defining: true,
  addAttributes() {
    return { alert: { default: null, parseHTML: (element) => element.getAttribute('data-alert') } };
  },
  parseHTML() { return [{ tag: 'blockquote' }]; },
  renderHTML({ HTMLAttributes }) {
    const alert = HTMLAttributes.alert;
    return ['blockquote', mergeAttributes(HTMLAttributes, alert ? { class: `ve-alert ve-alert-${alert.toLowerCase()}` } : {}), 0];
  },
  addCommands() {
    return {
      setBlockquote: () => ({ commands }) => commands.wrapIn(this.name),
      toggleBlockquote: () => ({ commands }) => commands.toggleWrap(this.name),
      unsetBlockquote: () => ({ commands }) => commands.lift(this.name),
      setAlert: (kind) => ({ commands }) => commands.updateAttributes(this.name, { alert: kind }),
    };
  },
});

/** A table with its own look, saved as `[div class="ve-table-plain|normal"]` around the table. */
const TableStyle = Node.create({
  name: 'tableStyle', group: 'block', content: 'table', defining: true, isolating: true,
  addAttributes() { return { style: { default: 'plain' } }; },
  parseHTML() {
    return [{ tag: 'div[data-ve-table-style]', getAttrs: (element) => ({ style: element.getAttribute('data-ve-table-style') === 'normal' ? 'normal' : 'plain' }) }];
  },
  renderHTML({ node }) { return ['div', { class: 've-table-style', 'data-style': node.attrs.style }, 0]; },
});

/** Editable aligned block, saved as shortcode-core `[center]` … `[/center]` (also left/right/justify). */
const AlignBlock = Node.create({
  name: 'alignBlock', group: 'block', content: 'block+', defining: true,
  addAttributes() { return { align: { default: 'center' } }; },
  parseHTML() {
    return [{ tag: 'div[data-ve-align]', getAttrs: (element) => ({ align: element.getAttribute('data-ve-align') || 'center' }) }];
  },
  renderHTML({ node }) {
    return ['div', { class: 've-align-block', 'data-align': node.attrs.align, style: `text-align:${node.attrs.align}` }, 0];
  },
});

/** Editable colored block, saved as a shortcode-core `[div class="ve-block" style="…"]` (see markdown.js). */
const ColorBlock = Node.create({
  name: 'colorBlock', group: 'block', content: 'block+', defining: true,
  addAttributes() {
    return {
      open: { default: '' },
      color: { default: '#fde2e4' },
    };
  },
  parseHTML() {
    return [{
      tag: 'div[data-ve-block]',
      getAttrs: (element) => {
        const open = element.getAttribute('data-open') || '';
        return { open, color: colorFromOpen(open) || '#fde2e4' };
      },
    }];
  },
  renderHTML({ node }) {
    const color = node.attrs.color;
    return ['div', { class: 've-color-block', 'data-ve-block': '1', style: `background-color:${color};color:${contrastText(color)}` }, 0];
  },
});

const AlertTitle = Node.create({
  name: 'alertTitle', content: 'inline*', group: 'block', isolating: true, selectable: false,
  addAttributes() { return { kind: { default: 'NOTE' } }; },
  // Must outrank StarterKit's generic `p` rule, which is registered first.
  parseHTML() { return [{ tag: 'p.ve-alert-title', priority: 60, getAttrs: (element) => ({ kind: element.getAttribute('data-alert-title') || element.textContent.toUpperCase() }) }]; },
  renderHTML({ node }) {
    const kind = node.attrs.kind || 'NOTE';
    return ['p', { class: 've-alert-title', 'data-alert-title': kind, contenteditable: 'false' }, kind.charAt(0) + kind.slice(1).toLowerCase()];
  },
});

const ProtectedBlock = Node.create({
  name: 'protectedBlock', group: 'block', atom: true, selectable: true, draggable: true,
  addAttributes() {
    return {
      source: { default: '' }, kind: { default: 'html' },
      preview: { default: '' },
    };
  },
  parseHTML() { return [{ tag: 've-protected', getAttrs: (element) => ({ source: element.getAttribute('data-source'), kind: element.getAttribute('data-kind') }) }]; },
  renderHTML() { return ['ve-protected', { contenteditable: 'false' }]; },
  /** Host hooks: `preview(source) → html`, `editSource(attrs, apply)`, `notify(message, isError)`. */
  addOptions() { return { preview: null, editSource: null, notify: null }; },
  addNodeView() {
    const options = this.options;
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('section');
      dom.className = `ve-protected ve-protected-${node.attrs.kind}`;
      dom.contentEditable = 'false';
      const header = document.createElement('div'); header.className = 've-protected-header';
      const label = document.createElement('span');
      const names = { twig: 'Twig', html: 'HTML', shortcode: 'Shortcode', code: 'Code block' };
      label.textContent = names[node.attrs.kind] || 'Protected source';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit source';
      const previewButton = document.createElement('button'); previewButton.type = 'button'; previewButton.textContent = 'Preview';
      previewButton.hidden = node.attrs.kind !== 'shortcode' || typeof options.preview !== 'function';
      header.append(label, edit, previewButton); dom.append(header);
      const pre = document.createElement('pre'); pre.textContent = node.attrs.source; dom.append(pre);
      let preview;
      const apply = (value) => {
        if (value === null || value === undefined || typeof getPos !== 'function') return;
        editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, source: String(value) }); return true; }).run();
      };
      edit.addEventListener('click', () => {
        // window.prompt is single-line and would flatten multi-line HTML/Twig: prefer the host dialog.
        if (typeof options.editSource === 'function') options.editSource({ ...node.attrs }, apply);
        else apply(window.prompt('Edit the source without changing its format:', node.attrs.source));
      });
      previewButton.addEventListener('click', async () => {
        previewButton.disabled = true;
        try {
          const html = await options.preview(node.attrs.source);
          preview = preview || document.createElement('div');
          preview.className = 've-shortcode-preview';
          preview.replaceChildren(sanitizePreview(html));
          if (!preview.isConnected) dom.append(preview);
          else preview.hidden = !preview.hidden;
        } catch (error) {
          options.notify?.(error.message || 'Preview is unavailable.', true);
        } finally { previewButton.disabled = false; }
      });
      return { dom, update(updated) { if (updated.type.name !== 'protectedBlock') return false; node = updated; pre.textContent = node.attrs.source; return true; } };
    };
  },
});

const InlineRaw = Node.create({
  name: 'inlineRaw', inline: true, group: 'inline', atom: true,
  addAttributes() { return { source: { default: '' } }; },
  parseHTML() { return [{ tag: 've-inline', getAttrs: (element) => ({ source: element.getAttribute('data-source') }) }]; },
  renderHTML({ node }) { return ['span', { class: 've-inline-raw', 'data-source': node.attrs.source, title: node.attrs.source }, node.attrs.source]; },
});

const BlockDrag = Extension.create({
  name: 'blockDrag',
  addProseMirrorPlugins() { return [blockHandlePlugin()]; },
});

/** ProseMirror decorations supply native block dragging without moving DOM nodes manually. */
export function blockHandlePlugin() {
  const key = new PluginKey('visualEditorBlockHandle');
  return new Plugin({
    key,
    state: { init: () => ({ pos: null }), apply(tr, old) { return tr.docChanged && old.pos !== null ? { pos: tr.mapping.map(old.pos) } : old; } },
    props: {
      decorations(state) {
        if (state.selection instanceof CellSelection) return DecorationSet.empty;
        const $pos = state.selection.$anchor;
        if ($pos.depth < 1) return DecorationSet.empty;
        let depth = $pos.depth;
        while (depth > 1 && ['listItem', 'blockquote', 'tableRow', 'tableCell', 'tableHeader'].includes($pos.node(depth).type.name)) depth--;
        const pos = $pos.before(depth);
        const node = $pos.node(depth);
        const widget = document.createElement('button');
        widget.type = 'button'; widget.className = 've-drag-handle'; widget.title = 'Drag to reorder this block';
        widget.setAttribute('aria-label', 'Drag to reorder this block'); widget.textContent = '⠿';
        widget.addEventListener('click', () => {
          widget.dispatchEvent(new CustomEvent('visual-editor-select-block', { bubbles: true, detail: { pos } }));
        });
        widget.addEventListener('mousedown', () => {
          widget.draggable = true;
          const view = widget.closest('.ProseMirror')?._veView;
          if (view) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        });
        widget.addEventListener('dragstart', (event) => {
          const view = widget.closest('.ProseMirror')?._veView;
          if (!view) { event.preventDefault(); return; }
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
          view.dragging = { slice: view.state.doc.slice(pos, pos + node.nodeSize), move: true };
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', node.textContent || node.type.name);
            const rect = node.type.name === 'protectedBlock' ? widget.parentElement : null;
            if (rect) event.dataTransfer.setDragImage(rect, 16, 16);
          }
        });
        return DecorationSet.create(state.doc, [Decoration.widget(pos, widget, { side: -1, key: 'block-handle' })]);
      },
      handleDOMEvents: {
        mousedown(view, event) {
          if (!event.target.closest('.ve-drag-handle')) return false;
          const pos = view.posAtDOM(event.target, 0);
          view.dom._veView = view;
          return false;
        },
      },
    },
  });
}

/** `pageMediaUrl` is a URL prefix or a `(src) => url` resolver for page-relative images. */
export function markdownToHtml(markdown, pageMediaUrl = '') {
  const protectedMarkdown = resolveReferences(protectBlocks(markdown), referenceDefinitions(markdown));
  const parsed = markdownTables(protectedMarkdown, (cell) => marked.parseInline(protectInline(cell)));
  const parsedWithInline = protectInline(parsed);
  return addMediaAttributes(githubAlerts(marked.parse(parsedWithInline)), pageMediaUrl);
}

/** Used for unrecognized inline HTML: serializes to its source instead of dropping it. */
export function fallbackTurndown(html) {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', br: '\\' });
  service.use(gfm);
  service.keep(['abbr', 'cite', 'kbd', 'mark', 'sup', 'sub']);
  return service.turndown(html);
}

/** Column alignment from Markdown divider rows (`:---:`), serialized back by nodeToMarkdown. */
const alignAttribute = {
  align: {
    default: null,
    parseHTML: (element) => element.style.textAlign || element.getAttribute('align') || null,
    renderHTML: (attributes) => (attributes.align ? { style: `text-align:${attributes.align}` } : {}),
  },
};
const AlignedTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttribute }; } });
const AlignedTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttribute }; } });

/**
 * Markdown allows any block first in a list item (`- > quote`, `- ```code`). With TipTap's default
 * `paragraph block*`, ProseMirror would hoist such a block out of the list and leave an empty item.
 */
const FlexibleListItem = ListItem.extend({ content: 'block+' });

export function createExtensions(config) {
  return [
    StarterKit.configure({ blockquote: false, codeBlock: false, code: false, link: false, listItem: false }),
    CodeInLink,
    FlexibleListItem,
    ReferenceLink.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: null } }),
    CodeBlock,
    ImageWithSource.configure({ inline: false, allowBase64: false, resolve: config.resolveMediaUrl || config.pageMediaUrl || null }),
    InlineImage.configure({ resolve: config.resolveMediaUrl || config.pageMediaUrl || null }),
    Highlight.configure({ multicolor: false }),
    Subscript, Superscript, Keyboard, Citation, Abbreviation,
    BlockquoteWithAlert, AlertTitle, ColorBlock, AlignBlock, TableStyle, ProtectedBlock.configure(config.hooks || {}), InlineRaw,
    Table.configure({ resizable: true, lastColumnResizable: true, cellMinWidth: 64 }), TableRow, AlignedTableHeader, AlignedTableCell,
    ...(config.smartTypography ? [Typography] : []),
    BlockDrag,
  ];
}

export { ProtectedBlock, InlineRaw, Keyboard, Citation, Abbreviation, documentToMarkdown };
