// Paints the "manor" tileset: oak floorboards, papered walls over wood
// panelling, painted panel doors, louvred shutters and leaded glazing.

import { blend, fbm, fillRect, rng, shade, valueNoise } from './raster.mjs'
import {
  FACE_H,
  FACE_W,
  TOP,
  blockRim,
  bricks,
  disc,
  each,
  groutBand,
  mix,
  newFace,
  newTop,
  patches,
  rim,
  ring,
  steps,
  tint,
  tones,
  writeSheet,
} from './common.mjs'

const PALETTE = {
  oak: [140, 98, 62],
  oakGap: [58, 38, 24],
  plaster: [208, 196, 174],
  trim: [96, 62, 40],
  paper: [112, 46, 54],
  paperStripe: [96, 38, 46],
  damask: [168, 128, 78],
  panel: [104, 66, 42],
  brass: [206, 170, 96],
  gilt: [190, 150, 70],
  paint: [52, 66, 58],
  ashlar: [158, 150, 136],
  ashlarJoint: [96, 90, 82],
  carpet: [128, 30, 38],
  glass: [150, 180, 190],
  lead: [50, 50, 56],
  flame: [255, 210, 120],
}

// ---------- Tops ----------

/** Oak boards running across the tile, staggered butt joints and a nail at each end. */
function floorboards(seed, { board = 16, tone = 1, feature = null } = {}) {
  const img = newTop()
  const rand = rng(seed)
  for (let row = 0; row * board < TOP; row++) {
    const y0 = row * board
    let x = -rand.int(0, 60)
    while (x < TOP) {
      const len = rand.int(80, 170)
      const boardTone = tone * rand.range(0.86, 1.12)
      const grainSeed = seed + row * 53 + x
      for (let y = y0; y < y0 + board; y++) {
        for (let px = Math.max(0, x); px < Math.min(TOP, x + len); px++) {
          const g = fbm(px * 0.25, (y - y0) * 2.2, 6, grainSeed, 3) - 0.5
          const ring = Math.sin((y - y0) * 0.9 + fbm(px, y, 30, grainSeed + 1, 2) * 9) * 0.04
          let factor = boardTone * (1 + g * 0.3 + ring)
          if (y === y0) factor *= 1.12
          if (y >= y0 + board - 2) factor *= 0.7
          blend(img, px, y, tint(PALETTE.oak, factor))
        }
      }
      // The butt joint and its nails.
      if (x > 0) {
        fillRect(img, x, y0, 1, board, PALETTE.oakGap)
        blend(img, x + 3, y0 + 4, PALETTE.oakGap, 0.6)
        blend(img, x + 3, y0 + board - 5, PALETTE.oakGap, 0.6)
      }
      x += len
    }
    fillRect(img, 0, y0 + board - 1, TOP, 1, PALETTE.oakGap)
  }
  if (feature === 'knots') {
    for (let i = 0; i < 3; i++) {
      const cx = rand.range(12, TOP - 12)
      const cy = rand.range(8, TOP - 8)
      disc(img, cx, cy, 2.5, tint(PALETTE.oak, 0.5), 0.9)
      ring(img, cx, cy, 5, 3, tint(PALETTE.oak, 0.72), 0.08)
    }
  }
  if (feature === 'stain') patches(img, seed + 7, 0.25, [70, 28, 30], { scale: 26, max: 0.4, gain: 3 })
  if (feature === 'worn') {
    // Polish walked off down the middle.
    each(img, (x, y) => {
      const d = Math.hypot(x - TOP / 2, (y - TOP / 2) * 1.6) / (TOP / 2)
      if (d < 1) blend(img, x, y, [196, 168, 128], 0.18 * (1 - d))
    })
  }
  if (feature === 'rug') rugCorner(img, seed)
  groutBand(img, tint(PALETTE.oakGap, 1.1))
  return img
}

/** The fringed corner of a patterned rug that runs off under the next tile. */
function rugCorner(img, seed) {
  const x0 = 34
  const y0 = 30
  each(img, (x, y) => {
    if (x < x0 || y < y0) return
    const border = Math.min(x - x0, y - y0)
    let color = PALETTE.carpet
    if (border < 4) color = tint(PALETTE.carpet, 0.6)
    else if (border < 10) color = (x + y) % 8 < 4 ? PALETTE.gilt : tint(PALETTE.carpet, 0.75)
    else if (border < 13) color = tint(PALETTE.carpet, 0.6)
    const n = fbm(x, y, 3, seed, 1) - 0.5
    blend(img, x, y, tint(color, 1 + n * 0.18))
  })
  // Tassels along both edges and a soft shadow round the rug.
  for (let t = x0; t < TOP; t += 3) fillRect(img, t, y0 - 4, 1, 4, [220, 204, 170])
  for (let t = y0; t < TOP; t += 3) fillRect(img, x0 - 4, t, 4, 1, [220, 204, 170])
  for (let t = x0; t < TOP; t++) shade(img, t, y0 - 5, 0.8)
}

