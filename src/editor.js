import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createExtensions, documentToMarkdown, markdownToHtml } from './extensions.js';
import { alertKinds, escapeHtml } from './markdown.js';

const icons = {
  undo: '↶', redo: '↷', heading: 'H', bold: 'B', italic: 'I', strike: 'S', link: '🔗', image: '▧',
  bulletList: '•≡', orderedList: '1.≡', blockquote: '❝', alert: 'ⓘ', table: '⊞', codeBlock: '{ }',
  raw: '</>', shortcode: '[ ]', source: '⌘', more: '⋯', highlight: '▰', subscript: 'x₂', superscript: 'x²',
  keyboard: '⌨', citation: 'C', abbreviation: 'ab', fullscreen: '⛶',
};
const labels = {
  undo: 'Undo', redo: 'Redo', heading: 'Heading and paragraph', bold: 'Bold', italic: 'Italic', strike: 'Strikethrough',
  link: 'Insert link', image: 'Insert image from page media', bulletList: 'Bulleted list', orderedList: 'Numbered list',
  blockquote: 'Blockquote', alert: 'GitHub-style alert', table: 'Insert or edit table', codeBlock: 'Code block',
  raw: 'HTML or Twig block', shortcode: 'Insert shortcode', source: 'Markdown source', more: 'More formatting',
  highlight: 'Highlight', subscript: 'Subscript', superscript: 'Superscript', keyboard: 'Keyboard text', citation: 'Citation', abbreviation: 'Abbreviation',
};
const defaults = ['undo', 'redo', 'heading', 'bold', 'italic', 'strike', 'link', 'image', 'bulletList', 'orderedList', 'blockquote', 'alert', 'table', 'codeBlock', 'raw', 'shortcode', 'source'];
const messages = {
  visual: 'Visual', source: 'Source', saved: 'Markdown is synchronized with Grav’s page form.', copied: 'Source copied.',
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function emit(textarea, name, detail) {
  textarea.dispatchEvent(new CustomEvent(`visual-editor:${name}`, { bubbles: true, detail }));
}

class VisualEditor {
  constructor(textarea, config) {
    this.textarea = textarea;
    this.config = config;
    this.mode = 'visual';
    this.originalDisplay = textarea.style.display;
    this.buildShell();
    this.editor = new Editor({
      element: this.content,
      extensions: createExtensions(config),
      content: markdownToHtml(textarea.value, config.pageMediaUrl),
      editorProps: {
        attributes: { 'aria-label': 'Visual Markdown editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
        handleDrop: (view, event, slice, moved) => this.dropFiles(event, moved),
        handlePaste: (view, event) => this.pasteFiles(event),
        transformPastedHTML: (html) => html,
      },
      onUpdate: () => this.sync(),
      onSelectionUpdate: () => this.updateToolbar(),
      onTransaction: () => this.updateToolbar(),
      onCreate: () => { this.content.querySelector('.ProseMirror')._veView = this.editor.view; },
    });
    this.bindEvents();
    this.sync();
    this.updateToolbar();
    textarea.dataset.visualEditorReady = 'true';
    emit(textarea, 'ready', { editor: this, tiptap: this.editor });
  }

  buildShell() {
    this.root = element('div', 've-editor');
    this.root.dataset.theme = this.config.theme || 'auto';
    const header = element('div', 've-header');
    const identity = element('div', 've-identity');
    identity.append(element('span', 've-mark', '✎'), element('div', '', 'Visual editor'));
    const status = element('span', 've-status', 'Markdown');
    identity.append(status);
    const modes = element('div', 've-modes');
    this.visualButton = this.button('visual', 'Visual', () => this.setMode('visual'), false);
    this.sourceButton = this.button('source', 'Source', () => this.setMode('source'), false);
    this.visualButton.setAttribute('aria-pressed', 'true'); this.sourceButton.setAttribute('aria-pressed', 'false');
    const themeButton = this.button('theme', 'Toggle editor appearance', () => this.toggleTheme(), false);
    themeButton.textContent = '◐'; themeButton.title = 'Light / dark editor';
    const fullscreenButton = this.button('fullscreen', 'Toggle distraction-free editing', () => this.root.classList.toggle('ve-fullscreen'), false);
    modes.append(this.visualButton, this.sourceButton, themeButton, fullscreenButton);
    header.append(identity, modes);
    this.toolbar = element('div', 've-toolbar'); this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', 'Content formatting');
    const tools = Array.isArray(this.config.toolbar) && this.config.toolbar.length ? this.config.toolbar : defaults;
    let previousGroup = '';
    tools.forEach((name) => {
      if (!labels[name]) return;
      const group = ['undo', 'redo'].includes(name) ? 'history' : ['heading', 'bold', 'italic', 'strike', 'link'].includes(name) ? 'inline' : 'blocks';
      if (previousGroup && previousGroup !== group) this.toolbar.append(element('span', 've-separator'));
      previousGroup = group;
      this.toolbar.append(this.toolButton(name));
    });
    this.toolbar.append(this.toolButton('more'));
    this.tableBar = element('div', 've-tablebar'); this.tableBar.hidden = true;
    const tableCommands = [
      ['addRowBefore', '+ Row above'], ['addRowAfter', '+ Row below'], ['addColumnBefore', '+ Column before'], ['addColumnAfter', '+ Column after'],
      ['deleteRow', 'Delete row'], ['deleteColumn', 'Delete column'], ['mergeCells', 'Merge cells'], ['splitCell', 'Split cell'],
      ['alignLeft', 'Align left'], ['alignCenter', 'Align center'], ['alignRight', 'Align right'], ['toggleHeaderRow', 'Header row'], ['deleteTable', 'Delete table'],
    ];
    tableCommands.forEach(([command, label]) => this.tableBar.append(this.button(command, label, () => this.tableCommand(command))));
    this.editorWrap = element('div', 've-editor-wrap'); this.content = element('div', 've-content');
    this.source = element('textarea', 've-source'); this.source.spellcheck = false; this.source.hidden = true;
    this.source.setAttribute('aria-label', 'Markdown source');
    this.editorWrap.append(this.content, this.source);
    const footer = element('div', 've-footer');
    this.status = element('span', '', messages.saved); this.count = element('span', 've-count');
    footer.append(this.status, this.count);
    this.root.append(header, this.toolbar, this.tableBar, this.editorWrap, footer);
    this.textarea.parentNode.insertBefore(this.root, this.textarea);
    this.textarea.hidden = true;
    this.textarea.style.setProperty('display', 'none', 'important');
    this.textarea.setAttribute('aria-hidden', 'true');
    this.textarea.classList.add('ve-original');
    // The native resizer belongs to the source textarea we hide, not our visual surface.
    const resizer = this.textarea.parentElement.querySelector('.grav-editor-resizer');
    if (resizer) resizer.hidden = true;
  }

  button(name, label, action, symbol = true) {
    const button = element('button', 've-button');
    button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.dataset.action = name;
    if (symbol && icons[name]) { const icon = element('span', `ve-icon ve-icon-${name}`, icons[name]); icon.setAttribute('aria-hidden', 'true'); button.append(icon); }
    else button.textContent = label;
    button.addEventListener('click', (event) => { event.preventDefault(); action(event); });
    return button;
  }

  toolButton(name) {
    return this.button(name, labels[name], () => {
      if (name === 'source') return this.setMode('source');
      if (name === 'more') return this.more();
      this.command(name);
    });
  }

  async command(name) {
    const chain = () => this.editor.chain().focus();
    switch (name) {
      case 'heading': return this.heading();
      case 'bold': return chain().toggleBold().run();
      case 'italic': return chain().toggleItalic().run();
      case 'strike': return chain().toggleStrike().run();
      case 'link': return this.link();
      case 'image': return this.mediaDialog();
      case 'bulletList': return chain().toggleBulletList().run();
      case 'orderedList': return chain().toggleOrderedList().run();
      case 'blockquote': return chain().toggleBlockquote().run();
      case 'alert': return this.alertDialog();
      case 'table': return this.tableDialog();
      case 'codeBlock': return chain().toggleCodeBlock().run();
      case 'raw': return this.rawDialog();
      case 'shortcode': return this.shortcodeDialog();
      case 'undo': return chain().undo().run();
      case 'redo': return chain().redo().run();
      case 'highlight': return chain().toggleHighlight().run();
      case 'subscript': return chain().toggleSubscript().run();
      case 'superscript': return chain().toggleSuperscript().run();
      case 'keyboard': return chain().toggleKeyboard().run();
      case 'citation': return chain().toggleCitation().run();
      case 'abbreviation': return this.abbreviation();
      default: return false;
    }
  }

  heading() {
    this.dialog('Text style', [
      { name: 'style', label: 'Style', type: 'select', options: [['paragraph', 'Paragraph'], [1, 'Heading 1'], [2, 'Heading 2'], [3, 'Heading 3'], [4, 'Heading 4'], [5, 'Heading 5'], [6, 'Heading 6']], value: this.editor.isActive('heading') ? this.editor.getAttributes('heading').level : 'paragraph' },
    ], ({ style }) => {
      const chain = this.editor.chain().focus();
      if (style === 'paragraph') chain.setParagraph().run();
      else chain.setHeading({ level: Number(style) }).run();
    });
  }

  link() {
    const attributes = this.editor.getAttributes('link');
    this.dialog(this.editor.isActive('link') ? 'Edit link' : 'Insert link', [
      { name: 'href', label: 'URL', type: 'url', required: true, value: attributes.href || '' },
      { name: 'title', label: 'Title (optional)', value: attributes.title || '' },
    ], ({ href, title }) => {
      if (!href) return;
      if (this.editor.state.selection.empty) this.editor.chain().focus().insertContent(`<a href="${escapeHtml(href)}">${escapeHtml(title || href)}</a>`).run();
      this.editor.chain().focus().extendMarkRange('link').setLink({ href, title: title || null }).run();
    }, this.editor.isActive('link') ? () => this.editor.chain().focus().unsetLink().run() : null);
  }

  abbreviation() {
    this.dialog('Abbreviation', [{ name: 'title', label: 'Expanded meaning', required: true }], ({ title }) => {
      this.editor.chain().focus().toggleAbbreviation({ title }).run();
    });
  }

  alertDialog() {
    this.dialog('Insert alert', [
      { name: 'kind', label: 'Type', type: 'select', options: alertKinds.map((kind) => [kind, kind.charAt(0) + kind.slice(1).toLowerCase()]) },
      { name: 'text', label: 'Message', type: 'textarea', value: 'Write something worth noticing.' },
    ], ({ kind, text }) => {
      const chain = this.editor.chain().focus();
      chain.setBlockquote().updateAttributes('blockquote', { alert: kind }).run();
      if (text) chain.insertContent(text).run();
      this.ensureAlertTitle(kind);
    });
  }

  ensureAlertTitle(kind) {
    const { state } = this.editor;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'blockquote' || !node.attrs.alert) return;
      if (node.firstChild?.type.name === 'alertTitle') {
        if (node.firstChild.attrs.kind !== node.attrs.alert) this.editor.view.dispatch(state.tr.setNodeMarkup(pos + 1, undefined, { kind: node.attrs.alert }));
      } else {
        const title = state.schema.nodes.alertTitle.create({ kind: node.attrs.alert });
        this.editor.view.dispatch(state.tr.insert(pos + 1, title));
      }
    });
  }

  rawDialog() {
    this.dialog('Protected HTML or Twig', [
      { name: 'kind', label: 'Block type', type: 'select', options: [['html', 'HTML'], ['twig', 'Twig']] },
      { name: 'source', label: 'Source', type: 'textarea', required: true, value: '<div class="notice">\n  Your content\n</div>' },
    ], ({ kind, source }) => this.insertBlock({ source, kind }));
  }

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
  }

  insertBlock(attributes) {
    this.editor.chain().focus().insertContent({ type: 'protectedBlock', attrs: { ...attributes, preview: '' } }).run();
  }

  tableDialog() {
    if (this.editor.isActive('table')) { this.editor.chain().focus().run(); return; }
    this.dialog('Insert table', [
      { name: 'rows', label: 'Rows', type: 'number', min: 1, max: 30, value: 3, required: true },
      { name: 'columns', label: 'Columns', type: 'number', min: 1, max: 12, value: 3, required: true },
    ], ({ rows, columns }) => this.editor.chain().focus().insertTable({ rows: Math.max(1, Math.min(30, Number(rows))), cols: Math.max(1, Math.min(12, Number(columns))), withHeaderRow: true }).run());
  }

  tableCommand(command) {
    const chain = this.editor.chain().focus();
    if (command.startsWith('align')) return chain.setCellAttribute('align', command.slice(5).toLowerCase()).run();
    return chain[command]().run();
  }

  more() {
    this.dialog('Inline HTML formatting', [
      { name: 'format', label: 'Format', type: 'select', options: [['highlight', 'Highlight — <mark>'], ['keyboard', 'Keyboard — <kbd>'], ['citation', 'Citation — <cite>'], ['subscript', 'Subscript — <sub>'], ['superscript', 'Superscript — <sup>'], ['abbreviation', 'Abbreviation — <abbr>']] },
    ], ({ format }) => this.command(format));
  }

  dialog(title, fields, onSubmit, onRemove = null) {
    this.closeDialog();
    const overlay = element('div', 've-dialog-overlay');
    const dialog = element('section', 've-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
    dialog.tabIndex = -1;
    const heading = element('h2', '', title); const close = this.button('close', 'Close dialog', () => this.closeDialog()); close.textContent = '×';
    const top = element('div', 've-dialog-header'); top.append(heading, close);
    const form = element('form', 've-dialog-form');
    fields.forEach((field) => {
      const label = element('label', 've-field'); label.append(element('span', '', field.label));
      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        field.options.forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); });
      } else input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type !== 'textarea' && field.type !== 'select') input.type = field.type || 'text';
      if (field.min) input.min = field.min; if (field.max) input.max = field.max;
      input.name = field.name; input.required = Boolean(field.required); input.value = field.value ?? '';
      label.append(input); form.append(label);
    });
    const actions = element('div', 've-dialog-actions');
    if (onRemove) { const remove = this.button('remove', 'Remove link', () => { onRemove(); this.closeDialog(); }); remove.classList.add('ve-danger'); actions.append(remove); }
    const cancel = this.button('cancel', 'Cancel', () => this.closeDialog());
    const submit = this.button('submit', 'Apply', () => {}); submit.type = 'submit'; submit.classList.add('ve-primary');
    actions.append(cancel, submit); form.append(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      onSubmit(values); this.closeDialog();
    });
    dialog.append(top, form); overlay.append(dialog); this.root.append(overlay);
    this.dialogElement = overlay;
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) this.closeDialog(); });
    overlay.addEventListener('keydown', (event) => this.dialogKeys(event));
    requestAnimationFrame(() => (form.querySelector('input,textarea,select') || dialog).focus());
  }

  dialogKeys(event) {
    if (event.key === 'Escape') { event.preventDefault(); this.closeDialog(); return; }
    if (event.key !== 'Tab') return;
    const items = [...this.dialogElement.querySelectorAll('button,input,textarea,select')].filter((item) => !item.disabled);
    if (!items.length) return;
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
    if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
  }

  closeDialog() { this.dialogElement?.remove(); this.dialogElement = null; }

  async mediaDialog() {
    const items = await this.request('mediaUrl');
    const body = element('div', 've-media-body');
    const grid = element('div', 've-media-grid');
    const list = Array.isArray(items.items) ? items.items : [];
    if (!list.length) grid.append(element('p', 've-empty', 'No images in this page’s media folder yet. Upload one below.'));
    list.forEach((item) => {
      const card = this.button('media', item.name, () => this.imageOptions(item));
      card.classList.add('ve-media-card');
      const image = document.createElement('img'); image.src = item.url; image.alt = ''; image.loading = 'lazy';
      card.append(image, element('span', '', item.name)); grid.append(card);
    });
    body.append(grid);
    this.dialog('Page media', [], () => {});
    this.dialogElement.querySelector('form').before(body);
    const form = this.dialogElement.querySelector('form');
    form.innerHTML = '';
    const fileLabel = element('label', 've-field ve-upload'); fileLabel.append(element('span', '', 'Upload an image to this page'));
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml';
    fileLabel.append(input); form.append(fileLabel);
    const submit = this.button('upload', 'Upload image', async () => {
      const file = input.files?.[0];
      if (!file) return this.notify('Choose an image first.', true);
      if (file.size > this.config.maxUploadBytes) return this.notify('The image exceeds the upload limit.', true);
      submit.disabled = true;
      try { const response = await this.request('uploadUrl', {}, file); this.closeDialog(); this.imageOptions(response.item); }
      catch (error) { this.notify(error.message, true); submit.disabled = false; }
    });
    submit.classList.add('ve-primary'); form.append(submit);
  }

  imageOptions(item) {
    this.dialog('Insert image', [
      { name: 'alt', label: 'Alternative text', required: true, value: item.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') },
      { name: 'title', label: 'Title (optional)' },
      { name: 'src', label: 'Markdown path', value: item.path, required: true },
    ], ({ alt, title, src }) => this.editor.chain().focus().setImage({ src, alt, title }).run());
  }

  async request(urlName, fields = {}, file = null) {
    const url = this.config[urlName];
    if (!url) throw new Error('This operation is not configured.');
    const data = new FormData();
    data.append('admin-nonce', this.config.nonce || '');
    data.append('page_route', this.config.pageRoute || '');
    Object.entries(fields).forEach(([key, value]) => data.append(key, value));
    if (file) data.append('file', file);
    const response = await fetch(url, { method: 'POST', body: data, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } });
    let json;
    try { json = await response.json(); } catch { throw new Error('Grav did not return a valid response. Reload and try again.'); }
    if (!response.ok || json.status === 'error') throw new Error(json.message || 'The request failed.');
    return json;
  }

  dropFiles(event, moved) {
    if (moved || !event.dataTransfer?.files?.length) return false;
    event.preventDefault();
    [...event.dataTransfer.files].forEach((file) => this.uploadAndInsert(file));
    return true;
  }

  pasteFiles(event) {
    const file = [...(event.clipboardData?.files || [])][0];
    if (!file) return false;
    event.preventDefault(); this.uploadAndInsert(file); return true;
  }

  async uploadAndInsert(file) {
    if (!file.type.startsWith('image/')) return this.notify('Only images can be dropped here.', true);
    if (file.size > this.config.maxUploadBytes) return this.notify('The image exceeds the upload limit.', true);
    this.status.textContent = `Uploading ${file.name}…`;
    try {
      const response = await this.request('uploadUrl', {}, file);
      this.editor.chain().focus().setImage({ src: response.item.path, alt: file.name.replace(/\.[^.]+$/, '') }).run();
      this.notify('Image uploaded and inserted.');
    } catch (error) { this.notify(error.message, true); }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'source') {
      this.sync(); this.source.value = this.textarea.value;
      this.content.hidden = true; this.source.hidden = false;
    } else {
      this.textarea.value = this.source.value;
      this.editor.commands.setContent(markdownToHtml(this.source.value, this.config.pageMediaUrl), false);
      this.content.hidden = false; this.source.hidden = true;
      this.editor.commands.focus('end');
    }
    this.mode = mode;
    this.visualButton.setAttribute('aria-pressed', String(mode === 'visual'));
    this.sourceButton.setAttribute('aria-pressed', String(mode === 'source'));
    this.toolbar.hidden = mode === 'source';
    this.tableBar.hidden = true;
    this.sync(); this.updateToolbar();
  }

  toggleTheme() {
    const current = this.root.dataset.theme;
    this.root.dataset.theme = current === 'dark' || (current === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark';
  }

  sync() {
    const markdown = this.mode === 'source' ? this.source.value : documentToMarkdown(this.editor.state.doc);
    this.textarea.value = markdown;
    this.count.textContent = `${markdown.length.toLocaleString()} characters · Markdown`;
    emit(this.textarea, 'change', { editor: this, markdown });
  }

  updateToolbar() {
    if (!this.editor) return;
    this.toolbar.querySelectorAll('[data-action]').forEach((button) => {
      const name = button.dataset.action;
      const active = { bold: 'bold', italic: 'italic', strike: 'strike', link: 'link', bulletList: 'bulletList', orderedList: 'orderedList', blockquote: 'blockquote', codeBlock: 'codeBlock', highlight: 'highlight', subscript: 'subscript', superscript: 'superscript', keyboard: 'keyboard', citation: 'citation' }[name];
      if (active) button.setAttribute('aria-pressed', String(this.editor.isActive(active)));
      if (name === 'undo') button.disabled = !this.editor.can().undo();
      if (name === 'redo') button.disabled = !this.editor.can().redo();
    });
    const inTable = this.editor.isActive('table'); this.tableBar.hidden = !inTable || this.mode === 'source';
  }

  notify(message, error = false) {
    this.status.textContent = message; this.status.classList.toggle('ve-error', error);
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.status.textContent = messages.saved; this.status.classList.remove('ve-error'); }, 6000);
  }

  bindEvents() {
    this.source.addEventListener('input', () => this.sync());
    const form = this.textarea.closest('form');
    form?.addEventListener('submit', () => { this.sync(); emit(this.textarea, 'save', { editor: this, markdown: this.textarea.value }); }, true);
    this.root.addEventListener('visual-editor-select-block', (event) => {
      this.editor.commands.setNodeSelection(event.detail.pos);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.dialogElement) this.closeDialog();
    });
    const registry = window.GravVisualEditorShortcodes;
    if (!Array.isArray(registry)) window.GravVisualEditorShortcodes = [];
  }
}

function initialize() {
  const config = { theme: 'auto', smartTypography: true, shortcodePreviews: true, toolbar: defaults, maxUploadBytes: 10485760, ...(window.GravVisualEditorConfig || {}) };
  document.querySelectorAll('textarea[data-grav-editor]:not([data-visual-editor-ready])').forEach((textarea) => {
    if (textarea.disabled || textarea.readOnly) return;
    try { emit(textarea, 'before-init', { config }); new VisualEditor(textarea, config); }
    catch (error) {
      textarea.hidden = false; textarea.style.display = ''; textarea.removeAttribute('aria-hidden');
      document.querySelectorAll('.ve-editor').forEach((root) => { if (root.nextSibling === textarea) root.remove(); });
      console.error('Grav Visual Editor could not initialize; source editing remains available.', error);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
