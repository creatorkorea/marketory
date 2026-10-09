import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['fonts/PretendardVariable.woff2', 'fonts/OFL.txt', 'brand/marketory-stall.png'];
for (const file of files) {
  const source = await readFile(path.join(root, 'design-system/assets', file));
  const target = path.join(root, 'apps/web/public', file);
  if (process.argv.includes('--check')) {
    if (!source.equals(await readFile(target))) throw new Error(`Asset drift: ${file}`);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
}
console.log('Brand assets match the design source.');
