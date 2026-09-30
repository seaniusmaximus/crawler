// Paints the "ice" tileset: frosted flagstones under drifting snow, walls of
// ice blocks capped with snow, frost-rimed doors and icicled bars.

import { blend, fbm, fillRect, rng, shade, valueNoise } from './raster.mjs'
import {
  FACE_H,
  FACE_W,
  TOP,
  bars,
  blockRim,
  bricks,
  disc,
  each,
  faceLight,
  groutBand,
  innerBrick,
  ironBand,
  longCrack,
  mix,
  newFace,
  newTop,
  patches,
  planks,
  rim,
  steps,
  stone,
  stoneField,
  tint,
  tones,
  writeSheet,
} from './common.mjs'

const PALETTE = {
  stone: [118, 128, 142],
  grout: [70, 82, 100],
  snow: [232, 238, 246],
  snowShade: [178, 194, 218],
  ice: [138, 188, 220],
  iceDeep: [74, 124, 172],
  packed: [206, 218, 232],
  frost: [244, 250, 255],
  wood: [104, 88, 80],
  iron: [58, 62, 72],
}

// ---------- Snow and frost ----------

/**
 * Snow lying in soft drifts: lumpy coverage from noise, lit on the upper-left
 * of each lump with blue shadow on the lower-right. `amount` 0..1.
 */
function snow(img, seed, amount, { scale = 40 } = {}) {
  each(img, (x, y) => {
    const n = fbm(x, y, scale, seed, 4)
    const cover = (n - (1 - amount)) * 3.2
    if (cover <= 0) return
    const slope = fbm(x - 2, y - 2, scale, seed, 4) - n
    const color = slope > 0 ? mix(PALETTE.snow, PALETTE.snowShade, Math.min(1, slope * 30)) : PALETTE.snow
    blend(img, x, y, color, Math.min(1, cover))
    if (cover > 1 && valueNoise(x, y, 1.5, seed + 3) > 0.97) blend(img, x, y, [255, 255, 255])
  })
}

/** Frost feathering in from the edges of a piece. */
function frostEdges(img, seed, reach = 10) {
  each(img, (x, y) => {
    const d = Math.min(x, y, img.w - 1 - x, img.h - 1 - y)
    const n = fbm(x, y, 5, seed, 3)
    const a = (1 - d / reach) * 0.8 + (n - 0.5) * 0.7
    if (a > 0) blend(img, x, y, PALETTE.frost, Math.min(0.7, a))
  })
}

/** A row of icicles hanging from `y`, tapering to points. */
function icicles(img, seed, y0, { from = 4, to = img.w - 4, max = 20 } = {}) {
  const rand = rng(seed)
  let x = from + rand.range(0, 6)
  while (x < to) {
    const len = rand.range(max * 0.3, max)
    const w = rand.range(1.5, 3.2)
    for (let t = 0; t < len; t++) {
      const half = w * (1 - t / len)
      for (let dx = -half; dx <= half; dx++) {
        const lit = dx < -half * 0.3 ? 1.2 : dx > half * 0.4 ? 0.8 : 1
        blend(img, x + dx, y0 + t, tint(mix(PALETTE.frost, PALETTE.ice, t / len), lit), 0.9)
      }
    }
    x += rand.range(5, 14)
  }
}

// ---------- Tops ----------

/** A frozen puddle: glassy blue with white fracture lines and a glint. */
function icePatch(img, seed, cx = TOP / 2, cy = TOP / 2, rx = 42, ry = 32) {
  const rand = rng(seed)
  each(img, (x, y) => {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (fbm(x, y, 16, seed, 2) - 0.5) * 0.4
    if (d >= 1) return
    const depth = fbm(x, y, 20, seed + 2, 2)
    blend(img, x, y, mix(PALETTE.ice, PALETTE.iceDeep, depth * 0.8), 0.92)
    if (d > 0.88) blend(img, x, y, PALETTE.frost, 0.7)
    // Diagonal glints across the surface.
    if (Math.abs(((x - y + 200) % 34) - 17) < 1.5 && d < 0.7) blend(img, x, y, [255, 255, 255], 0.35)
  })
  for (let i = 0; i < 3; i++) {
    let x = cx + rand.range(-rx * 0.5, rx * 0.5)
    let y = cy + rand.range(-ry * 0.5, ry * 0.5)
    const a = rand.range(0, Math.PI * 2)
    for (let t = 0; t < rx * 0.7; t++) {
      if (Math.hypot((x - cx) / rx, (y - cy) / ry) > 0.85) break
      blend(img, x, y, PALETTE.frost, 0.8)
      x += Math.cos(a) + rand.range(-0.4, 0.4)
      y += Math.sin(a) + rand.range(-0.4, 0.4)
    }
  }
}

