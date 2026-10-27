# Shasana

Searchable database of Pandya and Chola inscriptions.

## Structure
- `index.html` — single-page app entry
- `css/styles.css` — Estampage (dark) / Palm-leaf (light) themes
- `js/app.js` — routing, search, map, timeline
- `data/` — JSON datasets

## Routes (hash-based, shareable)
- `#/` — Home
- `#/map` — Interactive map
- `#/temples` — Temple index
- `#/temple/Name|Place` — Temple page
- `#/kings` — Dynasty list
- `#/king/king_id` — King page
- `#/inscription/arie_id` — Inscription page
- `#/search?q=...` — Search

## Hosting
Upload the entire `shasana` folder contents to a GitHub Pages repo (root or `/docs`). The site is fully static.

## Theme
Toggle is remembered in localStorage. Dynasty colors: Pandya = verdigris, Chola = kumkum.
