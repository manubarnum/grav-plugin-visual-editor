/** VisualEditor methods — Images: media picker and upload, drag/paste, image bar (width, alt text). Mixed into VisualEditor.prototype in ../editor.js. */
import { imageWidth, withImageWidth } from '../markdown.js';
import { element, markdownSnippet } from './ui.js';
import { t } from '../i18n.js';

export const imageMethods = {
  selectedImage() {
    const { selection } = this.editor.state;
    return selection.node?.type.name === 'image' ? { node: selection.node, pos: selection.from } : null;
  },

  updateImage(attributes) {
    const image = this.selectedImage();
    if (!image) return;
    this.editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(image.pos, undefined, { ...image.node.attrs, ...attributes }); return true; }).setNodeSelection(image.pos).run();
  },

  setImageWidth(width) {
    const image = this.selectedImage();
    if (!image) return;
    const natural = this.content.querySelector('.ProseMirror-selectednode img')?.naturalWidth || 0;
    // Never ask Grav to enlarge: at or above the file's own width, serve the original.
    const size = width && natural && width >= natural ? null : width;
    this.updateImage({ src: withImageWidth(image.node.attrs.src, size) });
    if (width && size === null) this.notify(t('This image is only {width} px wide: kept at its original size.', { width: natural }));
  },

  imageWidthDialog() {
    const image = this.selectedImage();
    if (!image) return;
    this.dialog('Image width', [
      { name: 'width', label: 'Width in pixels (empty = original size)', type: 'number', min: 16, max: 6000, value: imageWidth(image.node.attrs.src) ?? '' },
    ], ({ width }) => { this.editor.commands.setNodeSelection(image.pos); this.setImageWidth(Number(width) || null); });
  },

  imageDetailsDialog() {
    const image = this.selectedImage();
    if (!image) return;
    this.dialog('Image details', [
      { name: 'alt', label: 'Alternative text', required: true, value: image.node.attrs.alt || '' },
      { name: 'title', label: 'Title (optional)', value: image.node.attrs.title || '' },
    ], ({ alt, title }) => { this.editor.commands.setNodeSelection(image.pos); this.updateImage({ alt, title: title || null }); });
  },

  async mediaDialog() {
    let list = [];
    try { list = (await this.services.listMedia?.()) || []; } catch (error) { this.notify(error.message, true); }
    const body = element('div', 've-media-body');
    const grid = element('div', 've-media-grid');
    if (!list.length) grid.append(element('p', 've-empty', t('No images in this page’s media yet. Upload one below.')));
    list.forEach((item) => {
      const card = this.button('media', item.name, () => this.imageOptions(item));
      card.classList.add('ve-media-card');
      const image = document.createElement('img'); image.src = item.thumb || item.url; image.alt = ''; image.loading = 'lazy';
      card.append(image, element('span', '', item.name)); grid.append(card);
    });
    body.append(grid);
    this.dialog('Insert image', [], () => {});
    const form = this.dialogElement.querySelector('form');
    form.before(body);
    form.innerHTML = '';
    if (this.services.pickSiteMedia) {
      const site = this.button('site-media', 'Choose from site media…', async () => {
        const picked = await this.services.pickSiteMedia();
        if (picked) this.imageOptions({ name: picked.alt || picked.url, path: picked.url, url: picked.display, alt: picked.alt });
      });
      form.append(site);
    }
    if (this.services.upload) {
      const fileLabel = element('label', 've-field ve-upload'); fileLabel.append(element('span', '', t('Upload an image to this page')));
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml';
      fileLabel.append(input); form.append(fileLabel);
      const submit = this.button('upload', 'Upload image', async () => {
        const file = input.files?.[0];
        if (!file) return this.notify('Choose an image first.', true);
        if (file.size > this.config.maxUploadBytes) return this.notify('The image exceeds the upload limit.', true);
        submit.disabled = true;
        try {
          const item = await this.services.upload(file);
          if (!item) throw new Error(t('The upload did not complete.'));
          this.closeDialog(); this.imageOptions(item);
        } catch (error) { this.notify(error.message, true); submit.disabled = false; }
      });
      submit.classList.add('ve-primary'); form.append(submit);
    }
  },

  imageOptions(item) {
    this.dialog('Insert image', [
      { name: 'alt', label: 'Alternative text', required: true, value: item.alt || item.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') },
      { name: 'title', label: 'Title (optional)' },
      { name: 'src', label: 'Markdown path', value: item.path, required: true },
    ], ({ alt, title, src }) => this.editor.chain().focus().setImage({ src, alt, title: title || null }).run());
  },

  dropFiles(event, moved) {
    if (moved) return false;
    const transfer = event.dataTransfer;
    if (transfer?.files?.length) {
      event.preventDefault();
      this.uploadAndInsert([...transfer.files]);
      return true;
    }
    // Admin2's media panel drags `![alt](file)` as text/plain (+ application/x-grav-media):
    // insert it as Markdown at the drop point, not as literal text.
    const snippet = markdownSnippet(transfer, Boolean(transfer?.getData('application/x-grav-media')));
    if (!snippet) return false;
    event.preventDefault();
    let target = null;
    try { target = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY }); } catch { /* no layout: keep the cursor */ }
    if (target) this.editor.commands.setTextSelection(target.pos);
    this.insertMarkdown(snippet);
    return true;
  },

  pasteFiles(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { event.preventDefault(); this.uploadAndInsert(files); return true; }
    // A copied Markdown image/link (e.g. from the media panel) becomes an image/link, not text.
    const snippet = event.clipboardData?.getData('text/html') ? '' : markdownSnippet(event.clipboardData, false);
    if (!snippet) return false;
    event.preventDefault(); this.insertMarkdown(snippet); return true;
  },

  async uploadAndInsert(files) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return this.notify('Only images can be dropped here.', true);
    if (!this.services.upload) return this.notify('Image upload is not available here.', true);
    for (const file of images) {
      if (file.size > this.config.maxUploadBytes) { this.notify(t('{name} exceeds the upload limit.', { name: file.name }), true); continue; }
      this.status.textContent = t('Uploading {name}…', { name: file.name });
      try {
        const item = await this.services.upload(file);
        if (!item) continue;
        this.editor.chain().focus().setImage({ src: item.path, alt: item.alt || file.name.replace(/\.[^.]+$/, '') }).run();
        this.notify('Image uploaded and inserted.');
      } catch (error) { this.notify(error.message, true); }
    }
  },
};
