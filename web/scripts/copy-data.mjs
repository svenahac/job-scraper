// Copies the scraper's output into the site. Vercel clones the whole repo, so
// ../data is available at build time; every nightly data commit redeploys.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'data', 'jobs.json');
const dest = join(here, '..', 'public', 'jobs.json');

mkdirSync(dirname(dest), { recursive: true });
if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log(`copied ${src} -> ${dest}`);
} else {
  writeFileSync(dest, JSON.stringify({
    generatedAt: new Date(0).toISOString(), windowDays: 60, sources: [], areas: [], jobs: [],
  }));
  console.warn(`no ${src}; wrote an empty data file`);
}
