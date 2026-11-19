<script setup lang="ts">
const DEFAULT_DESCRIPTION = 'Speaker at this panel'

const canvas = ref<HTMLCanvasElement | null>(null)

const name = ref('')
const description = ref(DEFAULT_DESCRIPTION)
const shade = ref(false)
const layoutId = ref<LayoutId>('portrait')
const layout = computed(() => LAYOUTS[layoutId.value])
const layoutOptions = [
  { id: 'portrait' as const, title: 'Portrait 4:5', size: '1080 × 1350 px' },
  { id: 'square' as const, title: 'Square 1:1', size: '1080 × 1080 px' },
]
const zoom = ref(1)
const pan = reactive({ x: 0, y: 0 })

// The uploaded picture never leaves the browser: it is kept as a Blob and
// read through an object URL.
const photo = shallowRef<HTMLImageElement | null>(null)
let photoUrl: string | null = null

// Rasterised template for the current layout (stripes, pattern, logos).
const overlay = shallowRef<{ id: LayoutId, canvas: HTMLCanvasElement } | null>(null)
const ready = computed(() => overlay.value?.id === layoutId.value)
const loadError = ref('')
const photoError = ref('')
const dragOver = ref(false)
const busy = ref(false)
const canShareFiles = ref(false)

async function loadOverlay() {
  const target = layout.value
  loadError.value = ''
  try {
    const canvas = await loadCardAssets(target)
    if (target.id === layoutId.value) overlay.value = { id: target.id, canvas }
  }
  catch (e) {
    console.error(e)
    loadError.value = 'The template could not be loaded. Please reload the page.'
  }
}

watch(layoutId, () => {
  loadOverlay()
  // The photo area changes size: keep the position valid for the new layout.
  setPan(pan.x, pan.y)
})

// Redraw when web fonts finish loading (e.g. Hagrid arriving after the first render).
const onFontsLoaded = () => scheduleDraw()

onMounted(() => {
  document.fonts.addEventListener('loadingdone', onFontsLoaded)
  loadOverlay()
  try {
    const probe = new File([new Blob()], 'probe.png', { type: 'image/png' })
    canShareFiles.value = !!navigator.canShare?.({ files: [probe] })
  }
  catch {
    canShareFiles.value = false
  }
})

onBeforeUnmount(() => {
  document.fonts.removeEventListener('loadingdone', onFontsLoaded)
  if (photoUrl) URL.revokeObjectURL(photoUrl)
})

// ---------------------------------------------------------------- rendering
let frame = 0
function scheduleDraw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const ctx = canvas.value?.getContext('2d')
    if (!ctx || !overlay.value || overlay.value.id !== layoutId.value) return
    drawCard(ctx, layout.value, overlay.value.canvas, {
      photo: photo.value,
      transform: { zoom: zoom.value, panX: pan.x, panY: pan.y },
      name: name.value,
      description: description.value,
      shade: shade.value,
    })
  })
}
watch([overlay, layoutId, photo, name, description, shade, zoom, () => pan.x, () => pan.y, canvas], scheduleDraw)

// ------------------------------------------------------------------- photo
async function setPhoto(file: File | undefined | null) {
  photoError.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    photoError.value = 'That file is not an image. Please choose a JPG, PNG or WebP picture.'
    return
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  }
  catch {
    URL.revokeObjectURL(url)
    photoError.value = 'This picture could not be read by your browser. Try a JPG or PNG.'
    return
  }
  if (photoUrl) URL.revokeObjectURL(photoUrl)
  photoUrl = url
  photo.value = img
  resetPosition()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  setPhoto(input.files?.[0])
  input.value = ''
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  setPhoto(e.dataTransfer?.files?.[0])
}

function removePhoto() {
  if (photoUrl) URL.revokeObjectURL(photoUrl)
  photoUrl = null
  photo.value = null
  resetPosition()
}

function resetPosition() {
  zoom.value = 1
  pan.x = 0
  pan.y = 0
}

/** Keep the stored pan inside the range where the photo still covers its area. */
function setPan(x: number, y: number) {
  if (!photo.value) return
  const r = photoRect(layout.value, photo.value, { zoom: zoom.value, panX: x, panY: y })
  pan.x = r.panX
  pan.y = r.panY
}
watch(zoom, () => setPan(pan.x, pan.y))

// Drag the photo on the preview to reposition it.
let drag: { id: number, x: number, y: number, scale: number } | null = null
function onPointerDown(e: PointerEvent) {
  if (!photo.value || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, scale: layout.value.width / rect.width }
  canvas.value.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!drag || drag.id !== e.pointerId) return
  setPan(pan.x + (e.clientX - drag.x) * drag.scale, pan.y + (e.clientY - drag.y) * drag.scale)
  drag.x = e.clientX
  drag.y = e.clientY
}
function onPointerUp(e: PointerEvent) {
  if (drag?.id === e.pointerId) drag = null
}
function onKeydown(e: KeyboardEvent) {
  if (!photo.value) return
  const step = e.shiftKey ? 50 : 10
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  }
  const m = moves[e.key]
  if (!m) return
  e.preventDefault()
  setPan(pan.x + m[0], pan.y + m[1])
}

