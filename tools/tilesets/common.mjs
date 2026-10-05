// Painting pieces shared by every tileset script, plus the sheet layout they
// all write. The layout is read back by src/tiles/sets/layout.ts; keep the two
// in step.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blend, blit, clamp, createImage, encodePng, fbm, fillRect, rng, shade, valueNoise } from './raster.mjs'

export const TOP = 128
export const FACE_W = 128
export const FACE_H = 72
export const COLS = 8

export const tint = (rgb, factor) => rgb.map((c) => clamp(c * factor))
export const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t)

/** Tone offsets cycled through variants, so neighbouring cells differ a little. */
export const tones = [1, 0.96, 1.04, 0.98, 1.02, 0.94, 1.06, 1]

/** Visit every pixel of an image. */
export function each(img, fn) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) fn(x, y)
}

/** Visit the pixels `inset` in from each edge, for rims and grout bands. */
export function eachEdge(img, inset, fn) {
  for (let t = 0; t < img.w; t++) {
    fn(t, inset)
    fn(t, img.h - 1 - inset)
  }
  for (let t = 0; t < img.h; t++) {
    fn(inset, t)
    fn(img.w - 1 - inset, t)
  }
}

// ---------- Stones ----------

/** Splits a rect into stone-sized pieces, like laying flagstones. */
export function split(r, rand, min, out = []) {
  const canW = r.w >= min * 2
  const canH = r.h >= min * 2
  if ((!canW && !canH) || (r.w < min * 2.6 && r.h < min * 2.6 && rand() < 0.35)) {
    out.push(r)
    return out
  }
  const vertical = canW && (!canH || r.w > r.h ? rand() < 0.75 : rand() < 0.25)
  if (vertical) {
    const cut = Math.round(rand.range(min, r.w - min))
    split({ x: r.x, y: r.y, w: cut, h: r.h }, rand, min, out)
    split({ x: r.x + cut, y: r.y, w: r.w - cut, h: r.h }, rand, min, out)
  } else {
    const cut = Math.round(rand.range(min, r.h - min))
    split({ x: r.x, y: r.y, w: r.w, h: cut }, rand, min, out)
    split({ x: r.x, y: r.y + cut, w: r.w, h: r.h - cut }, rand, min, out)
  }
  return out
}

/**
 * One stone: mottled fill, a light top-left bevel and dark bottom-right edge,
 * slightly clipped corners, and the occasional crack.
 */
export function stone(img, r, base, rand, seed, opts = {}) {
  const { bevel = 2, grain = 0.16, crack = 0.25, corner = 2, light = 1.16, dark = 0.72 } = opts
  const tone = rand.range(0.86, 1.1)
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const dx = Math.min(x - r.x, r.x + r.w - 1 - x)
      const dy = Math.min(y - r.y, r.y + r.h - 1 - y)
      if (dx + dy < corner) continue
      const n = fbm(x, y, 18, seed) - 0.5
      const speck = valueNoise(x, y, 2, seed + 7) > 0.93 ? 0.85 : 1
      let factor = tone * (1 + n * grain * 2) * speck
      if (x - r.x < bevel || y - r.y < bevel) factor *= light
      if (r.x + r.w - 1 - x < bevel || r.y + r.h - 1 - y < bevel) factor *= dark
      blend(img, x, y, tint(base, factor))
    }
  }
  if (rand() < crack) {
    let x = r.x + rand.range(r.w * 0.2, r.w * 0.8)
    let y = r.y + 2
    const steps = rand.int(r.h * 0.4, r.h * 0.9)
    for (let i = 0; i < steps && y < r.y + r.h - 2; i++) {
      shade(img, x, y, 0.62)
      shade(img, x + 1, y, 0.86)
      x += rand.range(-0.9, 0.9)
      y += 1
    }
  }
}

export function stoneField(img, area, base, grout, seed, { min, gap = 3, ...opts }) {
  const rand = rng(seed)
  fillRect(img, area.x, area.y, area.w, area.h, grout)
  for (const piece of split(area, rand, min)) {
    stone(
      img,
      { x: piece.x + gap / 2, y: piece.y + gap / 2, w: piece.w - gap, h: piece.h - gap },
      base,
      rand,
      seed + piece.x * 31 + piece.y,
      opts,
    )
  }
}

