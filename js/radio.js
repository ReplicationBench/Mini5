// radio.js — Web Bluetooth clone engine for the Baofeng UV-5R Mini.
// Talks directly to the radio's HM-10 serial service (0xFFE0/0xFFE1) — no cable,
// no ESP32, no CHIRP. Handshake + framing verified against real hardware.

import { MINI5 } from './codec.js';

const SERVICE = 0xffe0;
const CHAR    = 0xffe1;
const ACK     = 0x06;

const MAGIC = new TextEncoder().encode('PROGRAMCOLORPROU');   // MSTRING_UV17PROGPS
// SEND! init command (25 bytes) — required before reads/writes (CHIRP _magics).
const SEND_INIT = hexToBytes('53454e4421050d010101041108050d0d01110f091209100400');

function hexToBytes(s) { const o = []; for (let i = 0; i < s.length; i += 2) o.push(parseInt(s.substr(i, 2), 16)); return new Uint8Array(o); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class Mini5Radio {
  constructor() {
    this.device = null;
    this.char = null;
    this.rx = [];               // received byte queue
    this._waiter = null;
    this.onLog = () => {};
    this.onDisconnect = () => {};
  }

  log(m, kind) { this.onLog(m, kind); }

  get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }

  async connect({ pickAny = false } = {}) {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth unavailable — use Chrome or Edge over https/localhost.');
    const opts = pickAny
      ? { acceptAllDevices: true, optionalServices: [SERVICE] }
      : { filters: [{ services: [SERVICE] }], optionalServices: [SERVICE] };
    this.device = await navigator.bluetooth.requestDevice(opts);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.char = null;
      this.onDisconnect();
    });
    await this._attach();
    this.log(`connected to "${this.device.name || 'radio'}"`, 'ok');
    return this.device.name;
  }

  // (Re)acquire GATT service, characteristic, and notifications on this.device.
  async _attach() {
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    this.char = await service.getCharacteristic(CHAR);
    await this.char.startNotifications();
    this.char.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e));
  }

  // Reconnect to the same device after it reboots/drops (radios reboot after a write).
  async reconnect(tries = 15, delayMs = 1500) {
    for (let t = 1; t <= tries; t++) {
      try { await this._attach(); this.log('reconnected after reboot', 'ok'); return; }
      catch { this.log(`waiting for radio to come back (${t}/${tries})…`, 'warn'); await sleep(delayMs); }
    }
    throw new Error('radio did not come back after write — power-cycle it and reconnect');
  }

  async disconnect() {
    try { if (this.connected) this.device.gatt.disconnect(); } catch {}
  }

  _onNotify(e) {
    const b = new Uint8Array(e.target.value.buffer);
    for (const x of b) this.rx.push(x);
    this._serve();
  }
  _serve() {
    if (this._waiter && this.rx.length >= this._waiter.n) {
      const out = this.rx.splice(0, this._waiter.n);
      const w = this._waiter; this._waiter = null;
      w.resolve(new Uint8Array(out));
    }
  }
  _waitBytes(n, ms = 4000) {
    return new Promise((resolve, reject) => {
      this._waiter = { n, resolve };
      this._serve();
      setTimeout(() => {
        if (this._waiter && this._waiter.resolve === resolve) {
          this._waiter = null;
          reject(new Error(`timeout: wanted ${n}B, have ${this.rx.length}`));
        }
      }, ms);
    });
  }

  async _send(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try { await this.char.writeValueWithoutResponse(arr); }
    catch { await this.char.writeValue(arr); }
  }

  // Enter clone mode, retrying the whole handshake on a transient failure.
  async enterClone(tries = 3) {
    for (let t = 1; ; t++) {
      try { return await this._enterCloneOnce(); }
      catch (e) {
        if (t >= tries) throw e;
        this.log(`retry handshake (${t}/${tries - 1}): ${e.message}`, 'warn');
        await sleep(150);
      }
    }
  }

  // One clone-mode handshake attempt: magic -> F -> M -> SEND!. Returns the radio ID.
  async _enterCloneOnce() {
    this.rx = [];
    await this._send(MAGIC);
    const a1 = await this._waitBytes(1);
    if (a1[0] !== ACK) throw new Error(`magic: expected ACK, got 0x${a1[0].toString(16)}`);

    await this._send(Uint8Array.of(0x46));          // 'F'
    await this._collect(800);                        // 16-byte config block

    await this._send(Uint8Array.of(0x4d));          // 'M'
    const id = await this._collect(800);             // radio ID ("5RMINI  +L00000")

    await this._send(SEND_INIT);
    const a2 = await this._waitBytes(1);
    if (a2[0] !== ACK) throw new Error(`SEND!: expected ACK, got 0x${a2[0].toString(16)}`);

    const idStr = String.fromCharCode(...id).replace(/[^\x20-\x7e]/g, '').trim();
    this.log(`clone mode ready — radio: "${idStr}"`, 'ok');
    return idStr;
  }

  // Collect whatever arrives until quiet for quietMs (or maxMs elapses).
  _collect(maxMs = 1500, quietMs = 300) {
    return new Promise((resolve) => {
      const start = Date.now(); let last = this.rx.length, lastT = Date.now();
      const iv = setInterval(() => {
        const now = Date.now();
        if (this.rx.length !== last) { last = this.rx.length; lastT = now; }
        if ((this.rx.length > 0 && now - lastT >= quietMs) || now - start >= maxMs) {
          clearInterval(iv);
          resolve(new Uint8Array(this.rx.splice(0, this.rx.length)));
        }
      }, 30);
    });
  }

  // Read one block: 'R'(0x52) addr(2 BE) len(1) -> 4-byte header + len data bytes.
  // Retries on transient BLE drops (no/short response).
  async _readBlock(addr, len, tries = 3) {
    for (let t = 1; ; t++) {
      this.rx = [];
      await this._send(Uint8Array.of(0x52, (addr >> 8) & 0xff, addr & 0xff, len & 0xff));
      try {
        const resp = await this._waitBytes(len + 4, 3000);
        return resp.subarray(4);        // strip header, return payload
      } catch (e) {
        if (t >= tries) throw new Error(`read @0x${addr.toString(16).padStart(4, '0')} failed after ${tries} tries: ${e.message}`);
        this.log(`retry read @0x${addr.toString(16).padStart(4, '0')} (${t}/${tries - 1})`, 'warn');
        await sleep(60);
      }
    }
  }

  // Full download of the radio image (concatenated regions). onProgress(0..1).
  async download(onProgress = () => {}) {
    await this.enterClone();
    const image = new Uint8Array(MINI5.MEM_TOTAL);
    let off = 0;
    const blk = MINI5.READ_BLOCK;
    for (let r = 0; r < MINI5.MEM_STARTS.length; r++) {
      const start = MINI5.MEM_STARTS[r], size = MINI5.MEM_SIZES[r];
      for (let addr = start; addr < start + size; addr += blk) {
        const payload = await this._readBlock(addr, blk);
        image.set(payload.subarray(0, blk), off);
        off += blk;
        onProgress(off / MINI5.MEM_TOTAL);
      }
    }
    this.log(`downloaded ${off} bytes`, 'ok');
    return image;
  }

  // Write one block over BLE: 'W'(0x57) addr(2 BE) size(1) data... -> ACK.
  // `data` is always a full BLE_WRITE_BLOCK (0x80) — partial blocks are pre-padded.
  async _writeBlock(addr, data, tries = 3) {
    const frame = new Uint8Array([0x57, (addr >> 8) & 0xff, addr & 0xff, data.length & 0xff, ...data]);
    for (let t = 1; ; t++) {
      this.rx = [];
      await this._send(frame);
      try {
        const a = await this._waitBytes(1, 3000);
        if (a[0] === ACK) return;
        throw new Error(`NAK 0x${a[0].toString(16)}`);
      } catch (e) {
        if (t >= tries) throw new Error(`write @0x${addr.toString(16).padStart(4, '0')} failed after ${tries} tries: ${e.message}`);
        this.log(`retry write @0x${addr.toString(16).padStart(4, '0')} (${t}/${tries - 1})`, 'warn');
        await sleep(60);
      }
    }
  }

  // Full upload of an image. Mirrors CHIRP UV5RMini._upload: always send full 0x80
  // blocks, padding each region's final partial block with 0xFF; advance the image
  // read pointer only by the real byte count.
  async upload(image, onProgress = () => {}) {
    await this.enterClone();
    const blk = MINI5.BLE_WRITE_BLOCK;          // 0x80
    let src = 0; const total = MINI5.MEM_TOTAL;
    for (let r = 0; r < MINI5.MEM_STARTS.length; r++) {
      const start = MINI5.MEM_STARTS[r], size = MINI5.MEM_SIZES[r];
      for (let addr = start; addr < start + size; addr += blk) {
        const n = Math.min(blk, start + size - addr);
        const block = new Uint8Array(blk).fill(0xFF);     // pad partial block
        block.set(image.subarray(src, src + n), 0);
        await this._writeBlock(addr, block);              // always a full 0x80 block
        src += n;
        onProgress(src / total);
        await sleep(2);
      }
    }
    this.log(`uploaded ${src} bytes`, 'ok');
  }

  // Non-destructive write self-test: download a baseline, write it back UNCHANGED,
  // re-download, and byte-compare. Identical => the write path round-trips losslessly.
  // Returns { before, after, diffs, identical }.
  async roundTripTest(onProgress = () => {}) {
    this.log('Self-test 1/3: reading baseline…');
    const before = await this.download((p) => onProgress(p * 0.45));
    await sleep(1000);                       // let the radio settle before re-handshaking
    this.log('Self-test 2/3: writing baseline back unchanged…');
    await this.upload(before, (p) => onProgress(0.45 + p * 0.45));
    this.log('write done — radio reboots to commit; reconnecting…');
    await sleep(3000);                        // radio reboots/drops BLE after a write
    await this.reconnect();
    await sleep(500);
    this.log('Self-test 3/3: re-reading to compare…');
    const after = await this.download((p) => onProgress(0.9 + p * 0.1));
    const diffs = [];
    for (let i = 0; i < before.length && diffs.length <= 256; i++) {
      if (before[i] !== after[i]) diffs.push(i);
    }
    this.log(`self-test done: ${diffs.length === 0 ? 'identical' : diffs.length + ' byte(s) differ'}`,
             diffs.length === 0 ? 'ok' : 'warn');
    return { before, after, diffs, identical: diffs.length === 0 };
  }
}
