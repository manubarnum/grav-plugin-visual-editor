/** VisualEditor methods — Block-level features: alignment, colored blocks, alerts, protected HTML/Twig/shortcode blocks. Mixed into VisualEditor.prototype in ../editor.js. */
import { TextSelection } from '@tiptap/pm/state';
import { alertKinds, alignments, colorBlockTag, colorFromOpen, isHexColor } from '../markdown.js';
import { shortcodeContainers } from './ui.js';
import { t } from '../i18n.js';

export const blockMethods = {
  /**
   * Insert a GitHub-style alert after the current block (or in place of an empty paragraph), built as
   * one node: wrapping the selection and patching the title afterwards reused a finished command chain
   * and stale positions, so nothing was inserted.
   */
  alertDialog() {
    this.dialog('Insert alert', [
      { name: 'kind', label: 'Type', type: 'select', options: alertKinds.map((kind) => [kind, kind.charAt(0) + kind.slice(1).toLowerCase()]) },
      { name: 'text', label: 'Message', type: 'textarea', value: t('Write something worth noticing.') },
    ], ({ kind, text }) => {
      if (!alertKinds.includes(kind)) return;
      const paragraphs = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const alert = {
        type: 'blockquote',
        attrs: { alert: kind },
        content: [
          { type: 'alertTitle', attrs: { kind } },
          ...(paragraphs.length ? paragraphs : ['']).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
        ],
      };
      this.editor.chain().focus().insertContentAt(this.blockInsertionTarget().target, alert).run();
    });
  },

  /**
   * Where a new block goes: after the current block that sits directly in the document (or in a
   * colored/aligned block), or in place of it when it is an empty paragraph — never splitting a paragraph.
   * `at` is the position the new block starts at.
   */
  blockInsertionTarget() {
    const { $from, to } = this.editor.state.selection;
    let depth = $from.depth;
    while (depth > 1 && !shortcodeContainers.includes($from.node(depth - 1).type.name)) depth -= 1;
    if (depth < 1) return { target: to, at: to };
    const block = $from.node(depth);
    if (block.type.name === 'paragraph' && block.content.size === 0) {
      return { target: { from: $from.before(depth), to: $from.after(depth) }, at: $from.before(depth) };
    }
    return { target: $from.after(depth), at: $from.after(depth) };
  },

  /** The nearest block of `type` around the cursor, if any. */
  findAncestor(type) {
    const { $from } = this.editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === type) return { node, pos: $from.before(depth) };
    }
    return null;
  },

  findColorBlock() { return this.findAncestor('colorBlock'); },

  /**
   * Wrap the selected blocks in a shortcode block. Shortcode tags must start their line, so the wrap
   * happens at the document (or another shortcode block) level: a whole list or quote, never inside it.
   */
  wrapBlocks(type, attrs) {
    const { state } = this.editor;
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, (node) => shortcodeContainers.includes(node.type.name));
    if (!range) return false;
    this.editor.chain().focus().command(({ tr }) => { tr.wrap(range, [{ type: state.schema.nodes[type], attrs }]); return true; }).run();
    return true;
  },

  /** Replace a wrapper by its content, keeping the cursor where it was in that content. */
  unwrapBlock({ node, pos }) {
    const { from, to } = this.editor.state.selection;
    const inside = from > pos && to < pos + node.nodeSize;
    this.editor.chain().focus().command(({ tr }) => {
      tr.replaceWith(pos, pos + node.nodeSize, node.content);
      if (inside) tr.setSelection(TextSelection.between(tr.doc.resolve(from - 1), tr.doc.resolve(to - 1)));
      return true;
    }).run();
  },

  /** Left is the default alignment: choosing it removes the alignment block. Tables align the column instead. */
  setAlignment(align) {
    if (!alignments.includes(align)) return;
    if (this.editor.isActive('table')) return this.tableCommand(`align${align[0].toUpperCase()}${align.slice(1)}`);
    const current = this.findAncestor('alignBlock');
    if (current) {
      if (align === 'left') return this.unwrapBlock(current);
      this.editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(current.pos, undefined, { align }); return true; }).run();
      return;
    }
    if (align !== 'left' && !this.wrapBlocks('alignBlock', { align })) this.notify('This selection cannot be aligned.', true);
  },

  currentAlignment() {
    if (this.editor.isActive('table')) return null;
    return this.findAncestor('alignBlock')?.node.attrs.align || 'left';
  },

  colorBlockDialog() {
    const current = this.findColorBlock();
    const presets = [['#fde2e4', 'Rose'], ['#fff1c1', 'Yellow'], ['#e3f4e1', 'Green'], ['#ddeefc', 'Blue'], ['#ece4fb', 'Lavender'], ['#f1f1ef', 'Grey']];
    const color = current ? (colorFromOpen(current.node.attrs.open) || current.node.attrs.color) : presets[0][0];
    const isPreset = presets.some(([value]) => value === color.toLowerCase());
    this.dialog(current ? 'Block background color' : 'Colored block', [
      { name: 'preset', label: 'Background color', type: 'select', options: [...presets, ['custom', 'Custom color (below)']], value: isPreset ? color.toLowerCase() : 'custom' },
      { name: 'custom', label: 'Custom color', type: 'color', value: isHexColor(color) ? color : '#fde2e4' },
    ], ({ preset, custom }) => {
      const chosen = preset === 'custom' ? custom : preset;
      if (!isHexColor(chosen)) return this.notify('Choose a valid color.', true);
      if (current) {
        this.editor.chain().focus().command(({ tr }) => {
          tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, open: colorBlockTag(chosen, current.node.attrs.open), color: chosen });
          return true;
        }).run();
      } else if (!this.wrapBlocks('colorBlock', { open: colorBlockTag(chosen), color: chosen })) {
        this.notify('This selection cannot be placed in a colored block.', true);
      }
    }, current ? () => this.removeColorBlock(current) : null, 'Remove colored block');
  },

  /** Unwrap: the block's content stays in place, only the colored frame goes. */
  removeColorBlock(block) { this.unwrapBlock(block); },

  rawDialog() {
    this.dialog('Protected HTML or Twig', [
      { name: 'kind', label: 'Block type', type: 'select', options: [['html', 'HTML'], ['twig', 'Twig']] },
      { name: 'source', label: 'Source', type: 'textarea', required: true, value: '<div class="notice">\n  Your content\n</div>' },
    ], ({ kind, source }) => this.insertBlock({ source, kind }));
  },

  shortcodeDialog() {
    const custom = [...(window.GravVisualEditorShortcodes || []), ...(Array.isArray(this.config.shortcodes) ? this.config.shortcodes : Object.values(this.config.shortcodes || {}))];
    const options = [['custom', 'Custom shortcode'], ...custom.map((item) => [item.name, item.label || item.name])];
    this.dialog('Insert shortcode', [
      { name: 'preset', label: 'Shortcode', type: 'select', options },
      { name: 'name', label: 'Name', value: 'notice' },
      { name: 'attributes', label: 'Attributes', value: 'type="info"' },
      { name: 'content', label: 'Content (leave empty for a self-closing block)', type: 'textarea' },
    ], (values) => {
      const preset = custom.find((item) => item.name === values.preset);
      const name = (preset?.name || values.name).replace(/[^\w:-]/g, '');
      if (!name) return;
      const attrs = (preset?.attributes || values.attributes || '').trim();
      const content = preset?.content || values.content;
      const source = content ? `[${name}${attrs ? ' ' + attrs : ''}]\n${content}\n[/${name}]` : `[${name}${attrs ? ' ' + attrs : ''}]`;
      this.insertBlock({ source, kind: 'shortcode' });
    });
  },

  editSourceDialog(attrs, apply) {
    this.dialog(t('Edit {kind} source', { kind: t(attrs.kind === 'shortcode' ? 'shortcode' : attrs.kind === 'code' ? 'code block' : attrs.kind.toUpperCase()) }), [
      { name: 'source', label: 'Source (kept exactly as written)', type: 'textarea', required: true, value: attrs.source },
    ], ({ source }) => apply(source));
  },

  insertBlock(attributes) {
    this.editor.chain().focus().insertContent({ type: 'protectedBlock', attrs: { ...attributes, preview: '' } }).run();
  },
};
