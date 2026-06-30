// app.js — UI wiring: connect, download, save/load .img, decode table, channel editor.
import { Mini5Radio } from './radio.js';
import {
  MINI5, decodeChannels, encodeChannel, clearChannel, firstEmptySlot,
  parseTone, toneLabel, MHz,
} from './codec.js';

const $ = (id) => document.getElementById(id);
const radio = new Mini5Radio();
let image = null;           // in-memory image (Uint8Array)
let edit = { slot: -1, fresh: false };

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
  try { image = await radio.download(progress); renderChannels(); setStatus(`Downloaded — ${$('count').textContent}`, 'ok'); }
  catch (e) { log(e.message, 'err'); setStatus('Download failed (see log)', 'err'); }
  syncButtons();
}
async function upload() {
  if (!image) return;
  if (!confirm('Write this image to the radio? This overwrites its memory.')) return;
  setStatus('Uploading to radio…'); progress(0);
  try { await radio.upload(image, progress); setStatus('Upload complete', 'ok'); }
  catch (e) { log(e.message, 'err'); setStatus('Upload failed (see log)', 'err'); }
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
  if (rxTone === null) return fail('RX tone must be blank, a CTCSS freq (100.0), or DTCS (D023N).');
  if (txTone === null) return fail('TX tone must be blank, a CTCSS freq (100.0), or DTCS (D023N).');

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

// ---- events -----------------------------------------------------------------
$('btnConnect').onclick = () => connect(false);
$('btnPickAny').onclick = () => connect(true);
$('btnDownload').onclick = download;
$('btnUpload').onclick = upload;
$('btnSave').onclick = saveImg;
$('btnAdd').onclick = addChannel;
$('fileInput').onchange = (e) => { if (e.target.files[0]) loadImg(e.target.files[0]); };

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