/** The top of an interior wall: a strip of plaster between moulded wooden cappings. */
function wallTop(seed, { tone = 1, feature = null } = {}) {
  const img = newTop()
  const rand = rng(seed)
  const plaster = tint(PALETTE.plaster, tone)
  each(img, (x, y) => {
    const n = fbm(x, y, 20, seed, 3) - 0.5
    blend(img, x, y, tint(plaster, 1 + n * 0.1))
  })
  // Moulded trim round the edge: dark wood with a lit bead.
  for (let i = 0; i < 14; i++) {
    const f = i < 2 ? 0.7 : i < 5 ? 1.15 : i < 10 ? 1 : i < 12 ? 0.8 : 0.6
    const color = tint(PALETTE.trim, f)
    for (let t = i; t < TOP - i; t++) {
      for (const [x, y] of [[t, i], [t, TOP - 1 - i], [i, t], [TOP - 1 - i, t]]) {
        const g = fbm(x * 0.4 + y * 0.4, i, 6, seed + 5, 2) - 0.5
        blend(img, x, y, tint(color, 1 + g * 0.25))
      }
    }
  }
  if (feature === 'crack') {
    let x = rand.range(40, 88)
    for (let y = 16; y < TOP - 16; y++) {
      shade(img, x, y, 0.7)
      x += rand.range(-1, 1)
    }
  }
  if (feature === 'dust') patches(img, seed + 9, 0.3, [150, 140, 124], { scale: 16, max: 0.3 })
  blockRim(img, 2, 0.6, 0.15)
  return img
}

/** Wooden stairs with a carpet runner held by brass rods. */
function stairs(seed) {
  const rand = rng(seed)
  return steps((img, r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = 0; x < TOP; x++) {
        const g = fbm(x * 0.25, y * 2, 6, seed + i * 17, 3) - 0.5
        const onRunner = x > 30 && x < TOP - 30
        const base = onRunner ? tint(PALETTE.carpet, 1 + (valueNoise(x, y, 2, seed) - 0.5) * 0.12) : tint(PALETTE.oak, 1 + g * 0.3)
        blend(img, x, y, tint(base, (1.04 - i * 0.03) * (y - r.y < 3 ? 1.15 : 1)))
        if (onRunner && (x < 36 || x > TOP - 37)) blend(img, x, y, PALETTE.gilt, 0.6)
      }
    }
    fillRect(img, 28, r.y + r.h - 7, TOP - 56, 2, PALETTE.brass)
    rand()
  })
}

// ---------- Faces ----------

const RAIL = 38
const BASE = 64

/**
 * Wallpaper above a dado rail, raised wooden panels below and a skirting
 * board at the foot. Stripes and panels repeat at widths that divide the
 * face, so neighbouring faces continue each other.
 */
