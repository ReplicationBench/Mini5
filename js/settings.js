// settings.js — the UV-5R Mini's radio settings in the 0x9000 block. Addresses and option
// values are interoperability facts cross-referenced from the OEM app (via dz0ny/5r-mini-ble-
// tool) and CHIRP's driver; no third-party code was copied. Each byte read/written through the
// de-obfuscating getByte/setByte in codec.js.
import { getByte, setByte } from './codec.js';

const OFF_ON = [[0, 'Off'], [1, 'On']];
const range = (n, from = 0, fmt = String) => Array.from({ length: n }, (_, i) => [i + from, fmt(i + from)]);

export const SETTINGS = [
  { group: 'Squelch, power & TX', key: 'squelch', label: 'Squelch', addr: 0x9000, options: range(6) },
  { group: 'Squelch, power & TX', key: 'save', label: 'Battery Save', addr: 0x9001, options: OFF_ON },
  { group: 'Squelch, power & TX', key: 'timeout', label: 'TX Timeout (TOT)', addr: 0x9005,
    options: [[0, 'Off'], ...range(12, 1, (v) => `${v * 15}s`)] },
  { group: 'Squelch, power & TX', key: 'bcl', label: 'Busy Lock (BCL)', addr: 0x900f, options: OFF_ON },
  { group: 'Squelch, power & TX', key: 'rTone', label: 'Repeater Tone Burst', addr: 0x901d,
    options: [[0, '1000 Hz'], [1, '1450 Hz'], [2, '1750 Hz'], [3, '2100 Hz']] },

  { group: 'Audio & alerts', key: 'vox', label: 'VOX Level', addr: 0x9002, options: range(9, 1) },
  { group: 'Audio & alerts', key: 'voxSwitch', label: 'VOX', addr: 0x901e, options: OFF_ON },
  { group: 'Audio & alerts', key: 'beep', label: 'Key Beep', addr: 0x9006, options: OFF_ON },
  { group: 'Audio & alerts', key: 'voiceSwitch', label: 'Voice Prompt', addr: 0x9007, options: OFF_ON },
  { group: 'Audio & alerts', key: 'voice', label: 'Voice Language', addr: 0x9008, options: [[0, 'English'], [1, 'Chinese']] },
  { group: 'Audio & alerts', key: 'roger', label: 'Roger Beep', addr: 0x9017, options: OFF_ON },
  { group: 'Audio & alerts', key: 'alarmMode', label: 'Alarm Mode', addr: 0x9011, options: [[0, 'Site'], [1, 'Tone'], [2, 'Code']] },

  { group: 'Display & UI', key: 'backlight', label: 'Backlight', addr: 0x9003,
    options: [[0, 'Always on'], [1, '5s'], [2, '10s'], [3, '15s'], [4, '20s']] },
  { group: 'Display & UI', key: 'channelADisplay', label: 'A Display', addr: 0x900d, options: [[0, 'Channel'], [1, 'Frequency'], [2, 'Name']] },
  { group: 'Display & UI', key: 'channelBDisplay', label: 'B Display', addr: 0x900e, options: [[0, 'Channel'], [1, 'Frequency'], [2, 'Name']] },
  { group: 'Display & UI', key: 'powerOnDisplay', label: 'Power-On Display', addr: 0x901c, options: [[0, 'Logo'], [1, 'Battery voltage']] },
  { group: 'Display & UI', key: 'menuQuit', label: 'Menu Exit Time', addr: 0x9021, options: range(10, 0, (v) => `${(v + 1) * 5 > 55 ? 60 : (v + 1) * 5}s`) },
  { group: 'Display & UI', key: 'fmEnable', label: 'FM Broadcast Radio', addr: 0x9019, options: OFF_ON },

  { group: 'Keys & scan', key: 'dualWatch', label: 'Dual Watch', addr: 0x9004, options: OFF_ON },
  { group: 'Keys & scan', key: 'scanMode', label: 'Scan Resume', addr: 0x900a, options: [[0, 'Time'], [1, 'Carrier'], [2, 'Search']] },
  { group: 'Keys & scan', key: 'pttId', label: 'PTT-ID Mode', addr: 0x900b, options: [[0, 'Off'], [1, 'Begin'], [2, 'End'], [3, 'Both']] },
  { group: 'Keys & scan', key: 'autoLock', label: 'Auto Keypad Lock', addr: 0x9010, options: OFF_ON },
  { group: 'Keys & scan', key: 'keyLock', label: 'Keypad Lock', addr: 0x901b, options: [[0, 'Unlocked'], [1, 'Locked']] },
  { group: 'Keys & scan', key: 'sideKeyShort', label: 'Side Key (short press)', addr: 0x9032,
    options: [[3, 'Alarm'], [7, 'FM Radio'], [8, 'Flashlight'], [28, 'Scan'], [29, 'Freq Search'], [45, 'VOX']] },
];

export const SETTING_GROUPS = [...new Set(SETTINGS.map((s) => s.group))];

export function decodeSettings(image) {
  return SETTINGS.map((s) => {
    const value = getByte(image, s.addr);
    const opt = s.options.find((o) => o[0] === value);
    return { ...s, value, valueLabel: opt ? opt[1] : `raw ${value}` };  // keep s.label = field name
  });
}

export function applySetting(image, key, value) {
  const s = SETTINGS.find((x) => x.key === key);
  if (s) setByte(image, s.addr, Number(value) & 0xff);
}
