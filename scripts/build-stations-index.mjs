// Regenerate data/stations/index.json from every data/stations/<id>.json list file.
// Run locally (`node scripts/build-stations-index.mjs`) and during the Pages deploy, so a
// PR that only adds one list file is enough — the index is rebuilt automatically.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = 'data/stations';
const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();

const lists = [];
for (const f of files) {
  try {
    const l = JSON.parse(await readFile(join(dir, f), 'utf8'));
    if (typeof l.lat !== 'number' || typeof l.lon !== 'number') { console.warn(`skip ${f}: missing lat/lon`); continue; }
    lists.push({
      id: f.replace(/\.json$/, ''),
      title: l.title || f,
      place: l.place || '',
      author: l.author || '',
      lat: l.lat, lon: l.lon,
      count: Array.isArray(l.channels) ? l.channels.length : 0,
    });
  } catch (e) { console.warn(`skip ${f}: ${e.message}`); }
}

await writeFile(join(dir, 'index.json'), JSON.stringify({ lists }, null, 2) + '\n');
console.log(`indexed ${lists.length} station list(s)`);
