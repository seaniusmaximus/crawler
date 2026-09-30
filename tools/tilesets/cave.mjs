// Paints the "cave" tileset: uneven rock and packed dirt underfoot, layered
// rock walls, lashed-log doors, hide shutters and wooden stakes.

import { blend, fbm, fillRect, rng, shade, valueNoise } from './raster.mjs'
import {
  FACE_H,
  FACE_W,
  TOP,
  bars,
  blockRim,
  disc,
  each,
  faceLight,
  grime,
  groutBand,
  longCrack,
  mix,
  moss,
  newFace,
  newTop,
  patches,
  pebbles,
  planks,
  rim,
  slabField,
  steps,
  stoneField,
  tint,
  tones,
  writeSheet,
} from './common.mjs'

const PALETTE = {
  rock: [112, 100, 88],
  dirt: [96, 78, 58],
  seam: [40, 34, 30],
  wallTop: [86, 80, 76],
  wallRock: [92, 84, 78],
  wallDark: [34, 30, 28],
  log: [104, 74, 46],
  rope: [168, 142, 96],
  hide: [150, 116, 80],
  water: [36, 52, 60],
  crystal: [120, 210, 220],
  crystalDeep: [60, 110, 160],
  shroom: [160, 230, 150],
  root: [70, 52, 36],
}

// ---------- Features ----------

/** A shallow puddle: dark still water with a pale glint along its near edge. */
function puddle(img, seed) {
  const cx = TOP / 2
  const cy = TOP / 2
  each(img, (x, y) => {
    const d = Math.hypot((x - cx) / 38, (y - cy) / 28) + (fbm(x, y, 16, seed, 2) - 0.5) * 0.5
    if (d < 1) {
      blend(img, x, y, tint(PALETTE.water, 0.9 + (y - cy) / 200), 0.85)
      if (d > 0.86 && y < cy) blend(img, x, y, [170, 190, 196], 0.35)
    } else if (d < 1.1) shade(img, x, y, 0.8)
  })
}

/** A clump of pale, faintly glowing mushrooms. */
function mushrooms(img, seed, color = PALETTE.shroom) {
  const rand = rng(seed)
  const cx = rand.range(40, TOP - 40)
  const cy = rand.range(40, TOP - 40)
  disc(img, cx, cy, 20, color, 0.12, 14)
  for (let i = 0; i < 6; i++) {
    const x = cx + rand.range(-16, 16)
    const y = cy + rand.range(-12, 12)
    const r = rand.range(3, 6)
    disc(img, x + 1.5, y + 2, r, [20, 18, 16], 0.5)
    disc(img, x, y, r, tint(color, rand.range(0.8, 1)))
    disc(img, x - r * 0.3, y - r * 0.3, r * 0.4, [236, 250, 230], 0.8)
  }
}

/** Crystals growing out of rock: bright angular shards with a soft glow. */
function crystals(img, seed, cx, cy, spread, up = true) {
  const rand = rng(seed)
  disc(img, cx, cy, spread + 8, PALETTE.crystal, 0.14, 12)
  for (let i = 0; i < 5; i++) {
    const bx = cx + rand.range(-spread, spread)
    const len = rand.range(10, 22)
    const w = rand.range(3, 5)
    const lean = rand.range(-0.5, 0.5)
    for (let t = 0; t < len; t++) {
      const half = w * (1 - t / len)
      const y = up ? cy - t : cy + t
      for (let dx = -half; dx <= half; dx++) {
        const lit = dx < 0 ? 1.2 : 0.85
        blend(img, bx + lean * t + dx, y, tint(mix(PALETTE.crystalDeep, PALETTE.crystal, t / len), lit))
      }
    }
  }
}

// ---------- Tops ----------

function floorTile(seed, { cell = 30, tone = 1, feature = null } = {}) {
  const img = newTop()
  slabField(img, seed, { cell, base: tint(PALETTE.rock, tone), seamColor: tint(PALETTE.rock, 0.62 * tone), seamWidth: 1.4, grain: 0.1, dome: 0.08 })
  // Packed dirt filling the low ground between the rocks.
  patches(img, seed + 5, 0.55, PALETTE.dirt, { scale: 34, max: 0.85, gain: 3 })
  grime(img, seed + 3, 0.15)
  pebbles(img, seed + 13, 4, PALETTE.rock, [1, 3])
  if (feature === 'gravel') pebbles(img, seed + 14, 22, tint(PALETTE.rock, 1.1), [1, 3])
  if (feature === 'puddle') puddle(img, seed + 15)
  if (feature === 'mushrooms') mushrooms(img, seed + 16)
  if (feature === 'crack') longCrack(img, seed + 12)
  if (feature === 'moss') moss(img, seed + 11, 0.3)
  groutBand(img, PALETTE.seam)
  return img
}

