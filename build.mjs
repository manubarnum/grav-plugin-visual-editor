import { mkdir, rm, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

const root = process.cwd();
const output = join(root, 'dist');
const plugin = join(output, 'visual-editor');
// Admin2 discovers custom fields at admin-next/fields/<type>.js and imports them as ES modules.
const fieldModule = join('admin-next', 'fields', 'visual-editor.js');
await rm(output, { recursive: true, force: true });
await mkdir(join(plugin, 'admin-next', 'fields'), { recursive: true });

// The field module carries all its styles: Admin2 loads no stylesheet for it. alerts.css is shared
// with the front end (still shipped as a file for the frontend_alerts option).
const editorCss = (await readFile(join(root, 'assets', 'css', 'alerts.css'), 'utf8')) + '\n' + (await readFile(join(root, 'assets', 'css', 'editor.css'), 'utf8'));
/**
 * Yjs must be ONE instance in the page: Admin2 creates the shared fragment with its own copy and
 * publishes it on window.__GRAV_YJS__ (see src/collab.js). Bundling another copy would break
 * y-prosemirror's `instanceof` checks, so `yjs` and `y-protocols/awareness` resolve to relay modules
 * whose exports (the real packages' names, read here) are bound to Admin2's copy when collaboration
 * starts. Nothing reads them before that, so pages without collaboration never need the global.
 */
const sharedModules = { yjs: await import('yjs'), 'y-protocols/awareness': await import('y-protocols/awareness') };
const sharedYjs = {
  name: 'grav-shared-yjs',
  setup(builder) {
    builder.onResolve({ filter: /^(?:yjs|y-protocols\/awareness)$/ }, (args) => ({ path: args.path, namespace: 'grav-shared-yjs' }));
    builder.onLoad({ filter: /.*/, namespace: 'grav-shared-yjs' }, (args) => {
      const names = Object.keys(sharedModules[args.path]).filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
      return {
        loader: 'js',
        contents: names.map((name) => `export let ${name};`).join('\n')
          + `\nexport function __bindShared(source) { ${names.map((name) => `${name} = source.${name};`).join(' ')} }\n`,
      };
    });
  },
};
const bundled = await build({
  plugins: [sharedYjs],
  metafile: true,
  entryPoints: [join(root, 'src', 'admin2-field.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  outfile: join(plugin, fieldModule),
  define: { __VE_CSS__: JSON.stringify(editorCss) },
  minify: true,
  legalComments: 'eof',
  sourcemap: false,
});
// The repository is itself an installable plugin: keep its committed copy in sync.
await mkdir(join(root, 'admin-next', 'fields'), { recursive: true });
await copyFile(join(plugin, fieldModule), join(root, fieldModule));

for (const file of ['visual-editor.php', 'visual-editor.yaml', 'blueprints.yaml', 'composer.json', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
  await copyFile(join(root, file), join(plugin, file));
}
async function copyTree(folder) {
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const from = join(root, folder, entry.name);
    const to = join(plugin, folder, entry.name);
    if (entry.isDirectory()) { await mkdir(to, { recursive: true }); await copyTree(join(folder, entry.name)); }
    else { await mkdir(join(to, '..'), { recursive: true }); await copyFile(from, to); }
  }
}
await copyTree('classes');
// editor.css is bundled into the field module; only the front-end alert styles ship as a file.
await mkdir(join(plugin, 'assets', 'css'), { recursive: true });
await copyFile(join(root, 'assets', 'css', 'alerts.css'), join(plugin, 'assets', 'css', 'alerts.css'));

// Third-party notices for exactly the packages esbuild put in the bundle (read from its metafile).
// Packages sharing a license text are listed together. A bundled package without a license text
// (in the package, or in licenses/ for scopes that publish none) fails the build.
const fallbackLicenses = { '@tiptap/': join(root, 'licenses', 'tiptap-LICENSE.md') };
const packages = [...new Set(Object.keys(bundled.metafile.inputs)
  .map((input) => input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1])
  .filter(Boolean))].sort();
const byLicense = new Map();
for (const name of packages) {
  const folder = join(root, 'node_modules', name);
  const meta = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  const own = (await readdir(folder)).find((file) => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(file));
  const fallback = Object.entries(fallbackLicenses).find(([prefix]) => name.startsWith(prefix))?.[1];
  if (!own && !fallback) throw new Error(`No license text for bundled package ${name}: add one to licenses/`);
  const text = (await readFile(own ? join(folder, own) : fallback, 'utf8')).replace(/^<!--[\s\S]*?-->\s*/, '').trim();
  if (!byLicense.has(text)) byLicense.set(text, []);
  byLicense.get(text).push(`${name} ${meta.version} (${meta.license})`);
}
const notices = ['# Third-party notices', '', `The editor bundle (admin-next/fields/visual-editor.js) includes ${packages.length} packages, listed with their license.`];
for (const [text, names] of byLicense) notices.push('', `## ${names.join(', ')}`, '', text);
await writeFile(join(plugin, 'THIRD-PARTY-NOTICES.md'), notices.join('\n') + '\n');
// Shipped with the committed bundle too, since the repository itself installs as a plugin.
await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), notices.join('\n') + '\n');

async function files(directory, base = directory) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) list.push(...await files(path, base));
    else list.push({ path, name: relative(base, path).replaceAll('\\', '/') });
  }
  return list;
}
const manifest = [];
for (const file of await files(plugin)) {
  const digest = createHash('sha256').update(await readFile(file.path)).digest('hex');
  manifest.push(`${digest}  ${file.name}`);
}
await writeFile(join(plugin, 'SHA256SUMS'), manifest.join('\n') + '\n');
const zip = new AdmZip();
zip.addLocalFolder(plugin, 'visual-editor');
zip.writeZip(join(output, 'visual-editor.zip'));
console.log(`Built ${manifest.length} plugin files: dist/visual-editor/ and dist/visual-editor.zip`);
