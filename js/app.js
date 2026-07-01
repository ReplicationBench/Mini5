// app.js — UI wiring: connect, download, save/load .img, decode table, channel editor.
import { Mini5Radio } from './radio.js';
import {
  MINI5, decodeChannels, encodeChannel, clearChannel, firstEmptySlot,
  parseTone, toneLabel, MHz,
} from './codec.js';
import { PRESETS, presetToChannels } from './presets.js';
import { createRepeaterMap } from './map.js';
import { loadIndex, loadList, stationToChannels, buildListJson, slugify } from './stations.js';

const $ = (id) => document.getElementById(id);
const radio = new Mini5Radio();
let image = null;           // in-memory image (Uint8Array)
let edit = { slot: -1, fresh: false };
let selfTestBaseline = null;   // when set, the next download is compared to this

function log(msg, kind = '') {
  const line = document.createElement('div');
  line.className = `logline ${kind}`;
  line.textContent = msg;
  $('log').append(line);
  $('log').scrollTop = $('log').scrollHeight;
}
radio.onLog = log;
radio.onDisconnect = () => { setStatus('Disconnected', 'warn'); syncButtons(); };

function setStatus(text, kind = '') { const s = $('status'); s.textContent = text; s.className = `status ${kind}`; }
function syncButtons() {
  const c = radio.connected;
  $('btnConnect').disabled = c;
  $('btnDownload').disabled = !c;
  $('btnUpload').disabled = !c || !image;
  $('btnVerify').disabled = !c;
  $('btnSave').disabled = !image;
  $('btnAdd').disabled = !image;
}
function progress(p) { $('bar').style.width = `${Math.round(p * 100)}%`; }

// ---- radio actions ----------------------------------------------------------
async function connect(pickAny) {
  setStatus('Requesting device…');
  try { await radio.connect({ pickAny }); setStatus(`Connected: ${radio.device.name || 'radio'}`, 'ok'); }
  catch (e) { log(e.message, 'err'); setStatus('Connect failed', 'err'); }
  syncButtons();
}
async function download() {
  setStatus('Downloading from radio…'); progress(0); $('btnDownload').disabled = true;
  try {
    image = await radio.download(progress);
    renderChannels();
    if (selfTestBaseline) {                       // step 2 of the write self-test
      const diffs = compareImages(selfTestBaseline, image);
      selfTestBaseline = null;
      if (diffs.length === 0) {
        setStatus('✅ Self-test PASSED — re-read matches the baseline exactly. Write-back is lossless.', 'ok');
        log('Self-test PASSED: 0 bytes differ from baseline.', 'ok');
      } else {
        setStatus(`⚠️ Self-test: ${diffs.length} byte(s) differ from baseline (see log).`, 'warn');
        log(`Differing offsets (first 16): ${diffs.slice(0, 16).map((o) => '0x' + o.toString(16)).join(', ')}`, 'warn');
        log("A few diffs may be volatile state the radio rewrites on reboot. Many diffs mean the write map needs work — don't trust edited writes yet.", 'warn');
      }
    } else {
      setStatus(`Downloaded — ${$('count').textContent}`, 'ok');
    }
  } catch (e) { log(e.message, 'err'); setStatus('Download failed (see log)', 'err'); }
  syncButtons();
}
function compareImages(a, b) {
  const d = []; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n && d.length <= 256; i++) if (a[i] !== b[i]) d.push(i);
  return d;
}
async function upload() {
  if (!image) return;
  if (!confirm('Write this image to the radio? This OVERWRITES its memory.\n\n'
    + 'Recommended: run the Write self-test first, and keep a backup .img. Proceed?')) return;
  setStatus('Uploading to radio…'); progress(0);
  try { await radio.upload(image, progress); setStatus('Upload complete', 'ok'); }
  catch (e) { log(e.message, 'err'); setStatus('Upload failed (see log)', 'err'); }
  syncButtons();
}

