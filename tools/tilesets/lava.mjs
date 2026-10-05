// Paints the "lava" tileset: cracked basalt glowing from beneath, volcanic
// brick set in molten mortar, riveted iron doors and red-hot bars.

import { blend, fbm, fillRect, rng, shade } from './raster.mjs'
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
  pebbles,
  rim,
  slabField,
  steps,
  stoneField,
  tint,
  tones,
  writeSheet,
} from './common.mjs'

const PALETTE = {
  basalt: [66, 58, 56],
  basaltDark: [30, 26, 26],
  wallTop: [52, 46, 46],
  brick: [70, 60, 58],
  lava: [236, 96, 24],
  lavaHot: [255, 200, 80],
  ember: [150, 40, 14],
  crust: [44, 30, 26],
  soot: [16, 12, 12],
  obsidian: [30, 26, 40],
  iron: [58, 50, 50],
}

/** Lava colour by heat, 0 = dull ember, 1 = white-hot. */
const heat = (t) => (t < 0.5 ? mix(PALETTE.ember, PALETTE.lava, t * 2) : mix(PALETTE.lava, PALETTE.lavaHot, (t - 0.5) * 2))

/** Seams that glow: hottest at the centre, with a warm halo spilling onto the rock. */
function glowSeams(img, seed, { cell, base, seamWidth = 2, glow = 1, halo = 5, grain = 0.18, dome = 0.2, cooled = 0.3 }) {
  // Some stretches of seam have crusted over; 0 = cold, 1 = molten.
  const live = (x, y) => Math.min(1, Math.max(0, (fbm(x, y, 40, seed + 11, 2) - cooled) * 3))
  slabField(img, seed, {
    cell,
    base,
    seamWidth,
    grain,
    dome,
    seam: (x, y, t) => {
      const flicker = fbm(x, y, 10, seed + 9, 2)
      blend(img, x, y, PALETTE.crust)
      blend(img, x, y, heat(Math.max(0, (1 - t) * glow * (0.55 + flicker * 0.6))), live(x, y))
    },
    near: (x, y, d) => {
      if (d < halo) blend(img, x, y, PALETTE.lava, 0.45 * glow * live(x, y) * (1 - d / halo) ** 2)
    },
  })
}

// ---------- Features ----------

/** A pool of lava with a dark cooling crust round its rim. */
function lavaPool(img, seed) {
  const cx = TOP / 2
  const cy = TOP / 2
  each(img, (x, y) => {
    const d = Math.hypot((x - cx) / 40, (y - cy) / 32) + (fbm(x, y, 18, seed, 2) - 0.5) * 0.45
    if (d < 0.8) {
      const swirl = fbm(x + y * 0.5, y, 9, seed + 3, 3)
      blend(img, x, y, heat(0.45 + swirl * 0.6 - d * 0.3))
      // Floating crust plates.
      if (fbm(x, y, 7, seed + 4, 2) > 0.66) blend(img, x, y, PALETTE.crust, 0.85)
    } else if (d < 1) blend(img, x, y, mix(PALETTE.crust, PALETTE.ember, (1 - d) * 2.5))
    else if (d < 1.3) blend(img, x, y, PALETTE.lava, 0.3 * (1.3 - d) / 0.3)
  })
}

function embers(img, seed, count) {
  const rand = rng(seed)
  for (let i = 0; i < count; i++) {
    const x = rand.range(8, TOP - 8)
    const y = rand.range(8, TOP - 8)
    disc(img, x, y, 3, PALETTE.lava, 0.2, 3)
    disc(img, x, y, rand.range(0.6, 1.4), heat(rand.range(0.6, 1)))
  }
}

