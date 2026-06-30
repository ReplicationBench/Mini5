// app.js — UI wiring for the foundation: connect, download, save/load .img, decode table.
import { Mini5Radio } from './radio.js';
import { MINI5, decodeChannels, toneLabel, MHz } from './codec.js';

const $ = (id) => document.getElementById(id);
const radio = new Mini5Radio();
let image = null;           // last downloaded/loaded image (Uint8Array)

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
}
function progress(p) { $('bar').style.width = `${Math.round(p * 100)}%`; }

async function connect(pickAny) {
  setStatus('Requesting device…');
  try {
    await radio.connect({ pickAny });
    setStatus(`Connected: ${radio.device.name || 'radio'}`, 'ok');
  } catch (e) { log(e.message, 'err'); setStatus('Connect failed', 'err'); }
  syncButtons();
}

async function download() {
  setStatus('Downloading from radio…'); progress(0);
  $('btnDownload').disabled = true;
  try {
    image = await radio.download(progress);
    renderChannels();
    setStatus(`Downloaded ${image.length} bytes — ${$('count').textContent}`, 'ok');
  } catch (e) {
    log(e.message, 'err'); setStatus('Download failed (see log)', 'err');
  }
  syncButtons();
}

async function upload() {
  if (!image) return;
  if (!confirm('Write this image to the radio? This overwrites its memory.')) return;
  setStatus('Uploading to radio…'); progress(0);
  try {
    await radio.upload(image, progress);
    setStatus('Upload complete', 'ok');
  } catch (e) { log(e.message, 'err'); setStatus('Upload failed (see log)', 'err'); }
  syncButtons();
}

function saveImg() {
  if (!image) return;
  // CHIRP-style trailer: model name follows the raw memory (see match_model()).
  const trailer = new TextEncoder().encode(MINI5.MODEL);
  const blob = new Blob([image, trailer], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mini5-${new Date().toISOString().slice(0, 10)}.img`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadImg(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  image = buf.subarray(0, MINI5.MEM_TOTAL);
  renderChannels();
  setStatus(`Loaded ${file.name} — ${$('count').textContent}`, 'ok');
  syncButtons();
}

function renderChannels() {
  const chans = decodeChannels(image);
  $('count').textContent = `${chans.length} channels`;
  const rows = chans.map(c => {
    const rx = MHz(c.rxFreq);
    const off = c.txFreq && c.txFreq !== c.rxFreq
      ? `${(c.txFreq - c.rxFreq) / 1e6 > 0 ? '+' : ''}${((c.txFreq - c.rxFreq) / 1e6).toFixed(4)}` : '';
    return `<tr>
      <td class="num">${c.number}</td>
      <td class="name">${esc(c.name) || '<span class="dim">—</span>'}</td>
      <td class="freq">${rx}</td>
      <td class="freq dim">${off || ''}</td>
      <td>${toneLabel(c.rxTone) || '<span class="dim">—</span>'}</td>
      <td>${toneLabel(c.txTone) || '<span class="dim">—</span>'}</td>
      <td>${c.power}</td>
      <td>${c.wide ? 'W' : 'N'}</td>
      <td>${c.scan ? '✓' : ''}</td>
    </tr>`;
  }).join('');
  $('rows').innerHTML = rows || `<tr><td colspan="9" class="dim" style="text-align:center;padding:2rem">No programmed channels.</td></tr>`;
}
const esc = (s) => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

$('btnConnect').onclick = () => connect(false);
$('btnPickAny').onclick = () => connect(true);
$('btnDownload').onclick = download;
$('btnUpload').onclick = upload;
$('btnSave').onclick = saveImg;
$('fileInput').onchange = (e) => { if (e.target.files[0]) loadImg(e.target.files[0]); };

syncButtons();
log('Ready. Connect your radio (Bluetooth on, not paired to the phone app), or load a saved .img.');
