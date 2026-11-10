/** VisualEditor methods — Tables: insertion, cell commands and per-table style. Mixed into VisualEditor.prototype in ../editor.js. */
import { TextSelection } from '@tiptap/pm/state';
import { tableStyles } from '../markdown.js';
import { shortcodeContainers } from './ui.js';

export const tableMethods = {
  tableDialog() {
    if (this.editor.isActive('table')) { this.editor.chain().focus().run(); return; }
    this.dialog('Insert table', [
      { name: 'rows', label: 'Rows', type: 'number', min: 1, max: 30, value: 3, required: true },
      { name: 'columns', label: 'Columns', type: 'number', min: 1, max: 12, value: 3, required: true },
    ], ({ rows, columns }) => {
      const rowCount = Math.max(1, Math.min(30, Number(rows) || 1));
      const columnCount = Math.max(1, Math.min(12, Number(columns) || 1));
      const row = (cell) => ({ type: 'tableRow', content: Array.from({ length: columnCount }, () => ({ type: cell, content: [{ type: 'paragraph' }] })) });
      const table = { type: 'table', content: [row('tableHeader'), ...Array.from({ length: rowCount - 1 }, () => row('tableCell'))] };
      // After the current block (insertTable would split the paragraph at the cursor); cursor in the first cell.
      const { target, at } = this.blockInsertionTarget();
      this.editor.chain().focus().insertContentAt(target, table).setTextSelection(at + 4).run();
    });
  },

  /** Table look: site default (no wrapper), or a `plain` / `normal` wrapper around this table. */
  tableStyleDialog() {
    const table = this.findAncestor('table');
    if (!table) return;
    const wrapper = this.findAncestor('tableStyle');
    const parent = this.editor.state.doc.resolve(table.pos).parent.type.name;
    this.dialog('Table style', [
      { name: 'style', label: 'Look of this table', type: 'select', value: wrapper?.node.attrs.style || 'default', options: [
        ['default', this.config.plainTables ? 'Site default (no background or borders)' : 'Site default (background and borders)'],
        ['plain', 'No background or borders'],
        ['normal', 'Background and borders'],
      ] },
    ], ({ style }) => {
      if (wrapper) {
        if (style === 'default') return this.unwrapBlock(wrapper);
        if (tableStyles.includes(style)) this.editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(wrapper.pos, undefined, { style }); return true; }).run();
        return;
      }
      if (!tableStyles.includes(style)) return;
      // The wrapper is a shortcode: its tags must start their line, so not inside a list or quote.
      if (!shortcodeContainers.includes(parent)) return this.notify('Move the table out of the list or quote to change its style.', true);
      const type = this.editor.state.schema.nodes.tableStyle;
      const { from, to } = this.editor.state.selection;
      this.editor.chain().focus().command(({ tr }) => {
        tr.replaceWith(table.pos, table.pos + table.node.nodeSize, type.create({ style }, table.node));
        // The wrapper adds one opening position before the table: keep the cursor in the same cell.
        tr.setSelection(TextSelection.between(tr.doc.resolve(from + 1), tr.doc.resolve(to + 1)));
        return true;
      }).run();
    });
  },

  tableCommand(command) {
    if (command === 'tableStyle') return this.tableStyleDialog();
    // A style wrapper cannot stay empty: delete it with its table.
    const wrapper = command === 'deleteTable' ? this.findAncestor('tableStyle') : null;
    if (wrapper) return this.editor.chain().focus().command(({ tr }) => { tr.delete(wrapper.pos, wrapper.pos + wrapper.node.nodeSize); return true; }).run();
    const chain = this.editor.chain().focus();
    if (command.startsWith('align')) return chain.setCellAttribute('align', command.slice(5).toLowerCase()).run();
    return chain[command]().run();
  },
};
