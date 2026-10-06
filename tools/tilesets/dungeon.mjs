// Paints the "dungeon" tileset: worn flagstones, grey stone-brick walls,
// plank doors, shuttered windows and iron bars. Run with `npm run tiles`.

import { blend, fbm, fillRect, rng, shade } from './raster.mjs'
import {
  FACE_H,
  FACE_W,
  TOP,
  bars,
  blockRim,
  bricks,
  faceLight,
  grime,
  groutBand,
  innerBrick,
  ironBand,
  longCrack,
  moss,
  newFace,
  newTop,
  pairLeaves,
  planks,
  rim,
  ring,
  steps,
  stone,
  stoneField,
  tint,
  tones,
  writeSheet,
} from './common.mjs'

const PALETTE = {
  floor: [124, 112, 96],
  floorGrout: [46, 42, 38],
  wallTop: [92, 92, 100],
  wallTopRim: [52, 52, 58],
  brick: [98, 98, 108],
  mortar: [44, 43, 48],
  wood: [118, 76, 42],
  woodDark: [74, 46, 24],
  iron: [46, 46, 52],
  dark: [12, 12, 16],
  rubble: [70, 68, 72],
}

// ---------- Tops ----------

function floorTile(seed, { min = 42, tone = 1 } = {}) {
  const img = newTop()
  const base = tint(PALETTE.floor, tone)
  // Muted stones with soft inner seams, so the texture never competes with the grid.
  stoneField(img, { x: 0, y: 0, w: TOP, h: TOP }, base, tint(base, 0.76), seed, {
    min,
    gap: 2,
    grain: 0.07,
    light: 1.05,
    dark: 0.9,
    crack: 0.12,
    corner: 2,
  })
  grime(img, seed + 3, 0.12)
  groutBand(img, PALETTE.floorGrout)
  return img
}

function wallTop(seed, { min = 44, tone = 1, feature = null } = {}) {
  const img = newTop()
  stoneField(img, { x: 0, y: 0, w: TOP, h: TOP }, tint(PALETTE.wallTop, tone), PALETTE.wallTopRim, seed, {
    min,
    gap: 4,
    bevel: 5,
    grain: 0.12,
    crack: 0.4,
  })
  if (feature === 'moss') moss(img, seed + 11, 0.25)
  if (feature === 'crack') longCrack(img, seed + 12)
  blockRim(img)
  return img
}

function stairs(seed) {
  const rand = rng(seed)
  return steps((img, r, i) =>
    stone(img, r, tint(PALETTE.floor, 1.05 - i * 0.04), rand, seed + i, { bevel: 3, crack: 0.2, corner: 0 }),
  )
}

/** A step's top: one long worn slab, a touch lighter than the floor around it. */
function tread(seed) {
  const img = newTop()
  const base = tint(PALETTE.floor, 1.1)
  stoneField(img, { x: 0, y: 0, w: TOP, h: TOP }, base, tint(base, 0.78), seed, {
    min: 120,
    gap: 2,
    grain: 0.08,
    light: 1.06,
    dark: 0.9,
    crack: 0.1,
    corner: 2,
  })
  grime(img, seed + 3, 0.08)
  return img
}

// ---------- Faces ----------

function brickFace(seed, { tone = 1, short = 30, long = 46, feature = null } = {}) {
  const img = newFace()
  const rand = rng(seed)
  const laid = bricks(img, seed, tint(PALETTE.brick, tone), PALETTE.mortar, { short, long, rand })
  if (feature === 'missing') {
    // One brick fallen out, leaving a dark socket.
    const gone = innerBrick(laid, rand, img)
    fillRect(img, gone.x - 1, gone.y - 1, gone.w + 2, gone.h + 2, PALETTE.dark)
    fillRect(img, gone.x - 1, gone.y - 1, gone.w + 2, 3, tint(PALETTE.mortar, 0.7))
  }
  if (feature === 'moss') {
    // Damp streaks running down from the top.
    for (let x = 0; x < FACE_W; x++) {
      const reach = fbm(x, 0, 14, seed + 5, 2) * FACE_H * 1.1 - 12
      for (let y = 0; y < reach; y++) blend(img, x, y, [70, 92, 50], 0.4 * (1 - y / Math.max(1, reach)))
    }
  }
  if (feature === 'crack') longCrack(img, seed + 12)
  if (feature === 'shackle') {
    // An iron ring and chain stub bolted to the wall.
    const cx = FACE_W / 2 + rand.range(-20, 20)
    fillRect(img, cx - 3, 20, 6, 6, PALETTE.iron)
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      blend(img, cx + Math.cos(a) * 6, 34 + Math.sin(a) * 7, PALETTE.iron)
      blend(img, cx + Math.cos(a) * 6 + 1, 34 + Math.sin(a) * 7, tint(PALETTE.iron, 1.6))
    }
    for (let y = 44; y < 52; y += 3) fillRect(img, cx - 1, y, 3, 2, PALETTE.iron)
  }
  faceLight(img)
  return img
}