// ------------------------------------------------------------------ export
const fileName = computed(() => fileNameFor(name.value, layout.value))

function toBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!canvas.value) return reject(new Error('No canvas'))
    canvas.value.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png')
  })
}

async function download() {
  busy.value = true
  try {
    const blob = await toBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.value
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  finally {
    busy.value = false
  }
}

async function share() {
  busy.value = true
  try {
    const blob = await toBlob()
    const file = new File([blob], fileName.value, { type: 'image/png' })
    await navigator.share({ files: [file], title: 'Warsaw Congress' })
  }
  catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') {
      console.error(e)
      alert('Sharing failed. You can download the image instead.')
    }
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="masthead">
      <div class="stripes" aria-hidden="true">
        <span class="s-magenta" /><span class="s-yellow" /><span class="s-green" />
      </div>
      <div class="masthead-inner">
        <h1>Speaker card generator</h1>
      </div>
    </header>

    <main class="layout">
      <section class="preview" aria-label="Preview">
        <div class="frame" :class="{ draggable: !!photo }" :style="{ aspectRatio: `${layout.width} / ${layout.height}` }">
          <canvas
            ref="canvas"
            :width="layout.width"
            :height="layout.height"
            :tabindex="photo ? 0 : -1"
            role="img"
            :aria-label="`Preview of the ${layout.label} speaker card for ${name || 'unnamed speaker'}`"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @keydown="onKeydown"
          />
          <div v-if="!ready && !loadError" class="frame-status">
            Loading template…
          </div>
          <div v-if="loadError" class="frame-status error">
            {{ loadError }}
          </div>
        </div>
        <p v-if="photo" class="hint">
          Drag the photo (or use the arrow keys) to reposition it.
        </p>
      </section>

      <section class="panel" aria-label="Settings">
        <fieldset class="field formats">
          <legend class="label">
            Format
          </legend>
          <div class="format-options">
            <label v-for="o in layoutOptions" :key="o.id" class="format" :class="{ active: layoutId === o.id }">
              <input v-model="layoutId" type="radio" name="layout" :value="o.id" class="sr-only">
              <span class="format-icon" :class="o.id" aria-hidden="true" />
              <span class="format-text">
                <span class="format-title">{{ o.title }}</span>
                <span class="format-size">{{ o.size }}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div class="field">
          <span class="label">Photo</span>
          <label
            class="drop"
            :class="{ over: dragOver, filled: !!photo }"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <input type="file" accept="image/*" class="sr-only" @change="onFileChange">
            <span class="drop-title">{{ photo ? 'Replace photo' : 'Choose a photo' }}</span>
            <span class="drop-sub">or drop an image here</span>
          </label>
          <p v-if="photoError" class="error-text" role="alert">
            {{ photoError }}
          </p>

          <div v-if="photo" class="photo-tools">
            <label class="zoom">
              <span>Zoom</span>
              <input v-model.number="zoom" type="range" min="1" max="3" step="0.01">
            </label>
            <div class="row">
              <button type="button" class="btn ghost small" @click="resetPosition">
                Reset position
              </button>
              <button type="button" class="btn ghost small" @click="removePhoto">
                Remove photo
              </button>
            </div>
          </div>
        </div>

        <div class="field">
          <label class="label" for="speaker-name">Speaker name</label>
          <textarea
            id="speaker-name"
            v-model="name"
            rows="2"
            placeholder="Gergely Karácsony"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="help">Long names wrap automatically. Press Enter to force a line break.</span>
        </div>

        <div class="field">
          <label class="label" for="speaker-description">Speaker description</label>
          <input
            id="speaker-description"
            v-model="description"
            type="text"
            :placeholder="DEFAULT_DESCRIPTION"
            autocomplete="off"
          >
        </div>

        <label class="check">
          <input v-model="shade" type="checkbox">
          <span>Darken the bottom of the photo <small>(helps the text stand out on light photos)</small></span>
        </label>

        <div class="actions">
          <button type="button" class="btn primary" :disabled="!ready || busy" @click="download">
            Download PNG
          </button>
          <button v-if="canShareFiles" type="button" class="btn secondary" :disabled="!ready || busy" @click="share">
            Share…
          </button>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
}

.masthead {
  position: relative;
  background: var(--green);
  color: #fff;
  overflow: hidden;
}

.stripes {
  position: absolute;
  inset: 0 auto 0 0;
  display: flex;
}