/** Glassy black shards with a sharp highlight. */
function obsidian(img, seed) {
  const rand = rng(seed)
  for (let i = 0; i < 5; i++) {
    const cx = rand.range(20, TOP - 20)
    const cy = rand.range(20, TOP - 20)
    const r = rand.range(5, 10)
    const a = rand.range(0, Math.PI)
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const u = x * Math.cos(a) + y * Math.sin(a)
        const v = -x * Math.sin(a) + y * Math.cos(a)
        if (Math.abs(u) / r + Math.abs(v) / (r * 0.45) > 1) continue
        blend(img, cx + x, cy + y, tint(PALETTE.obsidian, v < 0 ? 1.8 : 0.9))
        if (Math.abs(v) < 0.8 && u < 0) blend(img, cx + x, cy + y, [200, 190, 230], 0.6)
      }
    }
    for (let x = -r; x <= r; x++) shade(img, cx + x + 2, cy + r * 0.5 + 2, 0.6)
  }
}

// ---------- Tops ----------

function floorTile(seed, { cell = 34, tone = 1, glow = 0.8, cooled = 0.4, feature = null } = {}) {
  const img = newTop()
  glowSeams(img, seed, { cell, base: tint(PALETTE.basalt, tone), glow, cooled, seamWidth: 1.5, halo: 4, grain: 0.14, dome: 0.12 })
  patches(img, seed + 5, 0.25, PALETTE.soot, { scale: 28, max: 0.45 })
  pebbles(img, seed + 13, 3, PALETTE.basalt, [1, 3])
  if (feature === 'pool') lavaPool(img, seed + 15)
  if (feature === 'embers') embers(img, seed + 16, 9)
  if (feature === 'obsidian') obsidian(img, seed + 17)
  if (feature === 'crack') longCrack(img, seed + 12, PALETTE.lavaHot)
  groutBand(img, PALETTE.basaltDark)
  return img
}

function wallTop(seed, { min = 44, tone = 1, feature = null } = {}) {
  const img = newTop()
  stoneField(img, { x: 0, y: 0, w: TOP, h: TOP }, tint(PALETTE.wallTop, tone), PALETTE.ember, seed, {
    min,
    gap: 4,
    bevel: 5,
    grain: 0.16,
    crack: 0.3,
  })
  if (feature === 'soot') patches(img, seed + 5, 0.4, PALETTE.soot, { scale: 24, max: 0.7 })
  if (feature === 'crack') longCrack(img, seed + 12, PALETTE.lava)
  if (feature === 'embers') embers(img, seed + 16, 6)
  blockRim(img)
  return img
}

/** Basalt steps with lava glowing up through the gap under each nosing. */
function stairs(seed) {
  const rock = newTop()
  glowSeams(rock, seed, { cell: 28, base: PALETTE.basalt, glow: 0.5, seamWidth: 1.2, halo: 3, cooled: 0 })
  const img = steps((out, r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = 0; x < TOP; x++) {
        const at = (y * TOP + x) * 4
        const lip = y - r.y < 3 ? 1.15 : 1
        blend(out, x, y, tint([rock.data[at], rock.data[at + 1], rock.data[at + 2]], (1.05 - i * 0.05) * lip))
      }
    }
  })
  for (let i = 1; i < 5; i++) {
    const y = Math.round((i * TOP) / 5)
    for (let x = 0; x < TOP; x++) {
      blend(img, x, y - 1, heat(0.5 + fbm(x, i, 8, seed, 2) * 0.5))
      blend(img, x, y - 2, PALETTE.lava, 0.4)
    }
  }
  return img
}

// ---------- Faces ----------

