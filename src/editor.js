import { Editor, getSchema } from '@tiptap/core';
import { createExtensions, documentToMarkdown, markdownToHtml } from './extensions.js';
import { detectMarkdownStyle, escapeHtml, imageWidth } from './markdown.js';
import { defaults, element, icons, labels, messages } from './editor/ui.js';
import { detectLocale, setLocale, t } from './i18n.js';
import { canSharedRedo, canSharedUndo, collaborationExtension, sharedRedo, sharedUndo, startCollaboration } from './collab.js';
import { blockMethods } from './editor/blocks.js';
import { dialogMethods } from './editor/dialog.js';
import { imageMethods } from './editor/images.js';
import { tableMethods } from './editor/tables.js';

export { markdownSnippet } from './editor/ui.js';

export const defaultConfig = { theme: 'auto', smartTypography: true, shortcodePreviews: true, toolbar: defaults, maxUploadBytes: 10485760, shortcodes: [] };

/**
 * Host-agnostic editor. The host owns persistence: it passes the initial Markdown, gets every
 * user edit through `onChange(markdown)`, and pushes outside changes back with `setMarkdown()`.
 * `services` are optional async adapters: listMedia(), upload(file), pickSiteMedia(), preview(source).
 */
export class VisualEditor {
  constructor(host, { markdown = '', config = {}, services = {}, onChange = () => {}, collaboration = null } = {}) {
    this.host = host;
    // Admin2 collaborative editing: { fragment, awareness, user }; the shared fragment is the source of truth.
    this.collaboration = collaboration;
    this.services = services;
    this.onChange = onChange;
    this.config = {
      ...defaultConfig, ...config,
      hooks: {
        preview: services.preview && config.shortcodePreviews !== false ? (source) => services.preview(source) : null,
        editSource: (attrs, apply) => this.editSourceDialog(attrs, apply),
        notify: (message, error) => this.notify(message, error),
      },
    };
    setLocale(config.locale || detectLocale());
    this.mode = 'visual';
    this.markdown = String(markdown ?? '');
    // The page's own conventions (bullets, emphasis, headings…), reused when saving.
    this.markdownStyle = detectMarkdownStyle(this.markdown);
    this.onKeydown = (event) => { if (event.key === 'Escape' && this.dialogElement) this.closeDialog(); };
    this.buildShell();
    // Shared undo history replaces TipTap's own when collaborating (y-prosemirror requirement).
    const extensions = createExtensions({ ...this.config, history: !collaboration });
    let content = this.toHtml(this.markdown);
    if (collaboration) {
      const { doc, mapping } = startCollaboration(collaboration, getSchema(extensions), content);
      extensions.push(collaborationExtension(collaboration, mapping));
      content = doc.toJSON();
    }
    this.editor = new Editor({
      element: this.content,
      extensions,
      content,
      editorProps: {
        attributes: { 'aria-label': 'Visual Markdown editor', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
        handleDrop: (view, event, slice, moved) => this.dropFiles(event, moved),
        handlePaste: (view, event) => this.pasteFiles(event),
        transformPastedHTML: (html) => html,
      },
      onUpdate: () => this.sync(),
      // Fires for content and selection changes alike (a separate onSelectionUpdate doubled the work).
      onTransaction: () => this.updateToolbar(),
    });
    // Joining a session shows the shared document, which may differ from the form's value.
    if (collaboration) this.markdown = documentToMarkdown(this.editor.state.doc, this.markdownStyle);
    this.bindEvents();
    this.updateCount();
    this.updateToolbar();
    this.emit('ready', { editor: this, tiptap: this.editor });
  }

  /**
   * Distraction-free editing. The frame is position:fixed, but inside the host page a container with its
   * own stacking context (Admin2's layout) kept the page header above it: lift the frame to <body> while
   * full screen, and put it back where it was (a comment marks the spot) when leaving.
   */
  toggleFullscreen() {
    const entering = !this.root.classList.contains('ve-fullscreen');
    if (entering) {
      this.fullscreenAnchor = document.createComment('visual-editor');
      this.root.before(this.fullscreenAnchor);
      document.body.append(this.root);
    } else if (this.fullscreenAnchor) {
      this.fullscreenAnchor.replaceWith(this.root);
      this.fullscreenAnchor = null;
    }
    this.root.classList.toggle('ve-fullscreen', entering);
    if (this.mode === 'visual') this.editor.commands.focus();
  }

  emit(name, detail) {
    this.host.dispatchEvent(new CustomEvent(`visual-editor:${name}`, { bubbles: true, composed: true, detail }));
  }

  toHtml(markdown) { return markdownToHtml(markdown, this.config.resolveMediaUrl || this.config.pageMediaUrl || ''); }

  /** Replace the content from outside (host value change). No-op when it is our own last output. */
  setMarkdown(markdown) {
    const value = String(markdown ?? '');
    if (value === this.markdown) return;
    this.markdown = value;
    this.markdownStyle = detectMarkdownStyle(value);
    if (this.mode === 'source') this.source.value = value;
    else this.editor.commands.setContent(this.toHtml(value), false);
    this.updateCount();
  }

  getMarkdown() { return this.markdown; }

  /** Insert a Markdown snippet at the cursor (e.g. from Admin2's media panel). */
  insertMarkdown(snippet) {
    const text = String(snippet ?? '');
    if (!text) return;
    if (this.mode === 'source') {
      const { selectionStart: start, selectionEnd: end, value } = this.source;
      this.source.value = value.slice(0, start) + text + value.slice(end);
      this.sync();
      return;
    }
    this.editor.chain().focus().insertContent(this.toHtml(text)).run();
  }

  destroy() {
    if (this.toolbarFrame) cancelAnimationFrame(this.toolbarFrame);
    this.closeDialog();
    document.removeEventListener('keydown', this.onKeydown);
    this.editor?.destroy();
    this.fullscreenAnchor?.remove();
    this.root.remove();
  }

  buildShell() {
    this.root = element('div', 've-editor');
    this.root.dataset.theme = this.config.theme || 'auto';
    if (this.config.plainTables) this.root.classList.add('ve-plain-tables');
    const header = element('div', 've-header');
    const identity = element('div', 've-identity');
    identity.append(element('span', 've-mark', '✎'), element('div', '', t('Visual editor')));
    const status = element('span', 've-status', 'Markdown');
    identity.append(status);
    const modes = element('div', 've-modes');
    this.visualButton = this.button('visual', 'Visual', () => this.setMode('visual'), false);
    this.sourceButton = this.button('source', 'Source', () => this.setMode('source'), false);
    this.visualButton.setAttribute('aria-pressed', 'true'); this.sourceButton.setAttribute('aria-pressed', 'false');
    const themeButton = this.button('theme', 'Toggle editor appearance', () => this.toggleTheme(), false);
    themeButton.textContent = '◐'; themeButton.title = t('Light / dark editor');
    const fullscreenButton = this.button('fullscreen', 'Toggle distraction-free editing', () => this.toggleFullscreen(), false);
    modes.append(this.visualButton, this.sourceButton, themeButton, fullscreenButton);
    header.append(identity, modes);
    this.toolbar = element('div', 've-toolbar'); this.toolbar.setAttribute('role', 'toolbar'); this.toolbar.setAttribute('aria-label', t('Content formatting'));
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
      ['alignLeft', 'Align left'], ['alignCenter', 'Align center'], ['alignRight', 'Align right'], ['toggleHeaderRow', 'Header row'], ['tableStyle', 'Table style…'], ['deleteTable', 'Delete table'],
    ];
    tableCommands.forEach(([command, label]) => this.tableBar.append(this.button(command, label, () => this.tableCommand(command))));
    // Shown while an image is selected; widths become Grav's `?cropResize=` (resized copy, ratio kept).
    this.imageBar = element('div', 've-tablebar ve-imagebar'); this.imageBar.hidden = true;
    this.imageSize = element('span', 've-imagebar-size');
    [[320, 'Small · 320 px'], [640, 'Medium · 640 px'], [960, 'Large · 960 px'], [null, 'Original size']].forEach(([width, label]) => {
      this.imageBar.append(this.button(`width-${width || 'original'}`, label, () => this.setImageWidth(width)));
    });
    this.imageBar.append(
      this.button('width-custom', 'Width…', () => this.imageWidthDialog()),
      this.button('image-details', 'Alt text & title…', () => this.imageDetailsDialog()),
      this.imageSize,
    );
    this.editorWrap = element('div', 've-editor-wrap'); this.content = element('div', 've-content');
    this.source = element('textarea', 've-source'); this.source.spellcheck = false; this.source.hidden = true;
    this.source.setAttribute('aria-label', t('Markdown source'));
    this.editorWrap.append(this.content, this.source);
    const footer = element('div', 've-footer');
    this.status = element('span', '', t(messages.saved)); this.count = element('span', 've-count');
    footer.append(this.status, this.count);
    this.root.append(header, this.toolbar, this.tableBar, this.imageBar, this.editorWrap, footer);
    this.host.append(this.root);
  }