.stripes span {
  display: block;
  height: 100%;
}

.s-magenta { width: 10px; background: var(--magenta); }
.s-yellow { width: 20px; background: var(--yellow); }
.s-green { width: 0; }

.masthead-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 24px 30px 56px;
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 14px;
  letter-spacing: 0.04em;
  opacity: 0.85;
}

h1 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1.05;
}

.lede {
  margin: 10px 0 0;
  max-width: 42em;
  opacity: 0.92;
}

.layout {
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 24px 48px;
  display: grid;
  gap: 28px;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 400px;
    align-items: start;
  }

  .preview {
    position: sticky;
    top: 24px;
  }
}

.frame {
  position: relative;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  border-radius: 6px;
  overflow: hidden;
  background: #2f3d36;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px rgb(10 105 54 / 0.14);
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.frame.draggable canvas {
  cursor: grab;
}

.frame.draggable canvas:active {
  cursor: grabbing;
}

canvas:focus-visible {
  outline: 3px solid var(--magenta);
  outline-offset: -3px;
}

.frame-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: #fff;
}

.frame-status.error {
  color: #ffd1dc;
}

.hint {
  margin: 10px auto 0;
  max-width: 560px;
  text-align: center;
  font-size: 14px;
  color: var(--muted);
}

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 22px;
  display: grid;
  gap: 22px;
}

.field {
  display: grid;
  gap: 8px;
}

.formats {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.formats legend {
  padding: 0;
  margin-bottom: 8px;
}

.format-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.format {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.format:hover {
  border-color: var(--green);
}

.format.active {
  border-color: var(--green);
  background: #eaf6f0;
  box-shadow: inset 0 0 0 1px var(--green);
}

.format:focus-within {
  box-shadow: 0 0 0 3px rgb(0 149 101 / 0.25);
}

.format-icon {
  flex: none;
  width: 22px;
  border: 2px solid var(--green-dark);
  border-radius: 3px;
  background: linear-gradient(90deg, transparent 62%, var(--magenta) 62% 68%, var(--yellow) 68% 78%, var(--green) 78%);
}

.format-icon.portrait {
  height: 27.5px;
}

.format-icon.square {
  height: 22px;
}

.format-text {
  display: grid;
  line-height: 1.25;
}

.format-title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 14px;
}

.format-size {
  font-size: 12px;
  color: var(--muted);
}

.label,
.zoom > span {
  font-family: var(--font-mono);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 13px;
  letter-spacing: 0.01em;
  color: var(--muted);
}

.help {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}

input[type='text'],
textarea {
  width: 100%;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  resize: vertical;
  transition: border-color 0.15s, box-shadow 0.15s;
}

input[type='text']:focus,
textarea:focus {
  outline: none;
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgb(0 149 101 / 0.2);
}

.drop {
  display: grid;
  gap: 2px;
  place-items: center;
  padding: 22px 16px;
  border: 2px dashed #b9c7bf;
  border-radius: 12px;
  background: #f7faf8;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.drop:hover,
.drop.over {
  border-color: var(--green);
  background: #eaf6f0;
}

.drop:focus-within {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgb(0 149 101 / 0.2);
}

.drop.filled {
  padding: 14px 16px;
}

.drop-title {
  font-family: var(--font-display);
  font-weight: 800;
  color: var(--green-dark);
}

.drop-sub {
  font-size: 13px;
  color: var(--muted);
}

.photo-tools {
  display: grid;
  gap: 10px;
  margin-top: 4px;
}

.zoom {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.zoom input {
  accent-color: var(--green);
  width: 100%;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 15px;
  cursor: pointer;
}

.check input {
  margin-top: 4px;
  width: 18px;
  height: 18px;
  accent-color: var(--green);
}

.check small {
  color: var(--muted);
  font-size: 13px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.btn {
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 12px 22px;
  font-family: var(--font-display);
  font-weight: 800;
  cursor: pointer;
  transition: background 0.15s, transform 0.05s, opacity 0.15s;
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn:focus-visible {
  outline: 3px solid var(--magenta);
  outline-offset: 2px;
}

.btn.primary {
  flex: 1 1 auto;
  background: var(--green);
  color: #fff;
}

.btn.primary:hover:not(:disabled) {
  background: var(--green-dark);
}

.btn.secondary {
  flex: 1 1 auto;
  background: var(--yellow);
  color: var(--ink);
}

.btn.secondary:hover:not(:disabled) {
  background: #f2d000;
}

.btn.ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink);
}

.btn.ghost:hover {
  border-color: var(--green);
  color: var(--green-dark);
}

.btn.small {
  padding: 7px 14px;
  font-size: 14px;
}

.error-text {
  margin: 0;
  color: #a1123c;
  font-size: 14px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