/** Volcanic brick bedded in mortar that still glows, with heat rising from the foot. */
function brickFace(seed, { tone = 1, short = 30, long = 46, feature = null } = {}) {
  const img = newFace()
  const rand = rng(seed)
  // Glowing mortar, brighter towards the bottom where it's hottest.
  const mortar = newFace()
  each(mortar, (x, y) => blend(mortar, x, y, heat(0.05 + (y / FACE_H) * 0.4 + (fbm(x, y, 10, seed, 2) - 0.5) * 0.4)))
  const laid = bricks(img, seed, tint(PALETTE.brick, tone), PALETTE.ember, { short, long, rand })
  each(img, (x, y) => {
    const at = (y * FACE_W + x) * 4
    const d = img.data
    // Where only mortar shows (bricks paint over it), swap in the glow.
    if (d[at] === PALETTE.ember[0] && d[at + 1] === PALETTE.ember[1] && d[at + 2] === PALETTE.ember[2]) {
      d[at] = mortar.data[at]
      d[at + 1] = mortar.data[at + 1]
      d[at + 2] = mortar.data[at + 2]
    }
  })
  if (feature === 'vent') {
    // A brick burnt out, leaving a glowing hole.
    const gone = innerBrick(laid, rand, img)
    disc(img, gone.x + gone.w / 2, gone.y + gone.h / 2, gone.w / 2 + 6, PALETTE.lava, 0.3, 6)
    fillRect(img, gone.x - 1, gone.y - 1, gone.w + 2, gone.h + 2, PALETTE.lava)
    fillRect(img, gone.x + 2, gone.y + 2, gone.w - 4, gone.h - 4, PALETTE.lavaHot)
    fillRect(img, gone.x - 1, gone.y - 1, gone.w + 2, 3, PALETTE.ember)
  }
  if (feature === 'lavafall') {
    // A thin stream of lava oozing down from the top.
    let x = rand.range(30, FACE_W - 30)
    for (let y = 0; y < FACE_H; y++) {
      const w = 3 + Math.sin(y * 0.3) * 0.8 + y * 0.04
      for (let dx = -w - 4; dx <= w + 4; dx++) {
        if (Math.abs(dx) <= w) blend(img, x + dx, y, heat(0.9 - Math.abs(dx) / w * 0.5))
        else blend(img, x + dx, y, PALETTE.lava, 0.25 * (1 - (Math.abs(dx) - w) / 4))
      }
      x += rand.range(-0.4, 0.4)
    }
  }
  if (feature === 'soot') {
    // Scorch marks licking up the face.
    for (let x = 0; x < FACE_W; x++) {
      const reach = FACE_H - fbm(x, 0, 12, seed + 5, 2) * FACE_H * 1.2
      for (let y = Math.max(0, Math.floor(reach)); y < FACE_H; y++) blend(img, x, y, PALETTE.soot, 0.55 * ((y - reach) / (FACE_H - reach)))
    }
  }
  if (feature === 'crack') longCrack(img, seed + 12, PALETTE.lavaHot)
  faceLight(img, 1.15, 0.85)
  // Heat glow from the floor.
  for (let x = 0; x < FACE_W; x++) for (let y = 0; y < 14; y++) blend(img, x, FACE_H - 1 - y, PALETTE.lava, 0.22 * (1 - y / 14))
  return img
}

/** A riveted iron door, its lower edge heat-tinted. */
function doorLeaf(seed) {
  const img = newFace()
  each(img, (x, y) => {
    const n = fbm(x, y, 16, seed, 3) - 0.5
    blend(img, x, y, tint(PALETTE.iron, 1 + n * 0.3))
  })
  for (const x of [0, 42, 85]) fillRect(img, x + 41, 0, 2, FACE_H, tint(PALETTE.iron, 0.55))
  ironBand(img, 0, 10, FACE_W, tint(PALETTE.iron, 0.8), 5)
  ironBand(img, 0, FACE_H - 16, FACE_W, tint(PALETTE.iron, 0.8), 5)
  for (let y = FACE_H - 14; y < FACE_H; y++) {
    for (let x = 0; x < FACE_W; x++) blend(img, x, y, PALETTE.lava, 0.35 * ((y - FACE_H + 14) / 14) ** 2)
  }
  disc(img, FACE_W - 22, FACE_H / 2 + 2, 4, tint(PALETTE.iron, 1.5))
  disc(img, FACE_W - 23, FACE_H / 2 + 1, 1.5, tint(PALETTE.iron, 2.4))
  rim(img, 3, 0.55)
  return img
}

