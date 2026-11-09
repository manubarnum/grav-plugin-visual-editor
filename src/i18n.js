/**
 * Interface translations. Keys are the English strings (English needs no dictionary), so code reads
 * naturally and an untranslated string simply stays in English. `{name}` placeholders take params.
 * The locale follows Admin2 (window.__GRAV_I18N.locale), else <html lang>; it is read when an editor
 * is created.
 */
import fr from './i18n/fr.js';

export const dictionaries = { fr };

let current = 'en';

export function detectLocale() {
  const raw = (typeof window !== 'undefined' && window.__GRAV_I18N?.locale) || (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
  return String(raw).toLowerCase().split(/[-_]/)[0];
}

export function setLocale(locale) {
  current = dictionaries[locale] ? locale : 'en';
}

export function t(text, params) {
  const translated = dictionaries[current]?.[text] ?? text;
  return params ? translated.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : translated;
}
