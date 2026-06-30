// codec.js — Baofeng UV-5R Mini memory codec.
//
// Channel/settings memory is XOR-obfuscated on the wire with a rotating key, keyed by
// each byte's position within the 64-byte transfer block. The de-obfuscation algorithm
// and field layout were cross-referenced from CHIRP's UV5RMini driver (GPLv3) and the
// interoperability facts in dz0ny/5r-mini-ble-tool (RE'd from the OEM "Ola" app).
// No third-party source was copied. The in-memory image we hold is the RAW (obfuscated)
// bytes exactly as downloaded; decode de-obfuscates, encode re-obfuscates in place.

export const MINI5 = {
  MODEL: 'UV-5R Mini',
  MEM_STARTS: [0x0000, 0x9000, 0xA000],
  MEM_SIZES:  [0x8040, 0x0040, 0x01C0],
  MEM_TOTAL:  0x8240,
  READ_BLOCK: 0x40,
  BLE_WRITE_BLOCK: 0x80,
  BLOCK: 0x40,            // transfer block size that the XOR position is keyed to
  CHANNELS: 999,
  CHAN_SIZE: 0x20,
  CHAN_BASE: 0x0000,
};

// Position-keyed XOR obfuscation. Involution (applying twice restores the original),
// so the same function both decodes and encodes. `off` is the absolute image offset.
const CRYPT_KEY = [0x43, 0x4f, 0x20, 0x37];   // "CO 7"
export function cryptByte(b, off) {
  const k = CRYPT_KEY[(off % MINI5.BLOCK) % CRYPT_KEY.length];
  if (k !== 0x20 && b !== 0x00 && b !== 0xff && b !== k && b !== (k ^ 0xff)) return b ^ k;
  return b;
}
const plainAt = (img, off) => cryptByte(img[off], off);
const setPlain = (img, off, v) => { img[off] = cryptByte(v & 0xff, off); };

// ---- frequency: lbcd[4], little-endian BCD; value/100000 = MHz (×10 = Hz). Operates on
// de-obfuscated bytes. Returns 0 for empty (all 0x00/0xFF) or malformed (non-BCD nibble). --
export function decodeFreq(bytes) {
  if (bytes.every((v) => v === 0x00 || v === 0xff)) return 0;
  let n = 0, mult = 1;
  for (let i = 0; i < 4; i++) {
    const hi = bytes[i] >> 4, lo = bytes[i] & 0x0f;
    if (hi > 9 || lo > 9) return 0;
    n += (lo + hi * 10) * mult;
    mult *= 100;
  }
  return n * 10;   // Hz
}
export function encodeFreq(hz) {
  if (!hz || hz <= 0) return new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  let v = Math.round(hz / 10);
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) { const p = v % 100; v = Math.floor(v / 100); out[i] = (Math.floor(p / 10) << 4) | (p % 10); }
  return out;
}

// ---- tones: ul16. 0/0xFFFF = none; >=0x0258 = CTCSS (value/10 Hz); else DCS code. ----
export function decodeTone(val) {
  if (val === 0 || val === 0xffff) return { mode: '', value: 0 };
  if (val >= 0x0258) return { mode: 'Tone', value: Math.round(val) / 10 };
  return { mode: 'DTCS', value: val };
}
export function encodeTone({ mode, value } = {}) {
  if (mode === 'Tone') return Math.round(value * 10) & 0xffff;
  if (mode === 'DTCS') return value & 0xffff;
  return 0;
}
export function toneLabel(t) {
  if (!t || !t.mode) return '';
  if (t.mode === 'Tone') return t.value.toFixed(1);
  return 'D' + String(t.value).padStart(3, '0');
}
export function parseTone(str) {
  const s = (str || '').trim().toUpperCase();
  if (!s || s === 'OFF') return { mode: '', value: 0 };
  if (s[0] === 'D') {
    const code = parseInt(s.slice(1), 10);
    if (Number.isInteger(code) && code >= 1 && code <= 0x257) return { mode: 'DTCS', value: code };
    return null;
  }
  const f = parseFloat(s.replace(/^T/, ''));
  if (!isNaN(f) && f * 10 >= 0x0258) return { mode: 'Tone', value: f };
  return null;
}

export const POWER_LEVELS = ['High', 'Low'];   // index = flags[14] & 1
const te = new TextEncoder();

