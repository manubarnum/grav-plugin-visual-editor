/**
 * VisualEditor methods — Page settings (background color or gradient, page effect), kept as a
 * `<!-- ve-page … -->` comment opening the content and hidden from both editing views.
 * Mixed into VisualEditor.prototype in ../editor.js.
 */
import { t } from '../i18n.js';
import { cleanPageSettings, contrastText, gradientCss, gradientDirections, isHexColor, mixColors, pageSettingsPrefix } from '../markdown.js';

const presets = [
  ['#fde2e4', 'Rose'], ['#fff1c1', 'Yellow'], ['#e3f4e1', 'Green'], ['#ddeefc', 'Blue'], ['#ece4fb', 'Lavender'], ['#f1f1ef', 'Grey'],
  ['#1d3557', 'Night blue'], ['#2d1b4e', 'Deep purple'], ['#0b132b', 'Starry night'],
];
const effectLabels = [
  ['snow', 'Falling snow'], ['snow-still', 'Snow (still)'], ['stars', 'Twinkling stars'], ['stars-still', 'Stars (still)'],
  ['sparkles', 'Falling sparkles'], ['sparkles-still', 'Sparkles (still)'],
];
const mutedText = { '#ffffff': 'rgba(255,255,255,.72)', '#1f2329': 'rgba(31,35,41,.68)' };
const directionLabels = { 'to bottom': 'Top to bottom', 'to right': 'Left to right', 'to bottom right': 'Diagonal', radial: 'From the center' };

export const pageMethods = {
  /** The settings in force: the content's comment, else the page's former header fields (host-provided). */
  currentPageSettings() {
    if (this.pageSettings) return this.pageSettings;
    const legacy = typeof this.config.legacyPageSettings === 'function' ? this.config.legacyPageSettings() : null;
    return cleanPageSettings(legacy || {});
  },

  pageSettingsDialog() {
    const current = this.currentPageSettings();
    const { pageBackground = true, pageEffects = true } = this.config;
    // A color the presets do not have (e.g. with transparency) stays selectable as it is.
    const colorOptions = (value, none) => {
      const options = [['none', none], ...presets];
      if (value && !presets.some(([preset]) => preset === value)) options.push([value, t('Current color ({color})', { color: value })]);
      return [...options, ['custom', 'Custom color (below)']];
    };
    const fields = [];
    if (pageBackground) {
      fields.push(
        { name: 'background', label: 'Page background color', type: 'select', options: colorOptions(current.background, 'Theme background'), value: current.background || 'none' },
        { name: 'custom', label: 'Custom color', type: 'color', value: isHexColor(current.background) ? current.background : '#fde2e4' },
        { name: 'background2', label: 'Gradient to', type: 'select', options: colorOptions(current.background2, 'No gradient'), value: current.background2 || 'none' },
        { name: 'custom2', label: 'Second custom color', type: 'color', value: isHexColor(current.background2) ? current.background2 : '#ece4fb' },
        { name: 'direction', label: 'Gradient direction', type: 'select', options: Object.keys(gradientDirections).map((value) => [value, directionLabels[value]]), value: current.direction || 'to bottom' },
      );
    }
    if (pageEffects) {
      fields.push({ name: 'effect', label: 'Page effect (shown on the site)', type: 'select', options: [['none', 'No effect'], ...effectLabels], value: current.effect || 'none' });
    }
    this.dialog('Page background and effects', fields, (values) => {
      const pick = (choice, custom) => (choice === 'none' || !choice ? '' : choice === 'custom' ? custom : choice);
      const next = pageBackground
        ? { background: pick(values.background, values.custom), background2: pick(values.background2, values.custom2), direction: values.direction }
        : { background: current.background, background2: current.background2, direction: current.direction };
      next.effect = pageEffects ? (values.effect === 'none' ? '' : values.effect) : current.effect;
      this.setPageSettings(next);
    });
  },

  /** Apply new page settings: rewrite the leading comment and report the edit. */
  setPageSettings(settings) {
    const legacy = typeof this.config.legacyPageSettings === 'function' ? cleanPageSettings(this.config.legacyPageSettings() || {}) : {};
    this.pageSettings = cleanPageSettings(settings);
    // Nothing left to keep: an empty comment still overrides the page's former header fields.
    this.pagePrefix = pageSettingsPrefix(this.pageSettings) || (Object.keys(legacy).length ? '<!-- ve-page -->\n\n' : '');
    this.paintPage();
    this.sync();
  },

  /** Preview the page background on the editing surface, with readable text. */
  paintPage() {
    const wrap = this.editorWrap;
    if (!wrap) return;
    const { background, background2, direction } = this.config.pageBackground === false ? {} : this.currentPageSettings();
    wrap.style.background = background ? (background2 ? gradientCss(direction, background, background2) : background) : '';
    if (background) {
      const text = contrastText(background2 ? mixColors(background, background2) || background : background);
      wrap.style.setProperty('--ve-text', text);
      wrap.style.setProperty('--ve-muted', mutedText[text]);
    } else {
      wrap.style.removeProperty('--ve-text');
      wrap.style.removeProperty('--ve-muted');
    }
    this.toolbar?.querySelector('[data-action="pageSettings"]')?.setAttribute('aria-pressed', String(Boolean(background || this.currentPageSettings().effect)));
  },
};
