import templateSvg from '~/assets/template.svg?raw'

interface Rect { x: number, y: number, w: number, h: number }

/**
 * A part of the vector template (app/assets/template.svg, drawn in 1080×1350
 * coordinates) copied to a position on the output image.
 */
interface Layer {
  /** Element ids in the template to hide for this layer. */
  hide: string[]
  /** Region of the template to copy. */
  src: Rect
  /** Where it goes on the output (same aspect ratio as `src`). */
  dest: Rect
}

export interface Layout {
  id: LayoutId
  label: string
  width: number
  height: number
  /** Area to the left of the magenta stripe that holds the speaker photo. */
  photo: Rect
  layers: Layer[]
  text: { x: number, maxWidth: number }
  name: { size: number, lineHeight: number, minSize: number }
  description: {
    size: number
    lineHeight: number
    /** Baseline of the (last) description line. */
    baseline: number
  }
  /** Distance between the last name baseline and the first description baseline. */
  nameToDescription: number
}

export type LayoutId = 'portrait' | 'square'

// Hagrid from the Adobe Fonts kit, as in the template:
// Hagrid Extrabold for the name, Hagrid Medium for the description.
const FONTS = {
  name: { family: '"hagrid", sans-serif', weight: 800 },
  description: { family: '"hagrid", sans-serif', weight: 500 },
} as const

/** Fills the photo area until a picture is added (dark so the white text stays readable). */
const PLACEHOLDER = '#2f3d36'

/** Keep at least this much space between the text and the magenta stripe. */
const TEXT_RIGHT_MARGIN = 36

/** Right-hand panel of the template: stripes, folk pattern and European Greens logo. */
const PANEL: Rect = { x: 707.34, y: 0, w: 372.66, h: 1350 }
/** Bounding box of the Warsaw Congress logo in the template. */
const WARSAW_LOGO: Rect = { x: 60.56, y: 1252.16, w: 223.15, h: 65.86 }

export const LAYOUTS: Record<LayoutId, Layout> = {
  // 4:5, exactly as in 2026_CongressTemplates_Socials.svg.
  portrait: {
    id: 'portrait',
    label: '4:5',
    width: 1080,
    height: 1350,
    photo: { x: 0, y: 0, w: PANEL.x, h: 1350 },
    layers: [
      { hide: ['logo-warsaw'], src: PANEL, dest: PANEL },
      { hide: ['back', 'logo-eg'], src: WARSAW_LOGO, dest: WARSAW_LOGO },
    ],
    text: { x: 66.89, maxWidth: PANEL.x - 66.89 - TEXT_RIGHT_MARGIN },
    name: { size: 94.03, lineHeight: 98.66, minSize: 40 },
    description: { size: 40, lineHeight: 48, baseline: 1100.09 },
    nameToDescription: 1100.09 - (939.66 + 98.66),
  },
  // 1:1, measured from the square reference design: the panel is the 4:5 panel
  // scaled by 0.8 (1080/1350), the type and logo are slightly larger relative to it.
  square: {
    id: 'square',
    label: '1:1',
    width: 1080,
    height: 1080,
    photo: { x: 0, y: 0, w: 780, h: 1080 },
    layers: [
      {
        hide: ['logo-warsaw'],
        // A sliver wider than the 4:5 panel so it reaches the right edge at this scale.
        src: { x: PANEL.x, y: 0, w: 375, h: 1350 },
        dest: { x: 780, y: 0, w: 300, h: 1080 },
      },
      {
        hide: ['back', 'logo-eg'],
        src: WARSAW_LOGO,
        dest: { x: 60.8, y: 990.8, w: WARSAW_LOGO.w * 0.875, h: WARSAW_LOGO.h * 0.875 },
      },
    ],
    text: { x: 60.79, maxWidth: 780 - 60.79 - TEXT_RIGHT_MARGIN },
    name: { size: 74, lineHeight: 72, minSize: 32 },
    description: { size: 31.5, lineHeight: 37.5, baseline: 785.57 },
    nameToDescription: 785.57 - 724.05,
  },
}

export interface PhotoTransform {
  /** 1 = cover the photo area exactly; larger values zoom in. */
  zoom: number
  /** Pan offset in output pixels, relative to the centered position. */
  panX: number
  panY: number
}