/** Closed window: iron shutters with glowing slits. */
function ironShutters(seed) {
  const img = newFace()
  each(img, (x, y) => blend(img, x, y, tint(PALETTE.iron, 1 + (fbm(x, y, 16, seed, 3) - 0.5) * 0.3)))
  fillRect(img, FACE_W / 2 - 1, 0, 2, FACE_H, tint(PALETTE.iron, 0.5))
  for (const cx of [FACE_W / 4, (FACE_W * 3) / 4]) {
    for (const cy of [22, 44]) {
      fillRect(img, cx - 14, cy - 2, 28, 5, tint(PALETTE.iron, 0.4))
      fillRect(img, cx - 13, cy, 26, 2, PALETTE.lava)
      disc(img, cx, cy + 1, 10, PALETTE.lava, 0.12, 6)
    }
  }
  rim(img, 3, 0.55)
  return img
}

/** Open window: iron bars glowing red where the heat reaches them. */
function hotBars() {
  const img = newFace()
  bars(img, PALETTE.iron)
  each(img, (x, y) => {
    const at = (y * FACE_W + x) * 4
    if (img.data[at + 3] > 0) blend(img, x, y, heat(0.2 + (y / FACE_H) * 0.3), (y / FACE_H) ** 2 * 0.8)
  })
  return img
}

/** A step's top: a cooled basalt slab, only faintly glowing at its seams. */
function tread(seed) {
  return floorTile(seed, { cell: 64, tone: 1.05, glow: 0.3, cooled: 0.7 })
}

/** A step's face: basalt block. */
function riser(seed) {
  return brickFace(seed, { tone: 0.92, short: 40, long: 60 })
}

/** The shaft of a stair going down: dark rock, lit red by the heat below. */
function shaft(seed) {
  const img = brickFace(seed, { tone: 0.6 })
  for (let y = 0; y < FACE_H; y++) {
    const heatUp = (y / FACE_H) ** 2
    for (let x = 0; x < FACE_W; x++) blend(img, x, y, PALETTE.lava, 0.32 * heatUp)
  }
  return img
}

function foundation(seed) {
  const img = newFace()
  stoneField(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, PALETTE.obsidian, PALETTE.ember, seed, {
    min: 16,
    gap: 3,
    bevel: 2,
    grain: 0.3,
    crack: 0.15,
    light: 1.5,
  })
  return img
}

// ---------- Sheet ----------

const floorFeatures = [null, null, null, null, null, null, null, null, null, null, null, 'embers', 'pool', 'obsidian', 'crack', 'embers']
const topFeatures = [null, null, null, null, null, null, null, null, null, 'soot', 'crack', 'embers']
const faceFeatures = [null, null, null, null, null, null, null, null, null, null, null, 'vent', 'lavafall', 'soot', 'crack', 'soot']

writeSheet('lava', {
  floors: floorFeatures.map((feature, i) =>
    floorTile(31100 + i * 17, { cell: 36 + (i % 4) * 5, tone: tones[i % tones.length], glow: 0.45 + (i % 3) * 0.2, cooled: 0.35 + (i % 4) * 0.05, feature }),
  ),
  wallTops: topFeatures.map((feature, i) =>
    wallTop(32200 + i * 23, { min: 40 + (i % 3) * 6, tone: tones[(i + 3) % tones.length], feature }),
  ),
  stairs: stairs(34400),
  stairParts: { tread: tread(34410), riser: riser(34420), shaft: shaft(34430) },
  walls: faceFeatures.map((feature, i) =>
    brickFace(35500 + i * 29, {
      tone: tones[(i + 5) % tones.length],
      short: 26 + (i % 3) * 4,
      long: 42 + (i % 4) * 4,
      feature,
    }),
  ),
  door: doorLeaf(36600),
  shutters: ironShutters(36700),
  open: hotBars(),
  foundations: [0, 1, 2, 3].map((i) => foundation(37700 + i * 11)),
})
