import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { contrastText, mixColors } from '../src/markdown.js';

// Some knowledge must live in several places (Grav reads defaults from the YAML, the admin form from the
// blueprint; the contrast rule runs in PHP and JS). These tests fail as soon as the copies drift apart.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const defaults = yaml.load(read('visual-editor.yaml'));
const blueprint = yaml.load(read('blueprints.yaml'));
const formFields = blueprint.form.fields.tabs.fields.general.fields;
const asYaml = (field, value) => (field.type === 'toggle' ? Boolean(Number(value)) : value);

test('every blueprint default equals the YAML default', () => {
  for (const [name, field] of Object.entries(formFields)) {
    if (field.default === undefined) continue;
    assert.deepEqual(asYaml(field, field.default), defaults[name], name);
  }
});

test('every plugin option has a form field, and the reverse', () => {
  const formOnly = Object.keys(formFields).filter((name) => !(name in defaults));
  const yamlOnly = Object.keys(defaults).filter((name) => !(name in formFields) && name !== 'shortcodes');
  assert.deepEqual(formOnly, []);
  assert.deepEqual(yamlOnly, [], 'options without a form field (shortcodes is edited in YAML on purpose)');
});

test('the toolbar default is the same in the YAML, the blueprint description and the editor', async () => {
  const list = (text) => text.split(',').map((item) => item.trim().replace(/\.$/, '')).filter(Boolean);
  const yamlToolbar = list(defaults.toolbar);
  assert.deepEqual(list(formFields.toolbar.description.replace(/^Available:\s*/, '')), yamlToolbar);
  const { defaultConfig } = await import('../src/editor.js');
  assert.deepEqual(defaultConfig.toolbar, yamlToolbar);
});

test('the JS contrast rule matches the shared fixture (the PHP tests check the same file)', () => {
  for (const { color, text } of JSON.parse(read('tests/fixtures/contrast.json'))) assert.equal(contrastText(color), text, color);
});

test('plain tables do not show their header row in bold in the editor', () => {
  const css = read('assets/css/editor.css');
  assert.match(css, /\.ve-table-style\[data-style=plain\] th[^{]*\{[^}]*font-weight:inherit/);
});

test('mixing two colors gives the same result in JS and PHP (gradient text color)', () => {
  assert.equal(mixColors('#fde2e4', '#ece4fb'), '#f5e3f0');
  assert.equal(mixColors('#000', '#fff'), '#808080');
  assert.equal(mixColors('rgb(10, 20, 30)', '#1e2832'), '#141e28');
  assert.equal(mixColors('#fde2e4', 'red'), '');
});
