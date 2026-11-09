/** VisualEditor methods — Generic modal dialogs built from field descriptions. Mixed into VisualEditor.prototype in ../editor.js. */
import { element } from './ui.js';

export const dialogMethods = {
  dialog(title, fields, onSubmit, onRemove = null, removeLabel = 'Remove link') {
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
    if (onRemove) { const remove = this.button('remove', removeLabel, () => { this.closeDialog(); onRemove(); }); remove.classList.add('ve-danger'); actions.append(remove); }
    const cancel = this.button('cancel', 'Cancel', () => this.closeDialog());
    // button() cancels the click's default action, which would also cancel a native submit:
    // submit explicitly so required fields are still validated.
    const submit = this.button('submit', 'Apply', () => (form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }))));
    submit.type = 'submit'; submit.classList.add('ve-primary');
    actions.append(cancel, submit); form.append(actions);
    form.addEventListener('submit', (event) => {
      // Our form may sit inside the host's page form (Admin2): never let the submit reach it.
      event.preventDefault(); event.stopPropagation();
      const values = Object.fromEntries(new FormData(form).entries());
      // Close first: onSubmit may open the next dialog (e.g. More formatting → Abbreviation).
      this.closeDialog(); onSubmit(values);
    });
    dialog.append(top, form); overlay.append(dialog); this.root.append(overlay);
    this.dialogElement = overlay;
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) this.closeDialog(); });
    overlay.addEventListener('keydown', (event) => this.dialogKeys(event));
    requestAnimationFrame(() => (form.querySelector('input,textarea,select') || dialog).focus());
  },

  dialogKeys(event) {
    if (event.key === 'Escape') { event.preventDefault(); this.closeDialog(); return; }
    if (event.key !== 'Tab') return;
    const items = [...this.dialogElement.querySelectorAll('button,input,textarea,select')].filter((item) => !item.disabled);
    if (!items.length) return;
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
    if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
  },

  closeDialog() { this.dialogElement?.remove(); this.dialogElement = null; },
};
