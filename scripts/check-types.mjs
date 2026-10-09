import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const files = ['packages/types/openapi.json', 'packages/types/src/api.d.ts'];
const before = files.map(file => readFileSync(file));
execSync('npm run types:generate', { stdio: 'inherit' });
for (const [i, file] of files.entries()) {
  if (!before[i].equals(readFileSync(file))) throw new Error(`Generated contract drift: ${file}`);
}
console.log('OpenAPI and generated TypeScript are current.');