/** The door itself: iron-bound planks, standing in the doorway between the jambs. */
function doorLeaf(seed) {
  const img = newFace()
  planks(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, seed, PALETTE.wood)
  ironBand(img, 0, 12, FACE_W, PALETTE.iron)
  ironBand(img, 0, FACE_H - 18, FACE_W, PALETTE.iron)
  ring(img, FACE_W - 22, FACE_H / 2 + 3, 5, 5, [196, 176, 128])
  rim(img, 3, 0.6)
  return img
}

/** Closed window: a pair of plank shutters with a strap across. */
function windowShutters(seed, w = FACE_W) {
  const img = newFace(w)
  planks(img, { x: 0, y: 0, w, h: FACE_H }, seed, PALETTE.wood)
  fillRect(img, w / 2 - 2, 0, 4, FACE_H, PALETTE.woodDark)
  ironBand(img, 0, FACE_H / 2 - 2, w, PALETTE.iron)
  rim(img, 3, 0.6)
  return img
}

function windowBars() {
  const img = newFace()
  bars(img, PALETTE.iron)
  return img
}

/** A step's face: one course of dressed stone. */
function riser(seed) {
  return brickFace(seed, { tone: 0.96, short: 40, long: 60 })
}

/** The shaft of a stair going down: older brick, damp and darker. */
function shaft(seed) {
  const img = brickFace(seed, { tone: 0.68, feature: 'moss' })
  grime(img, seed + 7, 0.2)
  return img
}

function foundation(seed) {
  const img = newFace()
  stoneField(img, { x: 0, y: 0, w: FACE_W, h: FACE_H }, PALETTE.rubble, PALETTE.mortar, seed, {
    min: 16,
    gap: 3,
    bevel: 2,
    grain: 0.26,
    crack: 0.15,
  })
  return img
}

// ---------- Sheet ----------

const topFeatures = [null, null, null, null, null, null, null, null, null, null, 'moss', 'crack']
const faceFeatures = [null, null, null, null, null, null, null, null, null, null, null, 'missing', 'moss', 'crack', 'shackle', null]

writeSheet('dungeon', {
  floors: Array.from({ length: 16 }, (_, i) =>
    floorTile(1100 + i * 17, { min: 36 + (i % 4) * 5, tone: tones[i % tones.length] }),
  ),
  wallTops: topFeatures.map((feature, i) =>
    wallTop(2200 + i * 23, { min: 40 + (i % 3) * 6, tone: tones[(i + 3) % tones.length], feature }),
  ),
  stairs: stairs(4400),
  stairParts: { tread: tread(4410), riser: riser(4420), shaft: shaft(4430) },
  walls: faceFeatures.map((feature, i) =>
    brickFace(5500 + i * 29, {
      tone: tones[(i + 5) % tones.length],
      short: 26 + (i % 3) * 4,
      long: 42 + (i % 4) * 4,
      feature,
    }),
  ),
  door: doorLeaf(6600),
  shutters: windowShutters(6700),
  open: windowBars(),
  foundations: [0, 1, 2, 3].map((i) => foundation(7700 + i * 11)),
  doubleDoor: pairLeaves(doorLeaf(6600), doorLeaf(6650)),
  doubleShutters: windowShutters(6700, FACE_W * 2),
})