function floorTile(seed, { min = 42, tone = 1, drift = 0.35, feature = null } = {}) {
  const img = newTop()
  const base = tint(PALETTE.stone, tone)
  stoneField(img, { x: 0, y: 0, w: TOP, h: TOP }, base, tint(base, 0.7), seed, {
    min,
    gap: 2,
    grain: 0.08,
    light: 1.06,
    dark: 0.9,
    crack: 0.12,
  })
  // Rime over the bare stone, snow gathered in drifts.
  each(img, (x, y) => blend(img, x, y, PALETTE.frost, 0.1 + fbm(x, y, 30, seed + 4, 2) * 0.14))
  if (feature === 'ice') icePatch(img, seed + 15)
  snow(img, seed + 5, feature === 'drift' ? 0.75 : drift)
  if (feature === 'tracks') {
    // A line of bootprints pressed into the snow.
    for (let i = 0; i < 4; i++) {
      const cx = 24 + i * 26
      const cy = 56 + (i % 2 ? 14 : -4)
      each(img, (x, y) => {
        const d = Math.hypot((x - cx) / 5, (y - cy) / 8)
        if (d < 1) blend(img, x, y, PALETTE.snowShade, 0.7)
      })
    }
  }
  if (feature === 'crack') longCrack(img, seed + 12, PALETTE.frost)
  groutBand(img, PALETTE.grout)
  return img
}

/** The top of a wall buried under a cap of snow, stone showing at the rim. */
function wallTop(seed, { min = 44, tone = 1, feature = null } = {}) {
  const img = newTop()
  stoneField(img, { x: 0, y: 0, w: TOP, h: TOP }, tint(PALETTE.stone, tone * 0.9), PALETTE.grout, seed, {
    min,
    gap: 4,
    bevel: 5,
    grain: 0.12,
    crack: 0.3,
  })
  snow(img, seed + 5, feature === 'bare' ? 0.6 : 0.85, { scale: 44 })
  if (feature === 'ice') icePatch(img, seed + 15, TOP / 2, TOP / 2, 30, 24)
  blockRim(img, 4, 0.7, 0.07)
  return img
}

/** Stone steps with snow packed on each tread and a glassy icy nosing. */
function stairs(seed) {
  const rand = rng(seed)
  const img = steps((out, r, i) => {
    stone(out, r, tint(PALETTE.stone, 1.02 - i * 0.04), rand, seed + i, { bevel: 3, crack: 0.2, corner: 0 })
    const sub = newTop()
    snow(sub, seed + i * 7, 0.6, { scale: 18 })
    for (let y = r.y + 4; y < r.y + r.h - 5; y++) {
      for (let x = 0; x < TOP; x++) {
        const at = (y * TOP + x) * 4
        if (sub.data[at + 3] > 0) blend(out, x, y, [sub.data[at], sub.data[at + 1], sub.data[at + 2]], sub.data[at + 3] / 255)
      }
    }
    for (let x = 0; x < TOP; x++) for (let s = 0; s < 3; s++) blend(out, x, r.y + s, PALETTE.ice, 0.4 - s * 0.1)
  })
  return img
}

// ---------- Faces ----------

/**
 * Blocks of ice laid like brick, bedded in packed snow, with light streaking
 * through them and a snow cap along the top.
 */
function iceFace(seed, { tone = 1, short = 30, long = 46, feature = null } = {}) {
  const img = newFace()
  const rand = rng(seed)
  const laid = bricks(img, seed, tint(PALETTE.ice, tone), PALETTE.packed, { short, long, grain: 0.12, crack: 0.2, bevel: 3, rand })
  each(img, (x, y) => {
    // Depth: blocks darken toward their lower middle, as if you can see into them.
    const deep = fbm(x, y, 16, seed + 2, 2)
    blend(img, x, y, PALETTE.iceDeep, deep * 0.28)
    // Faint light streaks, broken up so they don't read as a pattern.
    const streak = (x + y * 0.7 + fbm(x, y, 20, seed + 8, 2) * 30) % 46
    const fade = fbm(x, y, 18, seed + 10, 2)
    if (streak < 3 && fade > 0.5) blend(img, x, y, [255, 255, 255], 0.22 * (fade - 0.5) * 2)
  })
  // Trapped bubbles.
  for (let i = 0; i < 14; i++) disc(img, rand.range(4, FACE_W - 4), rand.range(8, FACE_H - 4), rand.range(0.6, 1.3), PALETTE.frost, 0.7, 0.6)
  if (feature === 'frozen') {
    // Something dark trapped deep inside a block.
    const b = innerBrick(laid, rand, img)
    each(img, (x, y) => {
      const d = Math.hypot((x - b.x - b.w / 2) / (b.w * 0.32), (y - b.y - b.h / 2) / (b.h * 0.3))
      if (d < 1) blend(img, x, y, [40, 46, 60], 0.55 * (1 - d * 0.6))
    })
  }
  if (feature === 'frost') patches(img, seed + 9, 0.4, PALETTE.frost, { scale: 10, max: 0.6, gain: 3 })
  if (feature === 'crack') longCrack(img, seed + 12, PALETTE.frost)
  faceLight(img, 1.1, 0.8)
  // A cap of snow lying along the top edge, drooping in places.
  for (let x = 0; x < FACE_W; x++) {
    const depth = 3 + fbm(x, 0, 14, seed + 6, 2) * 6
    for (let y = 0; y < depth; y++) blend(img, x, y, y > depth - 2 ? PALETTE.snowShade : PALETTE.snow)
  }
  if (feature === 'icicles') icicles(img, seed + 13, 5)
  return img
}