/**
 * Natural rock: irregular slabs from a jittered grid of points (Voronoi), each
 * domed and mottled, with dark seams where two slabs meet. `seam(x, y, t)`
 * may repaint seam pixels instead (t runs 0 at the seam's centre to 1 at its
 * edge), and `near(x, y, d)` touch up slab pixels by distance d from a seam.
 */
export function slabField(img, seed, { cell = 34, base, seamColor, seamWidth = 2.2, grain = 0.2, dome = 0.22, seam = null, near = null }) {
  const rand = rng(seed)
  const points = []
  for (let gy = -1; gy <= Math.ceil(img.h / cell); gy++) {
    for (let gx = -1; gx <= Math.ceil(img.w / cell); gx++) {
      points.push({
        x: (gx + rand.range(0.15, 0.85)) * cell,
        y: (gy + rand.range(0.15, 0.85)) * cell,
        tone: rand.range(0.84, 1.12),
        seed: seed + points.length * 13,
      })
    }
  }
  each(img, (x, y) => {
    let d1 = Infinity
    let d2 = Infinity
    let site = points[0]
    for (const p of points) {
      const dx = p.x - x
      const dy = p.y - y
      if (Math.abs(dx) > cell * 2 || Math.abs(dy) > cell * 2) continue
      const d = Math.hypot(dx, dy)
      if (d < d1) {
        d2 = d1
        d1 = d
        site = p
      } else if (d < d2) d2 = d
    }
    const w = (d2 - d1) / 2 + (fbm(x, y, 6, seed + 3, 2) - 0.5) * 2.4
    if (w < seamWidth) {
      if (seam) seam(x, y, Math.max(0, w / seamWidth))
      else blend(img, x, y, seamColor)
      return
    }
    const n = fbm(x, y, 14, site.seed) - 0.5
    const speck = valueNoise(x, y, 2, seed + 7) > 0.92 ? 0.84 : 1
    // Lit from the top left: pixels up-left of their slab's centre are brighter.
    const lean = (site.x - x + (site.y - y)) / cell
    let factor = site.tone * (1 + n * grain * 2) * speck * (1 + lean * dome)
    if (w < seamWidth + 3) factor *= 0.78 + ((w - seamWidth) / 3) * 0.22
    blend(img, x, y, tint(base, factor))
    if (near) near(x, y, w - seamWidth)
  })
}

/** Grime pooled in the grout and a few dark patches, so floors look trodden. */
export function grime(img, seed, amount) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const n = fbm(x, y, 40, seed, 2)
      if (n > 1 - amount) shade(img, x, y, 0.82 + (1 - n) * 0.4)
    }
  }
}

/** Soft colour pooling in noisy patches: moss, soot, frost, scorch. */
export function patches(img, seed, amount, color, { scale = 22, max = 0.55, gain = 4 } = {}) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const n = fbm(x, y, scale, seed, 3)
      if (n > 1 - amount) blend(img, x, y, color, Math.min(max, (n - (1 - amount)) * gain))
    }
  }
}

/** Green growth pooling in low spots and seams. */
export function moss(img, seed, amount) {
  patches(img, seed, amount, [74, 96, 52])
}

/** One long crack wandering across the whole piece. */
export function longCrack(img, seed, color = null) {
  const rand = rng(seed)
  let x = rand.range(img.w * 0.15, img.w * 0.4)
  let y = 0
  let drift = rand.range(-0.6, 0.9)
  while (y < img.h && x > 0 && x < img.w) {
    if (color) {
      blend(img, x, y, color)
      blend(img, x + 1, y, color, 0.5)
      blend(img, x - 1, y, color, 0.25)
    } else {
      shade(img, x, y, 0.5)
      shade(img, x + 1, y, 0.78)
      shade(img, x - 1, y, 0.9)
    }
    if (rand() < 0.08) drift = rand.range(-0.9, 0.9)
    x += drift + rand.range(-0.5, 0.5)
    y += 1
  }
}

