# Mini 5 Studio

> ⚠️ **VibeCoded — use at your own risk.** This is experimental software that talks to
> and writes to your radio. It may contain bugs that could misconfigure or brick your
> device. Provided with **no warranty** of any kind. Always keep a backup `.img` before
> writing, and only proceed if you accept full responsibility for the outcome.

> 🔒 **Private by design.** No analytics, no tracking, no database. The **programmer**
> (connect / read / edit / write / `.img`) runs entirely in your browser and uploads nothing.
> The optional **Map** tab is the one exception: when you open it, it loads map tiles from
> OpenStreetMap and plots repeater export files *you* choose to import — that data stays
> client-side and isn't sent anywhere by this app.

Program your **Baofeng UV-5R Mini** (a.k.a. Mini 5 / GT-5R Mini) straight from a web
browser over Bluetooth — **no programming cable, no ESP32 bridge, no CHIRP install.**

A static single-page app that talks directly to the radio's BLE serial service using
the [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API).

**Hosted:** https://replicationbench.github.io/Mini5/ — auto-deployed from `main` via
GitHub Pages (Settings → Pages → Source: *GitHub Actions*).

> **Status: early foundation.** Download (clone-read), channel decoding, and `.img`
> save/load work. Editing, write-back, boot-logo upload, the repeater map, and shared
> station lists are on the roadmap below.

## Requirements

- **Chrome** or **Edge** (desktop or Android). Web Bluetooth is **not** available in
  Safari or Firefox, or on iOS.
- Page served over `https` or `localhost` (Web Bluetooth requires a secure context).
- A Baofeng UV-5R Mini with Bluetooth enabled and **not** paired to the phone app.

## Run locally

```bash
python3 -m http.server 8723
# open http://localhost:8723/ in Chrome
```

1. **Connect radio** → pick it in the chooser.
2. **Download from radio** → reads the full memory image and lists your channels.
3. **Save .img** to back it up, or **Load .img** to inspect a saved image offline.

`dev/poc.html` is the original hardware proof-of-concept (connect → identify → read).

## How it works

The radio exposes an HM-10 transparent-serial GATT service (`0xFFE0`/`0xFFE1`). The app:

1. Enters clone mode: magic `PROGRAMCOLORPROU` → `0x06`, then `F`, `M`, and a 25-byte
   `SEND!…` init (each handshake step mirrors CHIRP's `UV5RMini` driver).
2. Reads the memory map in `0x40`-byte blocks (`R addr len` → 4-byte header + data).
3. Decodes 999 × 32-byte channel records (frequency, tones, power, bandwidth, name).
4. Writes back in `0x80`-byte blocks over BLE (`W` frames → `0x06` ACK).

The channel codec is ported from CHIRP's `baofeng_uv17Pro.py`.

## Roadmap

- [x] Hardware proof-of-concept (BLE connect → identify → read)
- [x] Full clone-read download + `.img` save/load
- [x] Channel decode + table view
- [x] Channel editor (add/edit/delete) + write-back to radio (self-test certified)
- [x] **Band presets** (GMRS w/ repeaters, FRS, MURS, PMR446, NOAA, 2m/70cm) and **custom groups**
- [x] **Repeater map** — Leaflet + RepeaterBook CSV import, click a marker to add as a channel
- [ ] Settings decode (squelch, VOX, timeout, …) from the known `0x9000` map
- [ ] **Shareable station lists by location** (GitHub-hosted, contributed via PR) ← differentiator
- [ ] Boot-logo designer + upload — A5 protocol. **Note:** no public tool has yet
      confirmed boot-logo flashing *over BLE* for this radio (existing implementations
      require USB serial, and screen dimensions are unverified). Needs on-device work.

The radio-side basics (channels/settings) are well-mapped by prior art; this project's
focus is the **map + community station-sharing** layer that doesn't exist elsewhere.

## License & credit

GPLv3. Built on the work of others — with thanks:

- **[CHIRP](https://github.com/kk7ds/chirp)** (GPLv3) — the `UV5RMini` driver this
  project's channel codec and clone protocol are ported from.
- **[zayator/chirp](https://github.com/zayator/chirp)** — captured-Bluetooth protocol
  analysis that decoded the `PROGRAMCOLORPROU` → `F`/`M`/`SEND!` handshake.
- **[dz0ny/5r-mini-ble-tool](https://github.com/dz0ny/5r-mini-ble-tool)** — prior-art
  web BLE tool for this radio. Interoperability facts (memory/settings addresses,
  transport fallbacks) were cross-referenced; **no source code was copied.**
- **[iseeliu/baofeng-ble-relay](https://github.com/iseeliu/baofeng-ble-relay)** and
  **[pcunning/uv5r-ble-relay](https://github.com/pcunning/uv5r-ble-relay)** — BLE relay
  protocol framing.
- **[XoniBlue/Baofeng-Logo-Flasher](https://github.com/XoniBlue/Baofeng-Logo-Flasher)** —
  A5 boot-logo protocol reference.

Not affiliated with or endorsed by Baofeng.
