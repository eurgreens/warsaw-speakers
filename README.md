# Warsaw Congress · Speaker card generator

A small Nuxt app that creates the Warsaw Congress speaker image for social media, in two
formats: portrait 4:5 (1080×1350) and square 1:1 (1080×1080).

Users add a photo, a speaker name and a description; the rest of the design (stripes, folk
pattern, logos) comes from the original template. The result can be downloaded as a PNG or
shared with the browser's native share sheet (where the browser supports sharing files).

Everything runs in the browser. The photo is read from a local `Blob` (object URL) and drawn
on a `<canvas>`; nothing is uploaded and there is no server code (`ssr: false`).

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in .output/public
npm run preview    # serve the static build
```

Deploy the contents of `.output/public` to any static host.

## How it works

- `app/assets/template.svg`: the 4:5 Illustrator template with the sample text removed
  (`<g id="text">`), an explicit `width`/`height`, and ids on the two logos
  (`logo-eg`, `logo-warsaw`). It is the only design source for both formats.
- `app/utils/speakerCard.ts`: rendering. `LAYOUTS` describes each format: the photo area,
  which parts of the template go where (`layers`: the right-hand panel with stripes,
  pattern and European Greens logo, and the Warsaw Congress logo), and the text metrics.
  The square format reuses the 4:5 panel scaled by 0.8 and a slightly larger logo and
  type, measured from the 1:1 reference design (name 74px / 72px line height,
  description 31.5px).
  Each layout draws the photo (cover-fit in the area left of the magenta stripe, with
  zoom and pan), then the template layers, then the text. Text is anchored at the
  description baseline, so longer names and descriptions grow upwards.
  Long names wrap automatically (also after hyphens); a single word that is too wide
  shrinks the name.
- `app/app.vue`: the UI.

To change the design, replace `app/assets/template.svg` (keep the element ids) and adjust
the numbers in `LAYOUTS` in `speakerCard.ts` if positions change. A new format is a new
entry in `LAYOUTS` plus an option in `layoutOptions` in `app.vue`.

## Fonts

- **Hagrid** comes from the Adobe Fonts kit `bsv0ktr`
  (`https://use.typekit.net/bsv0ktr.css`, linked in `nuxt.config.ts`). It is used for the
  generated image (family `hagrid`: Extrabold 800 for the name, Medium 500 for the
  description, as in the template) and for headings and buttons in the UI.
  The kit must allow the domain the generator is published on (Adobe Fonts → Web
  Projects → the project's domain settings).
- **Inter** (base UI text, weight 500) and **Space Mono** (form labels) are self-hosted
  through the `@fontsource` packages, so no request goes to Google.

The image waits for Hagrid before drawing and redraws when fonts finish loading. If
Adobe Fonts cannot be reached, the image falls back to the system sans-serif, so
check the preview before downloading.