function wallTop(seed, { cell = 40, tone = 1, feature = null } = {}) {
  const img = newTop()
  slabField(img, seed, { cell, base: tint(PALETTE.wallTop, tone), seamColor: PALETTE.wallDark, seamWidth: 3, grain: 0.18, dome: 0.35 })
  if (feature === 'moss') moss(img, seed + 11, 0.3)
  if (feature === 'crystals') crystals(img, seed + 17, TOP / 2, TOP / 2 + 12, 16)
  blockRim(img, 5, 0.55, 0.08)
  return img
}

/** Steps hacked out of the rock: one slab field, cut into treads that darken as they descend. */
function stairs(seed) {
  const rock = newTop()
  slabField(rock, seed, { cell: 26, base: PALETTE.rock, seamColor: PALETTE.seam, seamWidth: 1.2, grain: 0.14, dome: 0.1 })
  return steps((img, r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const at = (y * TOP + x) * 4
        const lip = y - r.y < 3 ? 1.12 : 1
        blend(img, x, y, tint([rock.data[at], rock.data[at + 1], rock.data[at + 2]], (1.05 - i * 0.05) * lip))
      }
    }
  })
}

// ---------- Faces ----------

/**
 * Layered rock: horizontal strata that bulge and pinch across the face but
 * meet the same heights at both edges, so neighbouring faces line up.
 */
function strataFace(seed, { tone = 1, feature = null } = {}) {
  const img = newFace()
  const rand = rng(seed)
  const bands = [0, 16, 31, 47, 60, FACE_H + 12]
  // Each stratum is broken into blocks by vertical joints.
  const joints = bands.map(() => {
    const at = [-rand.int(0, 20)]
    while (at[at.length - 1] < FACE_W + 20) at.push(at[at.length - 1] + rand.int(30, 70))
    return at
  })
  const blocks = joints.map((at) => at.map(() => rand.range(0.8, 1.16)))
  each(img, (x, y) => {
    const pinch = Math.sin((Math.PI * x) / FACE_W)
    let band = 0
    let top = 0
    let bottom = 0
    for (band = 0; band < bands.length - 1; band++) {
      const edge = (b) => bands[b] + ((fbm(x, b * 50, 18, seed, 2) - 0.5) * 12 + (valueNoise(x, b * 9, 4, seed + 5) - 0.5) * 3) * pinch
      top = edge(band)
      bottom = edge(band + 1)
      if (y < bottom || band === bands.length - 2) break
    }
    const cuts = joints[band]
    // Joints wander rather than run plumb.
    const jx = x + (fbm(band * 40, y, 7, seed + 21, 2) - 0.5) * 12
    let j = 0
    while (j < cuts.length - 1 && jx >= cuts[j + 1]) j++
    const fromJoint = Math.min(jx - cuts[j], (cuts[j + 1] ?? 999) - jx)
    const n = fbm(x, y, 12, seed + band * 7, 3) - 0.5
    const speck = valueNoise(x, y, 2, seed + 9) > 0.9 ? 0.82 : 1
    let factor = tone * blocks[band][j] * (1 + n * 0.45) * speck
    const into = y - top
    const left = bottom - y
    if (into < 2.5) factor *= 1.25
    if (left < 5) factor *= 0.55 + (left / 5) * 0.45
    if (left < 1.5) factor = 0.3
    if (fromJoint < 1.2) factor *= 0.6
    else if (fromJoint < 2.6) factor *= 1.1
    blend(img, x, y, tint(PALETTE.wallRock, factor))
  })
  // A few vertical fractures across the strata.
  for (let i = 0; i < 3; i++) {
    let x = rand.range(10, FACE_W - 10)
    for (let y = rand.int(0, 20); y < FACE_H; y++) {
      shade(img, x, y, 0.55)
      shade(img, x + 1, y, 1.1)
      x += rand.range(-0.6, 0.6)
      if (rand() < 0.02) break
    }
  }
  if (feature === 'crystals') crystals(img, seed + 17, rand.range(36, FACE_W - 36), FACE_H - 6, 16)
  if (feature === 'roots') {
    // Roots pushing through from the earth above.
    for (let i = 0; i < 6; i++) {
      let x = rand.range(8, FACE_W - 8)
      const len = rand.range(14, 44)
      for (let y = 0; y < len; y++) {
        const w = 2.4 * (1 - y / len) + 0.6
        for (let dx = -w; dx <= w; dx++) blend(img, x + dx, y, tint(PALETTE.root, dx < 0 ? 1.25 : 0.85))
        x += rand.range(-0.8, 0.8)
      }
    }
  }
  if (feature === 'drip') {
    // Stalactite nubs along the top and a wet streak below.
    for (let i = 0; i < 4; i++) {
      const cx = rand.range(10, FACE_W - 10)
      const len = rand.range(6, 14)
      for (let y = 0; y < len; y++) {
        const w = 4 * (1 - y / len)
        for (let dx = -w; dx <= w; dx++) blend(img, cx + dx, y, tint(PALETTE.wallRock, dx < 0 ? 1.3 : 0.9))
      }
      for (let y = len; y < FACE_H; y++) blend(img, cx + 0.5, y, [30, 36, 38], 0.35 * (1 - y / FACE_H))
    }
  }
  if (feature === 'mushrooms') mushrooms(img, seed + 16)
  if (feature === 'moss') moss(img, seed + 11, 0.3)
  faceLight(img, 1.15, 0.55)
  return img
}