/** A door of grey, weathered planks, frost creeping in from its edges. */
function doorLeaf(seed) {
  const img = newFace()
  planks(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, seed, PALETTE.wood)
  ironBand(img, 0, 12, FACE_W, PALETTE.iron)
  ironBand(img, 0, FACE_H - 18, FACE_W, PALETTE.iron)
  // Snow lying on each band.
  fillRect(img, 0, 10, FACE_W, 2, PALETTE.snow)
  fillRect(img, 0, FACE_H - 20, FACE_W, 2, PALETTE.snow)
  disc(img, FACE_W - 22, FACE_H / 2 + 3, 4, tint(PALETTE.iron, 1.4))
  frostEdges(img, seed + 9, 8)
  rim(img, 3, 0.6)
  return img
}

function windowShutters(seed) {
  const img = newFace()
  planks(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, seed, PALETTE.wood)
  fillRect(img, FACE_W / 2 - 2, 0, 4, FACE_H, tint(PALETTE.wood, 0.6))
  ironBand(img, 0, FACE_H / 2 - 2, FACE_W, PALETTE.iron)
  fillRect(img, 0, FACE_H / 2 - 4, FACE_W, 2, PALETTE.snow)
  frostEdges(img, seed + 9, 10)
  rim(img, 3, 0.6)
  return img
}

/** Open window: iron bars, snow on the rail and icicles hanging below it. */
function icyBars(seed) {
  const img = newFace()
  bars(img, PALETTE.iron)
  fillRect(img, 0, FACE_H / 2 - 6, FACE_W, 3, PALETTE.snow)
  icicles(img, seed, FACE_H / 2 + 3, { max: 14 })
  return img
}

/** Rough stone with snow packed into every joint. */
function foundation(seed) {
  const img = newFace()
  stoneField(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, PALETTE.stone, PALETTE.packed, seed, {
    min: 16,
    gap: 3,
    bevel: 2,
    grain: 0.24,
    crack: 0.15,
  })
  patches(img, seed + 4, 0.35, PALETTE.frost, { scale: 12, max: 0.35 })
  return img
}

// ---------- Sheet ----------

const floorFeatures = [null, null, null, null, null, null, null, null, null, null, null, null, 'ice', 'drift', 'tracks', 'crack']
const topFeatures = [null, null, null, null, null, null, null, null, null, 'bare', 'ice', null]
const faceFeatures = [null, null, null, null, null, null, null, null, null, null, 'icicles', 'frozen', 'frost', 'crack', 'icicles', null]

writeSheet('ice', {
  floors: floorFeatures.map((feature, i) =>
    floorTile(41100 + i * 17, { min: 36 + (i % 4) * 5, tone: tones[i % tones.length], drift: 0.25 + (i % 3) * 0.12, feature }),
  ),
  wallTops: topFeatures.map((feature, i) =>
    wallTop(42200 + i * 23, { min: 40 + (i % 3) * 6, tone: tones[(i + 3) % tones.length], feature }),
  ),
  stairs: stairs(44400),
  walls: faceFeatures.map((feature, i) =>
    iceFace(45500 + i * 29, {
      tone: tones[(i + 5) % tones.length],
      short: 26 + (i % 3) * 4,
      long: 42 + (i % 4) * 4,
      feature,
    }),
  ),
  door: doorLeaf(46600),
  shutters: windowShutters(46700),
  open: icyBars(46800),
  foundations: [0, 1, 2, 3].map((i) => foundation(47700 + i * 11)),
})
