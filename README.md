# ncgg.dev

Personal portfolio. Plain HTML, CSS and JavaScript with no dependencies: an ASCII fluid simulation (WebGL), generative ASCII media for each project, and an isometric FTC match scene.

## Run locally

```sh
python -m http.server 5173
```

Then open http://localhost:5173.

## Deploy (Cloudflare Pages)

Connect this repo in Cloudflare Pages and use:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `mkdir -p dist && cp -r index.html favicon.svg css js assets dist/` |
| Build output directory | `dist` |

The build step copies only the site into `dist/`, so the design notes in the repo root (`PRODUCT.md`, `DESIGN.md`, `.impeccable/`) are never served. Add `ncgg.dev` under **Custom domains** once the first deploy succeeds.

## Layout

- `index.html` — the page
- `css/style.css` — styles and the light/dark themes
- `js/fluid.js` — the ASCII fluid background
- `js/media.js` — ASCII animations for the work section
- `js/ftc.js` — the isometric FTC match
- `js/main.js` — wiring, themes, drawers, contact details
- `assets/` — photos and renders