// Two-step write self-test. Step 1 (here): download a baseline and write it back
// unchanged — the radio then reboots. Step 2: the user reconnects and clicks Download,
// and download() compares that fresh read to selfTestBaseline.
async function selfTest() {
  if (!radio.connected) return;
  if (!confirm('Write self-test (two-step)\n\n'
    + 'Step 1 (now): download a baseline and write it back UNCHANGED. The radio will reboot.\n'
    + 'Step 2: when it powers back on, click "Connect radio" then "Download" — I\'ll compare '
    + 'automatically and confirm the write was lossless.\n\n'
    + 'Keep a backup .img first. Proceed?')) return;
  setStatus('Self-test: downloading baseline…'); progress(0);
  for (const b of document.querySelectorAll('.toolbar button')) b.disabled = true;
  try {
    const baseline = await radio.download((p) => progress(p * 0.5));
    image = baseline; renderChannels();
    setStatus('Self-test: writing baseline back…');
    await radio.upload(baseline, (p) => progress(0.5 + p * 0.5));
    selfTestBaseline = baseline.slice();          // arm the compare for the next download
    setStatus('✅ Write sent — radio is rebooting. Now: Connect → Download, and I\'ll verify it.', 'ok');
    log('Self-test step 1 done. When the radio is back: Connect, then Download to verify (auto-compares to baseline).', 'ok');
  } catch (e) { log(e.message, 'err'); setStatus('Self-test write failed (see log)', 'err'); selfTestBaseline = null; }
  syncButtons();
}

