# ARIE Epigraphy Index

Static website for Pandya & Chola inscriptions from the ARIE corpus.

## How to host on GitHub Pages

1. Create a new repository on GitHub (e.g. `arie-index`).
2. Upload the contents of this folder (`index.html`, `css/`, `js/`, `data/`, `images/`).
3. Go to Settings → Pages → set source to the `main` branch / root.
4. Your site will be live at `https://YOUR-USERNAME.github.io/arie-index/`.

## Adding temple images

Put images in `images/temples/` named as a slug of the temple name, e.g.:
- `images/temples/bilvanathesvara-temple-at-tiruvallam.jpg`

The site will automatically try to load them. If missing, the image area is hidden.

## Adding temple descriptions later

You can create a `data/temples.json` file later and load it in `js/app.js` under `TEMPLE_OVERRIDES`.