function readChannel(img, idx) {
  const base = MINI5.CHAN_BASE + idx * MINI5.CHAN_SIZE;
  // Empty slot: every RAW byte is 0x00 or 0xFF.
  let empty = true;
  for (let i = 0; i < MINI5.CHAN_SIZE; i++) { const r = img[base + i]; if (r !== 0x00 && r !== 0xff) { empty = false; break; } }
  if (empty) return null;

  const p = new Uint8Array(MINI5.CHAN_SIZE);
  for (let i = 0; i < MINI5.CHAN_SIZE; i++) p[i] = plainAt(img, base + i);

  let name = '';
  for (let i = 0; i < 12; i++) { const c = p[20 + i]; if (c === 0x00 || c === 0xff) break; name += String.fromCharCode(c); }

  return {
    number: idx + 1,
    rxFreq: decodeFreq(p.subarray(0, 4)),
    txFreq: decodeFreq(p.subarray(4, 8)),
    rxTone: decodeTone(p[8] | (p[9] << 8)),
    txTone: decodeTone(p[10] | (p[11] << 8)),
    power: POWER_LEVELS[p[14] & 0x01] ?? 'High',
    wide: ((p[15] >> 1) & 1) === 0,     // width bit: 0 = Wide, 1 = Narrow
    scan: ((p[15] >> 5) & 1) === 1,
    name: name.replace(/\s+$/, ''),
  };
}

export function decodeChannels(image) {
  const view = image instanceof Uint8Array ? image : new Uint8Array(image);
  const out = [];
  for (let i = 0; i < MINI5.CHANNELS; i++) { const ch = readChannel(view, i); if (ch) out.push(ch); }
  return out;
}

// Write a channel record (re-obfuscating in place). Existing slots preserve unmanaged
// bytes; fresh=true initialises the record for a previously-empty slot.
export function encodeChannel(image, idx, ch, { fresh = false } = {}) {
  const view = image instanceof Uint8Array ? image : new Uint8Array(image);
  const base = MINI5.CHAN_BASE + idx * MINI5.CHAN_SIZE;

  const rxB = encodeFreq(ch.rxFreq);
  const txB = encodeFreq(ch.txFreq && ch.txFreq > 0 ? ch.txFreq : ch.rxFreq);
  for (let i = 0; i < 4; i++) setPlain(view, base + i, rxB[i]);
  for (let i = 0; i < 4; i++) setPlain(view, base + 4 + i, txB[i]);

  const rt = encodeTone(ch.rxTone), tt = encodeTone(ch.txTone);
  setPlain(view, base + 8, rt & 0xff); setPlain(view, base + 9, (rt >> 8) & 0xff);
  setPlain(view, base + 10, tt & 0xff); setPlain(view, base + 11, (tt >> 8) & 0xff);

  let f14 = fresh ? 0x00 : plainAt(view, base + 14);
  f14 = (f14 & ~0x01) | (Math.max(0, POWER_LEVELS.indexOf(ch.power)) & 0x01);
  setPlain(view, base + 14, f14);

  let f15 = fresh ? 0x00 : plainAt(view, base + 15);
  f15 = (f15 & ~((1 << 1) | (1 << 5))) | (ch.wide ? 0 : (1 << 1)) | (ch.scan ? (1 << 5) : 0);
  setPlain(view, base + 15, f15);

  if (fresh) { setPlain(view, base + 12, 0); setPlain(view, base + 13, 0); for (let i = 16; i < 20; i++) setPlain(view, base + i, 0); }

  const nm = te.encode((ch.name || '').slice(0, 12));
  for (let i = 0; i < 12; i++) setPlain(view, base + 20 + i, i < nm.length ? nm[i] : 0x00);
  return view;
}

export function clearChannel(image, idx) {
  const view = image instanceof Uint8Array ? image : new Uint8Array(image);
  const base = MINI5.CHAN_BASE + idx * MINI5.CHAN_SIZE;
  view.fill(0xFF, base, base + MINI5.CHAN_SIZE);
  return view;
}

export function firstEmptySlot(image) {
  const view = image instanceof Uint8Array ? image : new Uint8Array(image);
  for (let i = 0; i < MINI5.CHANNELS; i++) {
    const base = MINI5.CHAN_BASE + i * MINI5.CHAN_SIZE;
    let empty = true;
    for (let j = 0; j < MINI5.CHAN_SIZE; j++) { const r = view[base + j]; if (r !== 0x00 && r !== 0xff) { empty = false; break; } }
    if (empty) return i;
  }
  return -1;
}

export const MHz = (hz) => (hz / 1e6).toFixed(5);