/** Loose pebbles with little shadows, as if kicked about. */
export function pebbles(img, seed, count, color, size = [2, 5]) {
  const rand = rng(seed)
  for (let i = 0; i < count; i++) {
    const cx = rand.range(12, img.w - 12)
    const cy = rand.range(12, img.h - 12)
    const r = rand.range(size[0], size[1])
    const tone = rand.range(0.8, 1.15)
    for (let y = -r - 1; y <= r + 2; y++) {
      for (let x = -r - 1; x <= r + 1; x++) {
        const d = Math.hypot(x, y * 1.2)
        if (d <= r) blend(img, cx + x, cy + y, tint(color, tone * (1.1 - (y / r) * 0.15)))
        else if (d <= r + 1.5 && y > 0) shade(img, cx + x + 1, cy + y, 0.7)
      }
    }
  }
}

/** A dark grout band round the edge; neighbouring tiles' bands meet into the floor grid. */
export function groutBand(img, color) {
  for (let i = 0; i < 3; i++) {
    const strength = [0.35, 0.55, 0.8][i]
    eachEdge(img, i, (x, y) => blend(img, x, y, color, 1 - strength))
  }
}

/** A dark rim so each wall top reads as the top of a block. */
export function blockRim(img, width = 4, from = 0.62, step = 0.08) {
  for (let i = 0; i < width; i++) eachEdge(img, i, (x, y) => shade(img, x, y, from + i * step))
}

/** Light catches a face's top edge; its foot sits in shadow. */
export function faceLight(img, top = 1.25, foot = 0.62) {
  for (let x = 0; x < img.w; x++) {
    for (let y = 0; y < 2; y++) shade(img, x, y, top)
    for (let y = 0; y < 10; y++) shade(img, x, img.h - 1 - y, foot + y * ((1 - foot) / 10))
  }
}

/**
 * Courses of brick. Courses sit at the same heights on every variant so
 * neighbouring faces line up; brick lengths and tone vary. Returns the bricks.
 */
export function bricks(img, seed, base, mortar, { course = 18, short = 30, long = 46, crack = 0.08, grain = 0.2, bevel = 2, rand = rng(seed) } = {}) {
  fillRect(img, 0, 0, img.w, img.h, mortar)
  const laid = []
  for (let row = 0; row * course < img.h; row++) {
    let x = row % 2 === 0 ? -rand.int(4, 18) : -rand.int(22, 36)
    while (x < img.w) {
      const w = rand.int(short, long)
      const r = { x: x + 1, y: row * course + 1, w: w - 2, h: course - 2 }
      laid.push(r)
      stone(img, r, tint(base, rand.range(0.92, 1.08)), rand, seed + row * 97 + x, { bevel, grain, crack, corner: 1 })
      x += w
    }
  }
  return laid
}

/** A brick deep inside a face, for knocking out or decorating. */
export function innerBrick(laid, rand, img) {
  const inner = laid.filter((b) => b.x > 8 && b.x + b.w < img.w - 8 && b.y > 10 && b.y < img.h - 24)
  return inner[Math.floor(rand() * inner.length)] ?? laid[5]
}

// ---------- Wood and metal ----------

export function planks(img, r, seed, wood, { vertical = true, plank = 11, seamDark = 0.5, grainAmount = 0.55 } = {}) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const across = vertical ? x - r.x : y - r.y
      const along = vertical ? y : x
      const seam = across % plank < 1.2
      const grain = fbm(across * 3, along * 0.3, 6, seed) - 0.5
      let factor = 1 + grain * grainAmount
      if (seam) factor *= seamDark
      blend(img, x, y, tint(wood, factor))
    }
  }
}

export function ironBand(img, x, y, w, iron, h = 4) {
  fillRect(img, x, y, w, h, iron)
  fillRect(img, x, y, w, 1, tint(iron, 1.6))
  for (let rx = x + 4; rx < x + w - 2; rx += 10) fillRect(img, rx, y + 1, 2, 2, tint(iron, 2.2))
}

/** Darken a leaf's rim so its edges read against the stone around it. */
export function rim(img, width, factor) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (x < width || y < width || x >= img.w - width || y >= img.h - width) shade(img, x, y, factor)
    }
  }
}

export function ring(img, cx, cy, rx, ry, color, step = 0.12) {
  for (let a = 0; a < Math.PI * 2; a += step) blend(img, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, color)
}