export interface CardContent {
  photo: CanvasImageSource & { width: number, height: number } | null
  transform: PhotoTransform
  name: string
  description: string
  /** Optional dark gradient behind the text for light photos. */
  shade: boolean
}

let fontsPromise: Promise<void> | null = null
const overlays = new Map<LayoutId, Promise<HTMLCanvasElement>>()

/**
 * Waits until the Hagrid faces used on the image are loaded. The @font-face rules
 * come from the Adobe Fonts stylesheet, which may still be loading when this runs,
 * so poll for them for a while. Resolves anyway after the timeout: the image is then
 * drawn with the fallback font and redrawn when the fonts arrive (see app.vue).
 */
async function loadFonts(timeout = 10_000) {
  const wanted = [FONTS.name, FONTS.description].map(f => String(f.weight))
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const faces = [...document.fonts].filter(f =>
      f.family.replace(/["']/g, '').toLowerCase() === 'hagrid' && wanted.includes(f.weight))
    if (wanted.every(w => faces.some(f => f.weight === w))) {
      await Promise.all(faces.map(f => f.load()))
      return
    }
    await new Promise(r => setTimeout(r, 100))
  }
  console.warn('Hagrid (Adobe Fonts) did not load in time; using the fallback font.')
}

/** Loads the fonts and rasterises the template overlay for a layout (cached). */
export async function loadCardAssets(layout: Layout): Promise<HTMLCanvasElement> {
  fontsPromise ??= loadFonts().catch((e) => {
    fontsPromise = null
    throw e
  })
  await fontsPromise

  let overlay = overlays.get(layout.id)
  if (!overlay) {
    overlay = renderOverlay(layout)
    overlay.catch(() => overlays.delete(layout.id))
    overlays.set(layout.id, overlay)
  }
  return overlay
}

async function renderOverlay(layout: Layout): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')!
  const images = await Promise.all(layout.layers.map(l => layerImage(l, layout)))
  layout.layers.forEach((l, i) => {
    ctx.save()
    ctx.beginPath()
    ctx.rect(l.dest.x, l.dest.y, l.dest.w, l.dest.h)
    ctx.clip()
    ctx.drawImage(images[i]!, 0, 0, layout.width, layout.height)
    ctx.restore()
  })
  return canvas
}

/**
 * Renders the template as a full-size image whose viewBox is chosen so that
 * `src` lands exactly on `dest`; the vector art stays sharp at any scale.
 */
async function layerImage(layer: Layer, layout: Layout): Promise<HTMLImageElement> {
  const k = layer.dest.w / layer.src.w
  const viewBox = [
    layer.src.x - layer.dest.x / k,
    layer.src.y - layer.dest.y / k,
    layout.width / k,
    layout.height / k,
  ].map(v => +v.toFixed(4)).join(' ')
  const hide = layer.hide.map(id => `#${id}`).join(',')
  const svg = templateSvg
    .replace(/<svg\b[^>]*>/, m => m
      .replace(/\swidth="[^"]*"/, ` width="${layout.width}"`)
      .replace(/\sheight="[^"]*"/, ` height="${layout.height}"`)
      .replace(/\sviewBox="[^"]*"/, ` viewBox="${viewBox}" preserveAspectRatio="none"`))
    .replace('</defs>', `<style>${hide}{display:none}</style></defs>`)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  }
  finally {
    URL.revokeObjectURL(url)
  }
}

/** Size and position of the photo for a given transform, with panning clamped so the area stays covered. */
export function photoRect(layout: Layout, img: { width: number, height: number }, t: PhotoTransform) {
  const { x, y, w, h } = layout.photo
  const scale = Math.max(w / img.width, h / img.height) * Math.max(1, t.zoom)
  const dw = img.width * scale
  const dh = img.height * scale
  const maxX = (dw - w) / 2
  const maxY = (dh - h) / 2
  const panX = clamp(t.panX, -maxX, maxX)
  const panY = clamp(t.panY, -maxY, maxY)
  return { dx: x + (w - dw) / 2 + panX, dy: y + (h - dh) / 2 + panY, dw, dh, panX, panY }
}

export function drawCard(ctx: CanvasRenderingContext2D, layout: Layout, overlay: CanvasImageSource, c: CardContent) {
  const { photo } = layout
  ctx.save()
  ctx.clearRect(0, 0, layout.width, layout.height)

  // 1. Photo, clipped to its area (slightly overlapping the magenta stripe to avoid a seam).
  ctx.save()
  ctx.beginPath()
  ctx.rect(photo.x, photo.y, photo.w + 1, photo.h)
  ctx.clip()
  ctx.fillStyle = PLACEHOLDER
  ctx.fillRect(photo.x, photo.y, photo.w + 1, photo.h)
  if (c.photo) {
    const r = photoRect(layout, c.photo, c.transform)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(c.photo, r.dx, r.dy, r.dw, r.dh)
  }
  if (c.shade) {
    const g = ctx.createLinearGradient(0, photo.y + photo.h * 0.47, 0, photo.y + photo.h)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.6)')
    ctx.fillStyle = g
    ctx.fillRect(photo.x, photo.y, photo.w + 1, photo.h)
  }
  ctx.restore()

  // 2. Stripes, folk pattern and logos.
  ctx.drawImage(overlay, 0, 0, layout.width, layout.height)

  // 3. Text, anchored at the description baseline and stacked upwards.
  drawText(ctx, layout, c.name, c.description)
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, layout: Layout, name: string, description: string) {
  const { text, name: N, description: D } = layout
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  ctx.font = font(FONTS.description, D.size)
  const descLines = wrap(ctx, description, text.maxWidth)

  // Shrink the name only if a single word (or hyphenated part) is wider than the available space.
  let nameSize = N.size
  ctx.font = font(FONTS.name, nameSize)
  const widest = Math.max(0, ...tokens(ctx, name, text.maxWidth).map(t => ctx.measureText(t.text).width))
  if (widest > text.maxWidth) {
    nameSize = Math.max(N.minSize, (N.size * text.maxWidth) / widest * 0.995)
    ctx.font = font(FONTS.name, nameSize)
  }
  const nameLines = wrap(ctx, name, text.maxWidth)
  const nameLineHeight = N.lineHeight * (nameSize / N.size)

  let baseline = D.baseline - (descLines.length - 1) * D.lineHeight
  ctx.font = font(FONTS.description, D.size)
  descLines.forEach((line, i) => ctx.fillText(line, text.x, baseline + i * D.lineHeight))

  if (descLines.length) baseline -= layout.nameToDescription
  else baseline = D.baseline
  ctx.font = font(FONTS.name, nameSize)
  const first = baseline - (nameLines.length - 1) * nameLineHeight
  nameLines.forEach((line, i) => ctx.fillText(line, text.x, first + i * nameLineHeight))
}

