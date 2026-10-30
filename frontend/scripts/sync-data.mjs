// Copies the committed pipeline output (data/processed) into frontend/public/data so Vite serves it at /data/.
// The destination is gitignored; data/processed stays the single source of truth.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../data/processed');
const dest = resolve(here, '../public/data');

if (!existsSync(join(src, 'index.json'))) {
  console.error(`sync-data: ${join(src, 'index.json')} not found. Run the pipeline first (npm run pipeline -- run --state <slug>).`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, 'boundaries'), { recursive: true });

const wanted = (name) => name === 'index.json' || name.endsWith('.geojson') || name.endsWith('.report.json');
let copied = 0;
for (const name of readdirSync(src)) {
  if (wanted(name)) {
    cpSync(join(src, name), join(dest, name));
    copied += 1;
  }
}
const boundaries = join(src, 'boundaries');
if (existsSync(boundaries)) {
  for (const name of readdirSync(boundaries)) {
    if (name.endsWith('.geojson')) {
      cpSync(join(boundaries, name), join(dest, 'boundaries', name));
      copied += 1;
    }
  }
}
console.log(`sync-data: copied ${copied} files from data/processed to frontend/public/data`);