/** A filled disc with a soft falloff, e.g. a glow or a knob. */
export function disc(img, cx, cy, r, color, alpha = 1, soft = 1) {
  for (let y = Math.floor(cy - r - soft); y <= cy + r + soft; y++) {
    for (let x = Math.floor(cx - r - soft); x <= cx + r + soft; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r) blend(img, x, y, color, alpha)
      else if (d <= r + soft) blend(img, x, y, color, alpha * (1 - (d - r) / soft))
    }
  }
}

/** Upright bars on a transparent ground with a rail across, so the room shows through. */
export function bars(img, iron, { spacing = 22, width = 6, rail = true } = {}) {
  for (let x = 10; x < img.w - 6; x += spacing) {
    fillRect(img, x, 0, width, img.h, iron)
    fillRect(img, x + 1, 0, 1, img.h, tint(iron, 1.8))
  }
  if (rail) {
    fillRect(img, 0, img.h / 2 - 3, img.w, 6, iron)
    fillRect(img, 0, img.h / 2 - 3, img.w, 1, tint(iron, 1.8))
  }
}

/** Steps seen from above: `treads` bands, each lit at its nosing and shadowed under it. */
export function steps(paintTread, treads = 5) {
  const img = createImage(TOP, TOP)
  const depth = TOP / treads
  for (let i = 0; i < treads; i++) {
    const y0 = Math.round(i * depth)
    paintTread(img, { x: 0, y: y0, w: TOP, h: Math.round(depth) }, i)
    for (let x = 0; x < TOP; x++) {
      for (let s = 0; s < 5; s++) shade(img, x, y0 + depth - 1 - s, 0.55 + s * 0.08)
    }
  }
  return img
}

// ---------- Sheet ----------

export const newTop = () => createImage(TOP, TOP)
export const newFace = () => createImage(FACE_W, FACE_H)

/**
 * Lays out and writes `src/tiles/sets/<id>.png`:
 *   rows 0-1  16 floor tops
 *   rows 2-3  12 wall tops, then stairs (flat, for ramps), then the 3D stair
 *             parts: a step's tread (a top), its riser and the shaft wall of a
 *             stairwell going down (both faces, FACE_H tall, top-aligned)
 *   rows 4-5  16 wall faces (FACE_H tall)
 *   row  6    door, shutters, bars, 4 foundations
 */
export function writeSheet(id, { floors, wallTops, stairs, stairParts, walls, door, shutters, open, foundations }) {
  const expect = { floors: [floors, 16], wallTops: [wallTops, 12], walls: [walls, 16], foundations: [foundations, 4] }
  for (const [name, [list, count]] of Object.entries(expect)) {
    if (list.length !== count) throw new Error(`${id}: ${name} needs ${count} cells, got ${list.length}`)
  }
  const { tread, riser, shaft } = stairParts ?? {}
  for (const [name, img, w, h] of [['tread', tread, TOP, TOP], ['riser', riser, FACE_W, FACE_H], ['shaft', shaft, FACE_W, FACE_H]]) {
    if (!img || img.w !== w || img.h !== h) throw new Error(`${id}: stairParts.${name} must be ${w}x${h}`)
  }
  const rows = [
    { y: 0, cells: floors.slice(0, COLS) },
    { y: TOP, cells: floors.slice(COLS) },
    { y: TOP * 2, cells: wallTops.slice(0, COLS) },
    { y: TOP * 3, cells: [...wallTops.slice(COLS), stairs, tread, riser, shaft] },
    { y: TOP * 4, cells: walls.slice(0, COLS) },
    { y: TOP * 4 + FACE_H, cells: walls.slice(COLS) },
    { y: TOP * 4 + FACE_H * 2, cells: [door, shutters, open, ...foundations] },
  ]
  const sheet = createImage(TOP * COLS, TOP * 4 + FACE_H * 3)
  for (const row of rows) row.cells.forEach((cell, i) => blit(sheet, cell, i * TOP, row.y))
  const out = join(dirname(fileURLToPath(import.meta.url)), `../../src/tiles/sets/${id}.png`)
  writeFileSync(out, encodePng(sheet))
  console.log(`wrote ${out} (${sheet.w}x${sheet.h})`)
}
