// repeaters.js — parse a RepeaterBook CSV export into plottable repeaters, and turn a
// repeater into a channel for the radio. Header-driven + fuzzy column matching, so it
// tolerates RepeaterBook's varying export column names. Pure functions (no DOM).

function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim()));
}

const num = (s) => { const n = parseFloat(String(s).replace(/[^0-9.+-]/g, '')); return Number.isFinite(n) ? n : null; };

// Parse a PL/tone cell into {mode,value}. "100.0"->CTCSS; "D023"/"023 DPL"->DTCS; else none.
function toneFromCell(s) {
  const t = String(s || '').trim().toUpperCase();
  if (!t || t === 'CSQ' || t === 'OFF' || t === 'NONE') return { mode: '', value: 0 };
  if (/D|DPL|DCS/.test(t)) { const m = t.match(/(\d{2,3})/); if (m) return { mode: 'DTCS', value: parseInt(m[1], 10) }; }
  const f = parseFloat(t);
  if (Number.isFinite(f) && f >= 60 && f <= 260) return { mode: 'Tone', value: f };   // CTCSS range
  return { mode: '', value: 0 };
}

export function parseRepeaterCsv(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { repeaters: [], error: 'No data rows found.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...keys) => header.findIndex((h) => keys.some((k) => h === k || h.includes(k)));

  const iFreq  = col('output freq', 'frequency', 'freq', 'output');
  const iInput = col('input freq', 'input');
  const iOff   = col('offset');
  const iPL    = col('uplink tone', 'tx tone', 'pl', 'ctcss', 'tone');     // tone to ACCESS repeater (our TX)
  const iTSQ   = col('downlink tone', 'rx tone', 'tsq');                   // optional RX tone
  const iLat   = col('lat');
  const iLon   = col('long', 'lon');
  const iCall  = col('call');
  const iLoc   = col('nearest city', 'location', 'landmark', 'city', 'county');

  if (iFreq < 0) return { repeaters: [], error: 'No frequency column found. Use a RepeaterBook CSV export.' };
  if (iLat < 0 || iLon < 0) return { repeaters: [], error: 'No latitude/longitude columns — the map needs a RepeaterBook export (CHIRP CSVs have no coordinates).' };

  const repeaters = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const fMHz = num(row[iFreq]); const lat = num(row[iLat]); const lon = num(row[iLon]);
    if (fMHz == null || lat == null || lon == null) continue;
    const freqHz = Math.round(fMHz * 1e6);
    let txHz = freqHz;
    if (iInput >= 0 && num(row[iInput]) != null) txHz = Math.round(num(row[iInput]) * 1e6);
    else if (iOff >= 0 && num(row[iOff]) != null) txHz = freqHz + Math.round(num(row[iOff]) * 1e6);
    repeaters.push({
      call: (row[iCall] || '').trim(),
      location: (row[iLoc] || '').trim(),
      freqHz, txHz,
      txTone: iPL >= 0 ? toneFromCell(row[iPL]) : { mode: '', value: 0 },
      rxTone: iTSQ >= 0 ? toneFromCell(row[iTSQ]) : { mode: '', value: 0 },
      lat, lon,
    });
  }
  return { repeaters, error: repeaters.length ? null : 'No rows with usable frequency + coordinates.' };
}

export function repeaterToChannel(r) {
  const name = (r.call || r.location || 'RPT').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 12);
  return {
    name,
    rxFreq: r.freqHz,
    txFreq: r.txHz || r.freqHz,
    power: 'High',
    wide: true,
    scan: false,
    rxTone: r.rxTone || { mode: '', value: 0 },
    txTone: r.txTone || { mode: '', value: 0 },
  };
}
