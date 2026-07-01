# Shared station lists

Community-contributed channel lists, plotted on the app's **Map** tab by location. Anyone
can add one with a pull request — you only add **one file**; `index.json` is rebuilt
automatically on deploy (and by `node scripts/build-stations-index.mjs`).

## Add a list

Create `data/stations/<your-slug>.json`:

```json
{
  "title": "Denver Metro GMRS",
  "place": "Denver, CO",
  "author": "your-callsign",
  "description": "Short note. Remind users to verify tones and licensing.",
  "lat": 39.7392,
  "lon": -104.9903,
  "channels": [
    { "name": "Lookout Mt", "rx": 462.6500, "tx": 467.6500, "tone": "141.3", "power": "High", "bw": "W" },
    { "name": "GMRS 15",    "rx": 462.5500, "power": "High", "bw": "W" }
  ]
}
```

**Channel fields:** `name` (≤12 chars), `rx` (MHz). Optional: `tx` (MHz) *or* `off`
(MHz offset) for repeaters; `tone` (TX/access CTCSS like `"141.3"` or DCS like `"D023"`);
`rxtone`; `power` (`"High"`/`"Low"`); `bw` (`"W"`/`"N"`).

**List fields:** `title`, `place`, `author`, `description`, `lat`, `lon`, `channels`.

The easiest way: in the app, build the channels you want, open the **Map** tab, center it on
the area, and click **➕ Share my channels** — it generates this file and opens a pre-filled PR.

> Lists are informational. Contributors are responsible for accuracy; users are responsible
> for verifying frequencies/tones and operating within their license and local regulations.