// ---- file actions -----------------------------------------------------------
function saveImg() {
  if (!image) return;
  const trailer = new TextEncoder().encode(MINI5.MODEL);     // CHIRP-style model trailer
  const blob = new Blob([image, trailer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mini5-${new Date().toISOString().slice(0, 10)}.img`;
  a.click(); URL.revokeObjectURL(a.href);
}
async function loadImg(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  image = buf.slice(0, MINI5.MEM_TOTAL);
  renderChannels(); setStatus(`Loaded ${file.name} — ${$('count').textContent}`, 'ok'); syncButtons();
}

// ---- channel table ----------------------------------------------------------
const esc = (s) => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

function renderChannels() {
  const chans = decodeChannels(image);
  $('count').textContent = `${chans.length} channels`;
  $('rows').innerHTML = chans.map((c) => {
    const off = (c.txFreq && c.txFreq !== c.rxFreq)
      ? `${c.txFreq > c.rxFreq ? '+' : ''}${((c.txFreq - c.rxFreq) / 1e6).toFixed(4)}` : '';
    return `<tr data-slot="${c.number - 1}">
      <td class="num">${c.number}</td>
      <td class="name">${esc(c.name) || '<span class="dim">—</span>'}</td>
      <td class="freq">${MHz(c.rxFreq)}</td>
      <td class="freq dim">${off}</td>
      <td>${toneLabel(c.rxTone) || '<span class="dim">—</span>'}</td>
      <td>${toneLabel(c.txTone) || '<span class="dim">—</span>'}</td>
      <td>${c.power}</td>
      <td>${c.wide ? 'W' : 'N'}</td>
      <td>${c.scan ? '✓' : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="dim" style="text-align:center;padding:2rem">No programmed channels. Use “Add channel”.</td></tr>`;
}

// ---- editor -----------------------------------------------------------------
function openEditor(slot, fresh) {
  edit = { slot, fresh };
  const chans = decodeChannels(image);
  const c = chans.find((x) => x.number === slot + 1);
  $('edTitle').textContent = `${fresh ? 'New' : 'Edit'} channel ${slot + 1}`;
  $('edName').value = c?.name ?? '';
  $('edRx').value = c ? MHz(c.rxFreq) : '';
  $('edTx').value = c && c.txFreq !== c.rxFreq ? MHz(c.txFreq) : '';
  $('edRxTone').value = c ? toneLabel(c.rxTone) : '';
  $('edTxTone').value = c ? toneLabel(c.txTone) : '';
  $('edPower').value = c?.power ?? 'High';
  $('edWide').value = (c ? c.wide : true) ? '1' : '0';
  $('edScan').checked = c?.scan ?? false;
  $('edDelete').style.visibility = fresh ? 'hidden' : 'visible';
  $('edErr').textContent = '';
  $('editor').hidden = false;
  $('edRx').focus();
}
function closeEditor() { $('editor').hidden = true; }

function saveEditor(e) {
  e.preventDefault();
  const rx = parseFloat($('edRx').value);
  if (isNaN(rx)) return fail('Enter a valid RX frequency in MHz.');
  const txStr = $('edTx').value.trim();
  const tx = txStr === '' ? rx : parseFloat(txStr);
  if (isNaN(tx)) return fail('TX frequency is not a valid number.');
  const rxTone = parseTone($('edRxTone').value);
  const txTone = parseTone($('edTxTone').value);
  if (rxTone === null) return fail('RX tone must be blank, a CTCSS freq (100.0), or DCS (D023).');
  if (txTone === null) return fail('TX tone must be blank, a CTCSS freq (100.0), or DCS (D023).');

  encodeChannel(image, edit.slot, {
    rxFreq: Math.round(rx * 1e6),
    txFreq: Math.round(tx * 1e6),
    name: $('edName').value,
    power: $('edPower').value,
    wide: $('edWide').value === '1',
    scan: $('edScan').checked,
    rxTone, txTone,
  }, { fresh: edit.fresh });

  renderChannels();
  setStatus(`Channel ${edit.slot + 1} saved — ${$('count').textContent}. Write to radio or Save .img to keep it.`, 'ok');
  closeEditor();
}
const fail = (m) => { $('edErr').textContent = m; };

function deleteChannel() {
  clearChannel(image, edit.slot);
  renderChannels();
  setStatus(`Channel ${edit.slot + 1} deleted — ${$('count').textContent}`, 'warn');
  closeEditor();
}
function addChannel() {
  const slot = firstEmptySlot(image);
  if (slot < 0) return setStatus('All 999 channels are used.', 'err');
  openEditor(slot, true);
}

// ---- presets & custom groups ------------------------------------------------
function ensureImage() { if (!image) image = new Uint8Array(MINI5.MEM_TOTAL).fill(0xff); }

// Add a list of channel objects to the first empty slots (existing channels untouched).
function addChannels(list) {
  ensureImage();
  let added = 0;
  for (const ch of list) {
    const slot = firstEmptySlot(image);
    if (slot < 0) break;
    encodeChannel(image, slot, ch, { fresh: true });
    added += 1;
  }
  renderChannels(); syncButtons();
  return { added, full: added < list.length };
}

const loadGroups = () => { try { return JSON.parse(localStorage.getItem('mini5-groups') || '{}'); } catch { return {}; } };
const saveGroups = (g) => localStorage.setItem('mini5-groups', JSON.stringify(g));

function renderPresets() {
  $('prBuiltins').innerHTML = PRESETS.map((p) =>
    `<li><div><b>${esc(p.label)}</b><div class="dim">${esc(p.note)}</div></div><button data-preset="${p.key}">Add</button></li>`).join('');
  const groups = loadGroups(); const names = Object.keys(groups);
  $('prGroups').innerHTML = names.length
    ? names.map((n) => `<li><div><b>${esc(n)}</b><div class="dim">${groups[n].length} channels</div></div>`
        + `<span class="prbtns"><button data-group="${esc(n)}">Add</button><button class="iconbtn" data-delgroup="${esc(n)}" title="Delete">✕</button></span></li>`).join('')
    : '<li class="dim">No saved groups yet — build some channels, then save them here.</li>';
}
function openPresets() { renderPresets(); $('presets').hidden = false; }

function saveGroup() {
  const name = $('prGroupName').value.trim();
  if (!name) return;
  const chans = image ? decodeChannels(image) : [];
  if (!chans.length) { setStatus('No channels to save as a group.', 'warn'); return; }
  const groups = loadGroups();
  groups[name] = chans.map((c) => ({ name: c.name, rxFreq: c.rxFreq, txFreq: c.txFreq, power: c.power, wide: c.wide, scan: c.scan, rxTone: c.rxTone, txTone: c.txTone }));
  saveGroups(groups);
  $('prGroupName').value = ''; renderPresets();
  setStatus(`Saved group "${name}" (${chans.length} channels).`, 'ok');
}

// ---- events -----------------------------------------------------------------
$('btnConnect').onclick = () => connect(false);
$('btnPickAny').onclick = () => connect(true);
$('btnDownload').onclick = download;
$('btnUpload').onclick = upload;
$('btnVerify').onclick = selfTest;
$('btnSave').onclick = saveImg;
$('btnAdd').onclick = addChannel;
$('btnPresets').onclick = openPresets;

// ---- map / repeaters --------------------------------------------------------
const repMap = createRepeaterMap({
  mapEl: $('map'),
  onAdd: (ch) => { const r = addChannels([ch]); setStatus(`Added "${ch.name}" from map${r.full ? ' — radio full' : ''}.`, r.full ? 'warn' : 'ok'); },
  onStatus: setStatus,
});
function switchView(view) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('view-channels').hidden = view !== 'channels';
  $('view-map').hidden = view !== 'map';
  if (view === 'map') repMap.show();
}
document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });
$('repInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const n = repMap.importCsv(await f.text());
  if (n) { $('repCount').textContent = `${n} repeaters`; setStatus(`Loaded ${n} repeaters from ${f.name}. Click a marker → Add as channel.`, 'ok'); }
  e.target.value = '';
};

// ---- shared station lists (community) ---------------------------------------
async function showStations() {
  switchView('map');
  setStatus('Loading shared lists…');
  try {
    const lists = await loadIndex();
    const n = repMap.plotStations(lists, addStationList);
    setStatus(`Loaded ${n} shared list(s) — click a green marker → Add.`, 'ok');
  } catch (e) { setStatus(e.message, 'err'); log(e.message, 'err'); }
}
async function addStationList(l) {
  try {
    const full = await loadList(l.id);
    const r = addChannels(stationToChannels(full));
    setStatus(`Added ${r.added} channel(s) from "${full.title}"${r.full ? ' — radio full' : ''}.`, r.full ? 'warn' : 'ok');
  } catch (e) { setStatus(e.message, 'err'); log(e.message, 'err'); }
}

function shareChannels() {
  const chans = image ? decodeChannels(image) : [];
  if (!chans.length) { setStatus('No channels to share — add or download some first.', 'warn'); return; }
  const title = prompt('List title (e.g. "Denver Metro GMRS"):'); if (!title) return;
  const place = prompt('Place / region (e.g. "Denver, CO"):', '') || '';
  const author = prompt('Your name / callsign (optional):', '') || '';
  const c = repMap.center();
  const coord = prompt('Location as "lat, lon" (defaults to the current map center):',
    c ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : '');
  let lat = c ? c.lat : NaN, lon = c ? c.lng : NaN;
  if (coord) { const m = coord.split(','); lat = parseFloat(m[0]); lon = parseFloat(m[1]); }
  if (!isFinite(lat) || !isFinite(lon)) { setStatus('Need a valid "lat, lon" — open the Map, center it, or type coordinates.', 'err'); return; }

  const json = JSON.stringify(buildListJson({ title, place, author, lat, lon }, chans), null, 2) + '\n';
  const slug = slugify(title);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `${slug}.json`; a.click(); URL.revokeObjectURL(a.href);

  const url = `https://github.com/ReplicationBench/Mini5/new/main?filename=${encodeURIComponent('data/stations/' + slug + '.json')}&value=${encodeURIComponent(json)}`;
  log(`Saved ${slug}.json — open a PR adding it under data/stations/ (the map index rebuilds automatically).`, 'ok');
  if (url.length < 7000) window.open(url, '_blank', 'noopener');
  else log('List too big to prefill a PR link; add the downloaded file to data/stations/ in a PR.', 'warn');
  setStatus(`Built "${title}" (${chans.length} channels) — file downloaded${url.length < 7000 ? ', opening a PR draft' : ''}.`, 'ok');
}

$('btnStations').onclick = showStations;
$('btnShare').onclick = shareChannels;
$('fileInput').onchange = (e) => { if (e.target.files[0]) loadImg(e.target.files[0]); };

$('prSaveGroup').onclick = saveGroup;
$('presets').addEventListener('click', (e) => {
  const t = e.target;
  if (t.id === 'presets' || t.id === 'prClose') { $('presets').hidden = true; return; }
  if (t.dataset.preset) {
    const p = PRESETS.find((x) => x.key === t.dataset.preset);
    const r = addChannels(presetToChannels(p));
    setStatus(`Added ${r.added} ${p.label} channel(s)${r.full ? ' — radio full' : ''}.`, r.full ? 'warn' : 'ok');
  } else if (t.dataset.group) {
    const r = addChannels(loadGroups()[t.dataset.group] || []);
    setStatus(`Added ${r.added} channel(s) from "${t.dataset.group}"${r.full ? ' — radio full' : ''}.`, r.full ? 'warn' : 'ok');
  } else if (t.dataset.delgroup) {
    const g = loadGroups(); delete g[t.dataset.delgroup]; saveGroups(g); renderPresets();
  }
});

$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slot]');
  if (tr) openEditor(Number(tr.dataset.slot), false);
});
$('edForm').addEventListener('submit', saveEditor);
$('edClose').onclick = closeEditor;
$('edCancel').onclick = closeEditor;
$('edDelete').onclick = deleteChannel;
$('editor').addEventListener('click', (e) => { if (e.target.id === 'editor') closeEditor(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('editor').hidden) closeEditor(); });
$('edForm').querySelectorAll('.offsets button').forEach((b) => {
  b.onclick = () => {
    const rx = parseFloat($('edRx').value);
    if (isNaN(rx)) return fail('Enter RX first.');
    const off = parseFloat(b.dataset.off);
    $('edTx').value = off === 0 ? '' : (rx + off).toFixed(5);
  };
});

syncButtons();
log('Ready. Connect your radio (Bluetooth on, not paired to the phone app), or load a saved .img.');