  button(name, label, action, symbol = true) {
    label = t(label);
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
      case 'colorBlock': return this.colorBlockDialog();
      case 'alignLeft': return this.setAlignment('left');
      case 'alignCenter': return this.setAlignment('center');
      case 'alignRight': return this.setAlignment('right');
      case 'table': return this.tableDialog();
      case 'codeBlock': return chain().toggleCodeBlock().run();
      case 'raw': return this.rawDialog();
      case 'shortcode': return this.shortcodeDialog();
      case 'undo': return this.collaboration ? sharedUndo(this.editor.state) : chain().undo().run();
      case 'redo': return this.collaboration ? sharedRedo(this.editor.state) : chain().redo().run();
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
    const editing = this.editor.isActive('link');
    this.dialog(editing ? 'Edit link' : 'Insert link', [
      { name: 'href', label: 'URL', type: 'url', required: true, value: attributes.href || '' },
      { name: 'title', label: 'Title (optional)', value: attributes.title || '' },
    ], ({ href, title }) => {
      if (!href) return;
      // Insert new link text only for a bare cursor outside any link; inside a link, edit that link.
      if (this.editor.state.selection.empty && !editing) this.editor.chain().focus().insertContent(`<a href="${escapeHtml(href)}">${escapeHtml(title || href)}</a>`).run();
      // A new URL no longer matches the page's reference definition: save it as a plain link.
      const unchanged = attributes.reference && href === attributes.href && (title || null) === (attributes.title || null);
      this.editor.chain().focus().extendMarkRange('link').setLink({ href, title: title || null, ...(unchanged ? {} : { reference: null, referenceForm: null }) }).run();
    }, this.editor.isActive('link') ? () => this.editor.chain().focus().unsetLink().run() : null);
  }

