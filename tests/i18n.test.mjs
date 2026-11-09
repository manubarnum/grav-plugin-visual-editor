import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Every user-visible English string passed through the translation points must have a French entry.
const { dictionaries } = await import('../src/i18n.js');
const { labels, messages } = await import('../src/editor/ui.js');

function uiStrings() {
  const files = ['src/editor.js', 'src/extensions.js', ...readdirSync(new URL('../src/editor/', import.meta.url)).map((f) => `src/editor/${f}`)];
  const found = new Set([...Object.values(labels), ...Object.values(messages)]);
  const patterns = [
    /\bt\('((?:[^'\\]|\\.)+)'/g, // t('…')
    /\blabel: '([^']+)'/g, // dialog field labels
    /\bdialog\('([^']+)'/g, // dialog titles
    /\? '([^']+)' : '([^']+)'/g, // conditional titles/labels
    /\bbutton\('[^']+', '([^']+)'/g, // buttons
    /\bnotify\('([^']+)'/g, // notices
    /\['[\w-]+', '([^']+)'\]/g, // [value, label] option and command lists
    /\[(?:\d+|null), '([^']+)'\]/g, // width presets, heading levels
    /'#[0-9a-f]{6}', '([^']+)'/g, // color presets
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) match.slice(1).filter(Boolean).forEach((text) => found.add(text.replace(/\\'/g, "'")));
  }
  return [...found].filter((text) => /[a-z]/i.test(text) && !/^(?:[a-z]+(?:[A-Z][a-z]+)+|[a-z-]+)$/.test(text));
}

test('every interface string has a French translation', () => {
  const missing = uiStrings().filter((text) => !(text in dictionaries.fr));
  assert.deepEqual(missing, []);
});

test('placeholders are kept in translations', () => {
  for (const [english, french] of Object.entries(dictionaries.fr)) {
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(french), names(english), english);
  }
});
