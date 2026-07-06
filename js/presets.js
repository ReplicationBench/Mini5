// presets.js — built-in band presets (ready-made channel sets) for quick programming.
// Compact spec per channel: { name, rx(MHz), tx?(MHz), off?(MHz offset), pw:'H'|'L', bw:'W'|'N' }.
// presetToChannels() expands these into the object shape encodeChannel() expects.
//
// Frequencies are US band plans (except PMR446 = EU). Power maps to the radio's only two
// levels (High≈5W / Low≈1W); license-free services use Low to stay conservative. Legality
// is the operator's responsibility — see the on-page warning.

const seq = (start, step, n) => Array.from({ length: n }, (_, i) => +(start + i * step).toFixed(5));

const FRS_MAIN = [462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125];   // 1–7
const FRS_INT  = [467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125];   // 8–14
const FRS_HIGH = [462.5500, 462.5750, 462.6000, 462.6250, 462.6500, 462.6750, 462.7000, 462.7250]; // 15–22
const WX   = [162.400, 162.425, 162.450, 162.475, 162.500, 162.525, 162.550];
const MURS = [151.820, 151.880, 151.940, 154.570, 154.600];
const PMR  = seq(446.00625, 0.0125, 16);

export const PRESETS = [
  { key: 'wx', label: 'NOAA Weather', note: 'Receive-only weather channels (TX blocked).',
    channels: WX.map((f, i) => ({ name: `WX${i + 1}`, rx: f, pw: 'H', bw: 'W', rxonly: true })) },

  { key: 'frs', label: 'FRS (22)', note: 'License-free FRS. Narrow FM, low power.',
    channels: [...FRS_MAIN, ...FRS_INT, ...FRS_HIGH].map((f, i) => ({ name: `FRS ${i + 1}`, rx: f, pw: 'L', bw: 'N' })) },

  { key: 'gmrs', label: 'GMRS (30, incl. repeaters)', note: 'GMRS simplex + 8 repeater channels (+5 MHz). US license required.',
    channels: [
      ...FRS_MAIN.map((f, i) => ({ name: `GMRS ${i + 1}`, rx: f, pw: 'H', bw: 'W' })),
      ...FRS_INT.map((f, i) => ({ name: `GMRS ${i + 8}`, rx: f, pw: 'L', bw: 'N' })),
      ...FRS_HIGH.map((f, i) => ({ name: `GMRS ${i + 15}`, rx: f, pw: 'H', bw: 'W' })),
      ...FRS_HIGH.map((f, i) => ({ name: `RPT ${i + 1}`, rx: f, off: 5.0, pw: 'H', bw: 'W' })),
    ] },

  { key: 'murs', label: 'MURS (5)', note: 'License-free MURS. ≤2 W.',
    channels: MURS.map((f, i) => ({ name: `MURS ${i + 1}`, rx: f, pw: 'L', bw: i < 3 ? 'N' : 'W' })) },

  { key: 'pmr', label: 'PMR446 (16, EU)', note: 'European license-free. 0.5 W, narrow.',
    channels: PMR.map((f, i) => ({ name: `PMR ${i + 1}`, rx: f, pw: 'L', bw: 'N' })) },

  { key: '2m', label: '2 m FM simplex (US)', note: 'Ham 2 m calling + simplex spots.',
    channels: [146.520, 146.550, 146.580, 147.420, 147.450, 147.480, 147.510, 147.540]
      .map((f, i) => ({ name: i ? `2m ${i}` : '2m CALL', rx: f, pw: 'H', bw: 'W' })) },

  { key: '70cm', label: '70 cm FM simplex (US)', note: 'Ham 70 cm calling + simplex spots.',
    channels: [446.000, 446.025, 446.050, 446.075, 446.100, 446.125]
      .map((f, i) => ({ name: i ? `70cm ${i}` : '70cm CALL', rx: f, pw: 'H', bw: 'W' })) },
];

export function presetToChannels(preset) {
  return preset.channels.map((c) => ({
    name: c.name,
    rxFreq: Math.round(c.rx * 1e6),
    txFreq: Math.round((c.tx ?? (c.off != null ? c.rx + c.off : c.rx)) * 1e6),
    power: c.pw === 'L' ? 'Low' : 'High',
    wide: c.bw !== 'N',
    scan: false,
    rxOnly: !!c.rxonly,
    rxTone: { mode: '', value: 0 },
    txTone: { mode: '', value: 0 },
  }));
}