interface Token { text: string, glue: string }

/**
 * Splits a paragraph into words. Words that are too wide are split after their
 * hyphens and, as a last resort, into chunks of characters that fit.
 */
function tokens(ctx: CanvasRenderingContext2D, paragraph: string, maxWidth: number): Token[] {
  const out: Token[] = []
  for (const word of words(paragraph)) {
    const parts = ctx.measureText(word).width > maxWidth ? word.split(/(?<=-)(?=.)/) : [word]
    parts.forEach((part, i) => out.push({ text: part, glue: i === 0 ? ' ' : '' }))
  }
  return out
}

function breakWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const ch of Array.from(word)) {
    if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
      chunks.push(chunk)
      chunk = ch
    }
    else chunk += ch
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

/** Greedy word wrap that also respects line breaks typed by the user. */
function wrap(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of value.split(/\r?\n/)) {
    let line = ''
    for (const t of tokens(ctx, paragraph, maxWidth)) {
      const candidate = line ? line + t.glue + t.text : t.text
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      const chunks = breakWord(ctx, t.text, maxWidth)
      line = chunks.pop() ?? ''
      lines.push(...chunks)
    }
    if (line) lines.push(line)
  }
  return lines
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const font = (f: { family: string, weight: number }, size: number) => `${f.weight} ${size}px ${f.family}`
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function fileNameFor(name: string, layout: Layout) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `warsaw-congress-${slug || 'speaker'}-${layout.label.replace(':', 'x')}.png`
}
