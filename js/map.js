// map.js — repeater map view (Leaflet, vendored). Imports a RepeaterBook CSV, plots
// repeaters, and lets the user add any of them as a channel via the popup.
import { parseRepeaterCsv, repeaterToChannel } from './repeaters.js';
import { MHz } from './codec.js';

const esc = (s) => String(s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

export function createRepeaterMap({ mapEl, onAdd, onStatus }) {
  let map, layer, stationLayer, current = [];

  function ensure() {
    if (map) { map.invalidateSize(); return; }
    map = L.map(mapEl, { worldCopyJump: true }).setView([39.5, -98.35], 4);  // CONUS
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    stationLayer = L.layerGroup().addTo(map);
  }

  function center() { return map ? map.getCenter() : null; }

  // Plot community station lists (green) from the lightweight index. onAddList(list) fires
  // when the popup's Add button is clicked.
  function plotStations(lists, onAddList) {
    ensure();
    stationLayer.clearLayers();
    const pts = [];
    for (const l of lists) {
      if (l.lat == null || l.lon == null) continue;
      const m = L.circleMarker([l.lat, l.lon], { radius: 9, weight: 2, color: '#15803d', fillColor: '#22c55e', fillOpacity: 0.85 });
      m.bindPopup(
        `<b>${esc(l.title)}</b>${l.place ? '<br>' + esc(l.place) : ''}${l.author ? ' · ' + esc(l.author) : ''}`
        + `<br>${l.count || 0} channels`
        + `<br><button class="popadd" type="button">➕ Add ${l.count || 0} channels</button>`);
      m.on('popupopen', (e) => { const b = e.popup.getElement().querySelector('.popadd'); if (b) b.onclick = () => onAddList(l); });
      m.addTo(stationLayer); pts.push([l.lat, l.lon]);
    }
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 9 });
    return lists.length;
  }

  function importCsv(text) {
    const { repeaters, error } = parseRepeaterCsv(text);
    if (error) { onStatus(error, 'err'); return 0; }
    current = repeaters;
    ensure();
    layer.clearLayers();
    const pts = [];
    for (const r of repeaters) {
      const off = (r.txHz && r.txHz !== r.freqHz)
        ? `${r.txHz > r.freqHz ? '+' : ''}${((r.txHz - r.freqHz) / 1e6).toFixed(4)} MHz` : 'simplex';
      const tone = r.txTone.mode === 'Tone' ? `PL ${r.txTone.value}`
        : r.txTone.mode === 'DTCS' ? `DCS ${r.txTone.value}` : '';
      const label = r.call || r.location || 'Repeater';
      const m = L.circleMarker([r.lat, r.lon], { radius: 6, weight: 1, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.85 });
      m.bindPopup(
        `<b>${esc(label)}</b>${r.location ? '<br>' + esc(r.location) : ''}`
        + `<br>${MHz(r.freqHz)} MHz · ${off}${tone ? ' · ' + tone : ''}`
        + `<br><button class="popadd" type="button">➕ Add as channel</button>`);
      m.on('popupopen', (e) => {
        const btn = e.popup.getElement().querySelector('.popadd');
        if (btn) btn.onclick = () => onAdd(repeaterToChannel(r));
      });
      m.addTo(layer); pts.push([r.lat, r.lon]);
    }
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 });
    return repeaters.length;
  }

  return { show: ensure, importCsv, plotStations, center };
}