/** Lashed logs: round poles side by side, bound with rope. */
function logs(img, seed, width = 16) {
  each(img, (x, y) => {
    const across = (x % width) / width
    const round = 0.62 + Math.sin(across * Math.PI) * 0.5
    const grain = fbm(x * 3, y * 0.25, 6, seed + Math.floor(x / width)) - 0.5
    blend(img, x, y, tint(PALETTE.log, round * (1 + grain * 0.5)))
  })
}

function ropeBand(img, y) {
  for (let x = 0; x < FACE_W; x++) {
    for (let dy = 0; dy < 5; dy++) {
      const twist = ((x + dy * 2) % 6) / 6
      blend(img, x, y + dy, tint(PALETTE.rope, 0.72 + twist * 0.45))
    }
  }
}

function doorLeaf(seed) {
  const img = newFace()
  logs(img, seed)
  ropeBand(img, 12)
  ropeBand(img, FACE_H - 18)
  rim(img, 3, 0.55)
  return img
}

/** Closed window: an animal hide stretched and stitched over a pole frame. */
function hideShutters(seed) {
  const img = newFace()
  planks(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, seed, PALETTE.log, { plank: 12 })
  each(img, (x, y) => {
    const inside = x > 7 && x < FACE_W - 7 && y > 6 && y < FACE_H - 6
    if (!inside) return
    const n = fbm(x, y, 20, seed + 3, 3) - 0.5
    blend(img, x, y, tint(PALETTE.hide, 1 + n * 0.45))
  })
  for (let x = 12; x < FACE_W - 8; x += 8) {
    fillRect(img, x, 5, 2, 4, PALETTE.rope)
    fillRect(img, x, FACE_H - 9, 2, 4, PALETTE.rope)
  }
  rim(img, 3, 0.55)
  return img
}

/** Open window: sharpened wooden stakes with a rope across. */
function stakes() {
  const img = newFace()
  bars(img, PALETTE.log, { spacing: 20, width: 7, rail: false })
  for (let y = FACE_H / 2 - 2; y < FACE_H / 2 + 2; y++) {
    for (let x = 0; x < FACE_W; x++) blend(img, x, y, tint(PALETTE.rope, 0.8 + ((x % 5) / 5) * 0.4))
  }
  return img
}

function foundation(seed) {
  const img = newFace()
  stoneField(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, PALETTE.wallRock, PALETTE.wallDark, seed, {
    min: 14,
    gap: 3,
    bevel: 3,
    grain: 0.3,
    crack: 0.2,
    corner: 5,
  })
  patches(img, seed + 5, 0.3, PALETTE.dirt, { scale: 18, max: 0.6 })
  return img
}

// ---------- Sheet ----------

const floorFeatures = [null, null, null, null, null, null, null, null, null, null, null, 'gravel', 'puddle', 'mushrooms', 'crack', 'moss']
const topFeatures = [null, null, null, null, null, null, null, null, null, 'moss', 'crystals', null]
const faceFeatures = [null, null, null, null, null, null, null, null, null, null, 'crystals', 'roots', 'drip', 'mushrooms', 'moss', null]

writeSheet('cave', {
  floors: floorFeatures.map((feature, i) =>
    floorTile(11100 + i * 17, { cell: 26 + (i % 4) * 5, tone: tones[i % tones.length], feature }),
  ),
  wallTops: topFeatures.map((feature, i) =>
    wallTop(12200 + i * 23, { cell: 36 + (i % 3) * 6, tone: tones[(i + 3) % tones.length], feature }),
  ),
  stairs: stairs(14400),
  walls: faceFeatures.map((feature, i) => strataFace(15500 + i * 29, { tone: tones[(i + 5) % tones.length], feature })),
  door: doorLeaf(16600),
  shutters: hideShutters(16700),
  open: stakes(),
  foundations: [0, 1, 2, 3].map((i) => foundation(17700 + i * 11)),
})