function panelFace(seed, { tone = 1, feature = null } = {}) {
  const img = newFace()
  const rand = rng(seed)
  each(img, (x, y) => {
    if (y < RAIL) {
      const stripe = x % 16 < 8
      let color = stripe ? PALETTE.paper : PALETTE.paperStripe
      // A small diamond motif centred in every other stripe.
      const mx = (x % 16) - 4
      const my = (y % 14) - 7
      if (stripe && Math.abs(mx) + Math.abs(my) < 3.5) color = PALETTE.damask
      if (!stripe && x % 16 === 12 && y % 4 < 2) color = mix(PALETTE.paperStripe, PALETTE.damask, 0.5)
      const n = fbm(x, y, 24, seed, 2) - 0.5
      blend(img, x, y, tint(color, tone * (1 + n * 0.12)))
    } else if (y < RAIL + 5) {
      const f = [1.3, 1.1, 1, 0.8, 0.55][y - RAIL]
      blend(img, x, y, tint(PALETTE.trim, f))
    } else if (y < BASE) {
      // Raised panels, four to a face.
      const px = x % 32
      const py = y - RAIL - 5
      const ph = BASE - RAIL - 5
      const inPanel = px > 4 && px < 28 && py > 3 && py < ph - 3
      const g = fbm(x * 0.35, y * 2, 6, seed + 3, 3) - 0.5
      let f = tone * (1 + g * 0.25)
      if (inPanel) {
        if (px === 5 || py === 4) f *= 0.65
        else if (px === 27 || py === ph - 4) f *= 1.25
        else if (px < 8 || py < 7) f *= 1.12
      }
      blend(img, x, y, tint(PALETTE.panel, f))
    } else {
      const f = y === BASE ? 1.3 : y === BASE + 1 ? 0.7 : 0.82
      blend(img, x, y, tint(PALETTE.trim, f * (1 + (fbm(x * 0.3, y, 6, seed + 4) - 0.5) * 0.2)))
    }
  })
  if (feature === 'painting') {
    const w = 34
    const h = 24
    const x0 = Math.round(rand.range(12, FACE_W - w - 12))
    const y0 = 7
    for (let i = 0; i < 4; i++) {
      const f = [0.7, 1.25, 1, 0.8][i]
      for (let t = x0 + i; t < x0 + w - i; t++) {
        blend(img, t, y0 + i, tint(PALETTE.gilt, f))
        blend(img, t, y0 + h - 1 - i, tint(PALETTE.gilt, f * 0.85))
      }
      for (let t = y0 + i; t < y0 + h - i; t++) {
        blend(img, x0 + i, t, tint(PALETTE.gilt, f))
        blend(img, x0 + w - 1 - i, t, tint(PALETTE.gilt, f * 0.85))
      }
    }
    // A dim landscape: sky, hills, and a stormy wash.
    for (let y = y0 + 4; y < y0 + h - 4; y++) {
      for (let x = x0 + 4; x < x0 + w - 4; x++) {
        const hill = y0 + h - 10 + Math.sin((x - x0) * 0.25) * 2
        const color = y > hill ? [58, 72, 44] : mix([92, 108, 116], [150, 140, 110], (y - y0) / h)
        blend(img, x, y, tint(color, 1 + (fbm(x, y, 5, seed + 8) - 0.5) * 0.3))
      }
    }
    for (let x = x0 + 2; x < x0 + w + 2; x++) shade(img, x, y0 + h, 0.7)
  }
  if (feature === 'sconce') {
    const cx = Math.round(rand.range(30, FACE_W - 30))
    disc(img, cx, 12, 13, PALETTE.flame, 0.16, 10)
    fillRect(img, cx - 5, 22, 10, 3, PALETTE.brass)
    fillRect(img, cx - 1, 22, 2, 10, tint(PALETTE.brass, 0.8))
    fillRect(img, cx - 2, 14, 4, 8, [236, 228, 206])
    disc(img, cx, 11, 1.8, PALETTE.flame)
    disc(img, cx, 9.5, 1, [255, 250, 220])
  }
  if (feature === 'mirror') {
    const cx = Math.round(rand.range(26, FACE_W - 26))
    for (let y = 5; y < 34; y++) {
      for (let x = cx - 11; x <= cx + 11; x++) {
        const d = Math.hypot((x - cx) / 11, (y - 19.5) / 14.5)
        if (d > 1) continue
        if (d > 0.82) blend(img, x, y, tint(PALETTE.gilt, x < cx ? 1.2 : 0.85))
        else blend(img, x, y, mix([120, 136, 140], [190, 200, 200], (x - cx + y - 5) / 40 + 0.3))
      }
    }
  }
  if (feature === 'peeling') {
    // A torn flap of paper showing plaster beneath.
    const x0 = rand.range(20, FACE_W - 40)
    each(img, (x, y) => {
      if (y > RAIL - 2) return
      const d = Math.hypot((x - x0 - 10) / 14, (y - 8) / 10) + (fbm(x, y, 5, seed + 6, 2) - 0.5) * 0.6
      if (d < 1) blend(img, x, y, tint(PALETTE.plaster, 0.85 + (fbm(x, y, 8, seed) - 0.5) * 0.2))
      else if (d < 1.12) shade(img, x, y, 0.7)
    })
  }
  if (feature === 'damp') patches(img, seed + 5, 0.3, [60, 50, 40], { scale: 20, max: 0.35 })
  // The ceiling's shadow on the paper and the floor's on the skirting.
  for (let x = 0; x < FACE_W; x++) {
    for (let y = 0; y < 4; y++) shade(img, x, y, 0.7 + y * 0.08)
    for (let y = 0; y < 3; y++) shade(img, x, FACE_H - 1 - y, 0.6 + y * 0.12)
  }
  return img
}