  abbreviation() {
    this.dialog('Abbreviation', [{ name: 'title', label: 'Expanded meaning', required: true }], ({ title }) => {
      this.editor.chain().focus().toggleAbbreviation({ title }).run();
    });
  }

  /** Inline HTML formats, each previewed on the selected text; a click applies it. */
  more() {
    const { from, to } = this.editor.state.selection;
    const selected = this.editor.state.doc.textBetween(from, to, ' ').trim();
    const text = selected ? (selected.length > 40 ? `${selected.slice(0, 39)}…` : selected) : t('Example text');
    const formats = [
      ['highlight', 'Highlight', 'mark'], ['keyboard', 'Keyboard text', 'kbd'], ['citation', 'Citation', 'cite'],
      ['abbreviation', 'Abbreviation', 'abbr'], ['subscript', 'Subscript', 'sub'], ['superscript', 'Superscript', 'sup'],
    ];
    this.dialog('Inline HTML formatting', [], () => {});
    const form = this.dialogElement.querySelector('form');
    form.replaceChildren();
    const grid = element('div', 've-format-grid');
    formats.forEach(([format, name, tag]) => {
      const option = this.button(`format-${format}`, name, () => { this.closeDialog(); this.command(format); }, false);
      option.classList.add('ve-format-option');
      option.textContent = '';
      // The selection rendered with the format itself; sub/sup after an "x" so the shift shows.
      const sample = element('span', 've-format-sample', ['sub', 'sup'].includes(tag) ? 'x' : '');
      const preview = element(tag, '', text);
      if (tag === 'abbr') preview.title = t('Expanded meaning');
      sample.append(preview);
      option.append(element('span', 've-format-name', t(name)), sample, element('code', 've-format-tag', `<${tag}>`));
      grid.append(option);
    });
    const cancel = this.button('cancel', 'Cancel', () => this.closeDialog());
    const actions = element('div', 've-dialog-actions');
    actions.append(cancel);
    form.append(grid, actions);
    requestAnimationFrame(() => grid.querySelector('button')?.focus());
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'source') {
      this.source.value = this.markdown;
      this.content.hidden = true; this.source.hidden = false;
    } else {
      // Switching views must not rewrite the Markdown by itself: only a real edit re-serializes.
      this.editor.commands.setContent(this.toHtml(this.markdown), false);
      this.content.hidden = false; this.source.hidden = true;
      this.editor.commands.focus('end');
    }
    this.mode = mode;
    this.visualButton.setAttribute('aria-pressed', String(mode === 'visual'));
    this.sourceButton.setAttribute('aria-pressed', String(mode === 'source'));
    this.toolbar.hidden = mode === 'source';
    this.tableBar.hidden = true; this.imageBar.hidden = true;
    this.updateToolbar();
  }

  toggleTheme() {
    const current = this.root.dataset.theme;
    this.root.dataset.theme = current === 'dark' || (current === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark';
  }

  /** Called on user edits only; reports the Markdown to the host when it actually changed. */
  sync() {
    const markdown = this.mode === 'source' ? this.source.value : documentToMarkdown(this.editor.state.doc, this.markdownStyle);
    if (markdown === this.markdown) return;
    this.markdown = markdown;
    this.updateCount();
    this.onChange(markdown);
    this.emit('change', { editor: this, markdown });
  }

  updateCount() { this.count.textContent = t('{count} characters · Markdown', { count: this.markdown.length.toLocaleString() }); }

  /** Refresh button states at most once per animation frame, whatever the number of transactions. */
  updateToolbar() {
    if (!this.editor || this.toolbarFrame) return;
    this.toolbarFrame = requestAnimationFrame(() => {
      this.toolbarFrame = null;
      if (!this.editor.isDestroyed) this.renderToolbarState();
    });
  }

  renderToolbarState() {
    // Block lookups walk up the document: once per refresh, not once per button.
    const colorBlock = Boolean(this.findColorBlock());
    const alignment = this.currentAlignment();
    this.toolbar.querySelectorAll('[data-action]').forEach((button) => {
      const name = button.dataset.action;
      const active = { bold: 'bold', italic: 'italic', strike: 'strike', link: 'link', bulletList: 'bulletList', orderedList: 'orderedList', blockquote: 'blockquote', codeBlock: 'codeBlock', highlight: 'highlight', subscript: 'subscript', superscript: 'superscript', keyboard: 'keyboard', citation: 'citation' }[name];
      if (active) button.setAttribute('aria-pressed', String(this.editor.isActive(active)));
      if (name === 'undo') button.disabled = !(this.collaboration ? canSharedUndo(this.editor.state) : this.editor.can().undo());
      if (name === 'redo') button.disabled = !(this.collaboration ? canSharedRedo(this.editor.state) : this.editor.can().redo());
      if (name === 'colorBlock') button.setAttribute('aria-pressed', String(colorBlock));
      if (name.startsWith('align')) button.setAttribute('aria-pressed', String(alignment === name.slice(5).toLowerCase()));
    });
    const inTable = this.editor.isActive('table'); this.tableBar.hidden = !inTable || this.mode === 'source';
    const image = this.mode === 'visual' ? this.selectedImage() : null;
    this.imageBar.hidden = !image;
    if (image) {
      const width = imageWidth(image.node.attrs.src);
      this.imageSize.textContent = width ? t('Shown at {width} px', { width }) : t('Original size');
    }
  }

  notify(message, error = false) {
    message = t(message);
    this.status.textContent = message; this.status.classList.toggle('ve-error', error);
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.status.textContent = t(messages.saved); this.status.classList.remove('ve-error'); }, 6000);
  }

  bindEvents() {
    this.source.addEventListener('input', () => this.sync());
    document.addEventListener('keydown', this.onKeydown);
    const registry = window.GravVisualEditorShortcodes;
    if (!Array.isArray(registry)) window.GravVisualEditorShortcodes = [];
  }
}

// Feature areas live in src/editor/*.js; their methods are part of the class API.
Object.assign(VisualEditor.prototype, blockMethods, tableMethods, imageMethods, dialogMethods);
