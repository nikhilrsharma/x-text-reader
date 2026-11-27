import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(path.join(root, name), 'utf8');
const modules = [
  ['SETTINGS_MODULE', 'settings-module.js'],
  ['READER_DATA', 'reader-data.js'],
  ['READER_UI', 'reader-ui.js'],
  ['HEADER_MODULE', 'header-module.js'],
  ['HEADER_STYLE', 'header-style.css'],
];
let source = await read('src/core.js');
for (const [marker, filename] of modules) {
  const token = `/* ${marker} */`;
  if (source.split(token).length !== 2) throw new Error(`Expected one ${marker} marker`);
  const content = await read(`src/${filename}`);
  source = source.replace(token, () => content); // Preserve literal dollar signs.
}
const { version } = JSON.parse(await read('package.json'));
if (!source.includes(`// @version      ${version}\n`)) throw new Error('Package and userscript versions differ');
const output = path.join(root, 'dist/x-text-reader.user.js');
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== source) throw new Error('Generated userscript is stale. Run npm run build.');
  console.log('Generated userscript matches source.');
} else {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, source);
  console.log(`Built dist/x-text-reader.user.js (${version}).`);
}
