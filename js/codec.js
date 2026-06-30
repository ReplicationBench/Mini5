// codec.js — Baofeng UV-5R Mini memory codec.
// Ported from CHIRP's baofeng_uv17Pro.py (kk7ds/chirp), GPLv3.
// Decodes/encodes the radio's memory image: 999 channels, settings layout, tones.

export const MINI5 = {
  MODEL: 'UV-5R Mini',
  // Read regions on the radio; the downloaded image concatenates them in order.
  MEM_STARTS: [0x0000, 0x9000, 0xA000],
  MEM_SIZES:  [0x8040, 0x0040, 0x01C0],
  MEM_TOTAL:  0x8240,         // sum of MEM_SIZES — assembled image length
  READ_BLOCK: 0x40,          // 64-byte read blocks (CHIRP BLOCK_SIZE)
  BLE_WRITE_BLOCK: 0x80,     // 128-byte write blocks over BLE
  CHANNELS: 999,
  CHAN_SIZE: 32,             // bytes per memory_obj
  CHAN_BASE: 0x0000,         // channels start at image offset 0
};

// chirp_common.DTCS_CODES + (645,), sorted (see baofeng_uv17Pro.py).
const DTCS_BASE = [
  23, 25, 26, 31, 32, 36, 43, 47, 51, 53, 54, 65, 71, 72, 73, 74, 114, 115, 116,
  122, 125, 131, 132, 134, 143, 145, 152, 155, 156, 162, 165, 172, 174, 205, 212,
  223, 225, 226, 243, 244, 245, 246, 251, 252, 255, 261, 263, 265, 266, 271, 274,
  306, 311, 315, 325, 331, 332, 343, 346, 351, 356, 364, 365, 371, 411, 412, 413,
  423, 431, 432, 445, 446, 452, 454, 455, 462, 464, 465, 466, 503, 506, 516, 523,
  526, 532, 546, 565, 606, 612, 624, 627, 631, 632, 654, 662, 664, 703, 712, 723,
  731, 732, 734, 743, 754,
];
export const DTCS_CODES = [...DTCS_BASE, 645].sort((a, b) => a - b);

// ---- frequency: lbcd[4], little-endian BCD, value is freq/10 (Hz = value*10) ----
export function decodeFreq(bytes) {            // bytes: 4-byte Uint8Array slice
  let n = 0, mult = 1;
  for (let i = 0; i < 4; i++) {
    const hi = bytes[i] >> 4, lo = bytes[i] & 0x0f;
    n += (lo + hi * 10) * mult;                // low nibble is less significant within the pair
    mult *= 100;
  }
  return n * 10;                               // Hz
}
export function encodeFreq(hz) {
  let v = Math.round(hz / 10);                 // 8 BCD digits
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const pair = v % 100; v = Math.floor(v / 100);
    out[i] = (Math.floor(pair / 10) << 4) | (pair % 10);
  }
  return out;
}

// ---- tones: ul16 (little-endian). decode_tone() / encode_tone() from CHIRP ----
export function decodeTone(val) {
  if (val === 0 || val === 0xFFFF) return { mode: '', value: 0, pol: 'N' };
  if (val >= 0x0258) return { mode: 'Tone', value: val / 10, pol: 'N' };  // CTCSS Hz
  // DTCS
  let index, pol;
  if (val > 0x69) { index = val - 0x6A; pol = 'R'; }
  else            { index = val - 1;    pol = 'N'; }
  return { mode: 'DTCS', value: DTCS_CODES[index], pol };
}
export function encodeTone({ mode, value, pol }) {
  if (mode === 'Tone' || mode === 'TSQL') return Math.round(value * 10);
  if (mode === 'DTCS') {
    const i = DTCS_CODES.indexOf(value);
    return (pol === 'R') ? i + 1 + 0x69 : i + 1;
  }
  return 0;
}
export function toneLabel(t) {
  if (t.mode === 'Tone') return `${t.value.toFixed(1)}`;
  if (t.mode === 'DTCS') return `D${String(t.value).padStart(3, '0')}${t.pol}`;
  return '';
}

export const POWER_LEVELS = ['High', 'Low'];   // index 0/1 (5W / 1W)

const td = new TextDecoder('latin1');

function readChannel(view, idx) {
  const base = MINI5.CHAN_BASE + idx * MINI5.CHAN_SIZE;
  const rx = view.subarray(base, base + 4);
  // Empty channel: rxfreq all 0xFF (CHIRP convention)
  if (rx[0] === 0xFF && rx[1] === 0xFF && rx[2] === 0xFF && rx[3] === 0xFF) return null;

  const rxFreq = decodeFreq(rx);
  const txFreq = decodeFreq(view.subarray(base + 4, base + 8));
  const rxtone = view[base + 8] | (view[base + 9] << 8);
  const txtone = view[base + 10] | (view[base + 11] << 8);
  const flags1 = view[base + 14];
  const flags2 = view[base + 15];

  let name = '';
  for (let i = 0; i < 12; i++) {
    const c = view[base + 20 + i];
    if (c === 0x00 || c === 0xFF) break;
    name += td.decode(Uint8Array.of(c));
  }

  return {
    number: idx + 1,
    rxFreq, txFreq,
    rxTone: decodeTone(rxtone),
    txTone: decodeTone(txtone),
    power: POWER_LEVELS[flags1 & 0x03] ?? 'High',
    wide: ((flags2 >> 6) & 1) === 1,           // 1=Wide(25k), 0=Narrow(12.5k)
    scan: ((flags2 >> 2) & 1) === 1,
    scode: view[base + 12],
    pttid: view[base + 13],
    name: name.trimEnd(),
  };
}

// Decode the full image into a sparse list of programmed channels.
export function decodeChannels(image) {
  const view = image instanceof Uint8Array ? image : new Uint8Array(image);
  const out = [];
  for (let i = 0; i < MINI5.CHANNELS; i++) {
    const ch = readChannel(view, i);
    if (ch) out.push(ch);
  }
  return out;
}

export const MHz = (hz) => (hz / 1e6).toFixed(5);
