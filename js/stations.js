// stations.js — community station lists (pure-GitHub: JSON files in data/stations/).
// Load the index + individual lists, convert a list to channels, and build a new list
// JSON from the user's current channels for PR contribution.
import { parseTone } from './codec.js';

const BASE = 'data/stations';

export async function loadIndex() {
  const r = await fetch(`${BASE}/index.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load shared-list index (${r.status}).`);
  return (await r.json()).lists || [];
}
export async function loadList(id) {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load list "${id}" (${r.status}).`);
  return await r.json();
}

// Compact list-channel spec -> the object encodeChannel() expects.
export function stationToChannels(list) {
  return (list.channels || []).map((c) => {
    const rx = Number(c.rx);
    const tx = c.tx != null ? Number(c.tx) : (c.off != null ? rx + Number(c.off) : rx);
    return {
      name: String(c.name || '').slice(0, 12),
      rxFreq: Math.round(rx * 1e6),
      txFreq: Math.round(tx * 1e6),
      power: c.power === 'Low' ? 'Low' : 'High',
      wide: c.bw !== 'N',
      scan: !!c.scan,
      rxOnly: !!c.rxonly,
      rxTone: parseTone(c.rxtone || '') || { mode: '', value: 0 },
      txTone: parseTone(c.tone || c.txtone || '') || { mode: '', value: 0 },
    };
  });
}

const toneStr = (t) => t?.mode === 'Tone' ? String(t.value)
  : t?.mode === 'DTCS' ? 'D' + String(t.value).padStart(3, '0') : '';

// Build a shareable list JSON from decoded channels + metadata.
export function buildListJson(meta, channels) {
  return {
    title: meta.title,
    place: meta.place || '',
    author: meta.author || '',
    description: meta.description || '',
    lat: Number(meta.lat),
    lon: Number(meta.lon),
    channels: channels.map((c) => {
      const o = { name: c.name, rx: +(c.rxFreq / 1e6).toFixed(5) };
      if (c.rxOnly) o.rxonly = true;
      else if (c.txFreq && c.txFreq !== c.rxFreq) o.tx = +(c.txFreq / 1e6).toFixed(5);
      const tt = toneStr(c.txTone); if (tt) o.tone = tt;
      const rt = toneStr(c.rxTone); if (rt) o.rxtone = rt;
      o.power = c.power; o.bw = c.wide ? 'W' : 'N';
      return o;
    }),
  };
}

export const slugify = (s) => String(s || 'list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'list';