/** A six-panel painted door with a brass knob and escutcheon. */
function doorLeaf(seed) {
  const img = newFace()
  const cols = [[8, 60], [68, 120]]
  const rows = [[6, 24], [28, 46], [50, 66]]
  each(img, (x, y) => {
    let f = 1 + (fbm(x * 0.4, y * 1.5, 8, seed, 3) - 0.5) * 0.12
    for (const [cx0, cx1] of cols) {
      for (const [ry0, ry1] of rows) {
        if (x < cx0 || x > cx1 || y < ry0 || y > ry1) continue
        if (x === cx0 || y === ry0) f *= 0.6
        else if (x === cx1 || y === ry1) f *= 1.3
        else if (x < cx0 + 4 || y < ry0 + 4) f *= 1.1
        else if (x > cx1 - 4 || y > ry1 - 4) f *= 0.88
      }
    }
    blend(img, x, y, tint(PALETTE.paint, f))
  })
  fillRect(img, 106, 32, 6, 12, tint(PALETTE.brass, 0.8))
  disc(img, 109, 37, 3.2, PALETTE.brass)
  disc(img, 108, 36, 1.2, [255, 240, 200])
  rim(img, 3, 0.55)
  return img
}

/** Closed window: louvred shutters, slats catching light on their upper edge. */
function louvres(seed) {
  const img = newFace()
  each(img, (x, y) => {
    const stile = x % 64 < 6 || x % 64 > 57 || y < 5 || y > FACE_H - 6
    const slat = (y - 5) % 6
    let f = 1 + (fbm(x * 0.4, y, 8, seed, 2) - 0.5) * 0.14
    if (!stile) f *= slat === 0 ? 1.3 : slat < 3 ? 1.05 : slat === 5 ? 0.55 : 0.85
    blend(img, x, y, tint(PALETTE.paint, f))
  })
  fillRect(img, FACE_W / 2 - 1, 0, 2, FACE_H, tint(PALETTE.paint, 0.5))
  rim(img, 3, 0.6)
  return img
}

/** Open window: leaded diamond panes in a wooden frame, the glass barely there. */
function leadedGlass() {
  const img = newFace()
  each(img, (x, y) => {
    const frame = x < 6 || x > FACE_W - 7 || y < 5 || y > FACE_H - 6 || Math.abs(x - FACE_W / 2) < 3
    if (frame) {
      blend(img, x, y, tint(PALETTE.trim, x < 6 || y < 5 ? 1.15 : 0.9))
      return
    }
    const u = (x + y) % 18
    const v = (x - y + 180) % 18
    if (u < 1.5 || v < 1.5) blend(img, x, y, PALETTE.lead)
    else blend(img, x, y, mix(PALETTE.glass, [230, 240, 240], (u + v) / 40), 0.12)
  })
  return img
}

/** Dressed ashlar: long, tidy blocks with fine joints. */
function foundation(seed) {
  const img = newFace()
  bricks(img, seed, PALETTE.ashlar, PALETTE.ashlarJoint, { course: 24, short: 40, long: 64, crack: 0.05, grain: 0.1, bevel: 2 })
  return img
}

// ---------- Sheet ----------

const floorFeatures = [null, null, null, null, null, null, null, null, null, null, null, null, 'knots', 'stain', 'worn', 'rug']
const topFeatures = [null, null, null, null, null, null, null, null, null, null, 'crack', 'dust']
const faceFeatures = [null, null, null, null, null, null, null, null, null, null, 'painting', 'sconce', 'mirror', 'peeling', 'damp', 'sconce']

writeSheet('manor', {
  floors: floorFeatures.map((feature, i) =>
    floorboards(21100 + i * 17, { board: [16, 16, 14, 18][i % 4], tone: tones[i % tones.length], feature }),
  ),
  wallTops: topFeatures.map((feature, i) => wallTop(22200 + i * 23, { tone: tones[(i + 3) % tones.length], feature })),
  stairs: stairs(24400),
  walls: faceFeatures.map((feature, i) =>
    panelFace(25500 + i * 29, { tone: 1 + (tones[(i + 5) % tones.length] - 1) * 0.5, feature }),
  ),
  door: doorLeaf(26600),
  shutters: louvres(26700),
  open: leadedGlass(),
  foundations: [0, 1, 2, 3].map((i) => foundation(27700 + i * 11)),
})
