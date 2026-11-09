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

const editorCss = await readFile(join(root, 'assets', 'css', 'editor.css'), 'utf8');
await build({
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

const notices = ['MIT License notices for bundled dependencies:'];
for (const folder of await readdir(join(root, 'node_modules', '@tiptap'))) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { const license = await readFile(join(root, 'node_modules', '@tiptap', folder, name), 'utf8'); notices.push(`\n## @tiptap/${folder}\n${license}`); break; } catch {}
  }
}
for (const name of ['marked']) {
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { notices.push(`\n## ${name}\n${await readFile(join(root, 'node_modules', name, file), 'utf8')}`); break; } catch {}
  }
}
await writeFile(join(plugin, 'THIRD-PARTY-NOTICES.md'), notices.join('\n'));

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
