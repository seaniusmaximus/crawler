import { objectDef, type ObjectDef, type ObjectPart } from '../objects/catalog.ts'
import { objectFootprint, objectHover, objectScale, turnPoint, type ObjectPose } from '../model/objects.ts'
import { cellKey } from '../model/tiles.ts'
import type { Camera, CellRect, Room } from '../model/types.ts'
import {
  LEVEL_HEIGHT,
  TILE_HEIGHT,
  TILE_WIDTH,
  cellToScreen,
  unorient,
  isoDepth,
  lift,
  liftCorners,
  rectCorners,
  roomLift,
  type IsoCorners,
  type Point,
} from './camera.ts'

/**
 * One shape of an object, placed on the map in grid coordinates. A box is cut
 * at cell lines into one piece per cell, so each piece can be painted in turn
 * with the walls and floors around it; rugs and shadows are clipped to each
 * cell instead. `lift` is how many steps above its room's floor the piece's
 * object floats.
 */
export type ObjectPiece = (
  | { shape: 'box'; x0: number; y0: number; x1: number; y1: number; z: number; h: number; color: string; top: string }
  | { shape: 'round'; x: number; y: number; r: number; r2: number; z: number; h: number; color: string; top: string }
  | {
      shape: 'flat'
      x0: number
      y0: number
      x1: number
      y1: number
      color: string
      border: string | undefined
      /** The cell this copy is clipped to. */
      clip: CellRect
    }
  /** The shadow an object casts on the floor: its shapes seen from above, darkened as one. */
  | { shape: 'shadow'; marks: readonly ShadowMark[]; opacity: number; clip: CellRect }
) & { lift: number }

/** One shape of a shadow, in grid coordinates on the floor. */
type ShadowMark = { x0: number; y0: number; x1: number; y1: number } | { x: number; y: number; r: number }

/** How objects take light: the tileset's falloff on the two faces the camera sees, and greyed when out of sight. */
export interface ObjectLight {
  left: number
  right: number
  fog: boolean
}

/** A rug's border band, in cells. */
const BORDER = 0.07

/** How dark the shadow under an object is: a faint one where it stands, darker when it floats. */
const SHADOW_STANDING = 0.3
const SHADOW_FLOATING = 0.3
/** How far a shadow spreads past what casts it, in cells. */
const SHADOW_SPREAD = 0.04
/** How far a shadow falls per pixel of height above the floor, in cells, and the most it ever falls. */
const SHADOW_FALL = 0.016
const SHADOW_REACH = 0.8
/** Spacing of the copies a shadow is swept out of, in cells. */
const SHADOW_STEP = 0.06

/**
 * Every piece of an object where `pose` puts it, placed, scaled and turned,
 * each with the cell it paints with. Anything that stands up casts a shadow
 * on the floor, so it sits in the room rather than on top of the picture.
 */
export function placedPieces(pose: ObjectPose, yaw: Camera['yaw'] = 0): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  const def = objectDef(pose.kind)
  const scale = objectScale(pose)
  const lift = objectHover(pose)
  const size = { w: def.w * scale, d: def.d * scale }
  const out: { cellX: number; cellY: number; piece: ObjectPiece }[] = []
  const marks = shadowMarks(def.parts, size, pose, scale, lift, yaw)
  if (marks.length > 0) {
    // A shadow can fall past the footprint; cells that aren't this room's floor never draw it.
    const rect = marksBounds(marks)
    const opacity = lift > 0 ? SHADOW_FLOATING : SHADOW_STANDING
    for (let cy = rect.minY; cy <= rect.maxY; cy++) {
      for (let cx = rect.minX; cx <= rect.maxX; cx++) {
        const clip = { minX: cx, minY: cy, maxX: cx, maxY: cy }
        out.push({ cellX: cx, cellY: cy, piece: { shape: 'shadow', marks, opacity, clip, lift: 0 } })
      }
    }
  }
  for (const part of def.parts) {
    for (const piece of placePart(size, part, pose.x, pose.y, pose.turn, scale, lift)) out.push(piece)
  }
  return out
}

/**
 * The plan of every part that stands up, swept toward the lower left of the
 * screen (away from the light that shades the faces) by how high it reaches,
 * so taller things throw longer shadows.
 */
function shadowMarks(
  parts: readonly ObjectPart[],
  size: { w: number; d: number },
  pose: ObjectPose,
  scale: number,
  lift: number,
  yaw: Camera['yaw'],
): ShadowMark[] {
  // Straight down the screen in view space is (0, 1); this is that on the grid.
  const away = unorient(0, 1, yaw)
  const marks: ShadowMark[] = []
  for (const part of parts) {
    if (part.shape === 'flat') continue
    const bottom = lift * LEVEL_HEIGHT + part.z * scale
    const near = Math.min(SHADOW_REACH, bottom * SHADOW_FALL)
    const far = Math.min(SHADOW_REACH, (bottom + part.h * scale) * SHADOW_FALL)
    const copies = Math.max(1, Math.ceil((far - near) / SHADOW_STEP) + 1)
    let mark: ShadowMark
    if (part.shape === 'round') {
      const at = turnPoint(size, pose.turn, part.x * scale, part.y * scale)
      const r = Math.max(part.r, part.r2 ?? part.r) * scale
      mark = { x: pose.x + at.x, y: pose.y + at.y, r: r + SHADOW_SPREAD }
    } else {
      const a = turnPoint(size, pose.turn, part.x * scale, part.y * scale)
      const b = turnPoint(size, pose.turn, (part.x + part.w) * scale, (part.y + part.d) * scale)
      mark = {
        x0: pose.x + Math.min(a.x, b.x) - SHADOW_SPREAD,
        y0: pose.y + Math.min(a.y, b.y) - SHADOW_SPREAD,
        x1: pose.x + Math.max(a.x, b.x) + SHADOW_SPREAD,
        y1: pose.y + Math.max(a.y, b.y) + SHADOW_SPREAD,
      }
    }
    for (let i = 0; i < copies; i++) {
      const fall = copies === 1 ? near : near + ((far - near) * i) / (copies - 1)
      marks.push(shiftMark(mark, away.x * fall, away.y * fall))
    }
  }
  return marks
}

function shiftMark(mark: ShadowMark, dx: number, dy: number): ShadowMark {
  if ('r' in mark) return { x: mark.x + dx, y: mark.y + dy, r: mark.r }
  return { x0: mark.x0 + dx, y0: mark.y0 + dy, x1: mark.x1 + dx, y1: mark.y1 + dy }
}

/** The cells a shadow touches. */
function marksBounds(marks: readonly ShadowMark[]): CellRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const mark of marks) {
    const box = 'r' in mark ? { x0: mark.x - mark.r, y0: mark.y - mark.r, x1: mark.x + mark.r, y1: mark.y + mark.r } : mark
    minX = Math.min(minX, box.x0)
    minY = Math.min(minY, box.y0)
    maxX = Math.max(maxX, box.x1)
    maxY = Math.max(maxY, box.y1)
  }
  return { minX: Math.floor(minX), minY: Math.floor(minY), maxX: Math.ceil(maxX) - 1, maxY: Math.ceil(maxY) - 1 }
}

/** `size` is the footprint once scaled, before turning; the part's own numbers are scaled here. */
function placePart(
  size: { w: number; d: number },
  part: ObjectPart,
  ox: number,
  oy: number,
  turn: ObjectPose['turn'],
  scale: number,
  lift: number,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  if (part.shape === 'round') {
    const at = turnPoint(size, turn, part.x * scale, part.y * scale)
    const piece: ObjectPiece = {
      shape: 'round',
      x: ox + at.x,
      y: oy + at.y,
      r: part.r * scale,
      r2: (part.r2 ?? part.r) * scale,
      z: part.z * scale,
      h: part.h * scale,
      color: part.color,
      top: part.top ?? part.color,
      lift,
    }
    return [{ cellX: Math.floor(piece.x), cellY: Math.floor(piece.y), piece }]
  }
  const a = turnPoint(size, turn, part.x * scale, part.y * scale)
  const b = turnPoint(size, turn, (part.x + part.w) * scale, (part.y + part.d) * scale)
  const x0 = ox + Math.min(a.x, b.x)
  const x1 = ox + Math.max(a.x, b.x)
  const y0 = oy + Math.min(a.y, b.y)
  const y1 = oy + Math.max(a.y, b.y)
  const out: { cellX: number; cellY: number; piece: ObjectPiece }[] = []
  for (let cy = Math.floor(y0); cy < y1; cy++) {
    for (let cx = Math.floor(x0); cx < x1; cx++) {
      if (part.shape === 'flat') {
        out.push({
          cellX: cx,
          cellY: cy,
          piece: {
            shape: 'flat',
            x0,
            y0,
            x1,
            y1,
            color: part.color,
            border: part.border,
            clip: { minX: cx, minY: cy, maxX: cx, maxY: cy },
            lift,
          },
        })
        continue
      }
      const px0 = Math.max(x0, cx)
      const px1 = Math.min(x1, cx + 1)
      const py0 = Math.max(y0, cy)
      const py1 = Math.min(y1, cy + 1)
      if (px1 - px0 <= 0 || py1 - py0 <= 0) continue
      out.push({
        cellX: cx,
        cellY: cy,
        piece: {
          shape: 'box',
          x0: px0,
          y0: py0,
          x1: px1,
          y1: py1,
          z: part.z * scale,
          h: part.h * scale,
          color: part.color,
          top: part.top ?? part.color,
          lift,
        },
      })
    }
  }
  return out
}

/**
 * A room's objects as pieces grouped by the cell they paint with, each cell's
 * pieces in the order they paint: rugs first, then from the floor up and from
 * the back forward.
 */
export function roomObjectPieces(room: Room, yaw: Camera['yaw']): Map<string, ObjectPiece[]> {
  const cells = new Map<string, ObjectPiece[]>()
  for (const object of room.objects ?? []) {
    for (const item of placedPieces(object, yaw)) {
      const key = cellKey(item.cellX, item.cellY)
      const list = cells.get(key)
      if (list) list.push(item.piece)
      else cells.set(key, [item.piece])
    }
  }
  for (const list of cells.values()) list.sort((a, b) => pieceOrder(a, b, yaw))
  return cells
}

function pieceOrder(a: ObjectPiece, b: ObjectPiece, yaw: Camera['yaw']): number {
  return pieceBottom(a) - pieceBottom(b) || pieceDepth(a, yaw) - pieceDepth(b, yaw)
}

/** Rugs first, then shadows falling on them, then everything standing, from the floor up. */
function pieceBottom(piece: ObjectPiece): number {
  if (piece.shape === 'shadow') return -0.5
  return piece.lift * LEVEL_HEIGHT + (piece.shape === 'flat' ? -1 : piece.z)
}

function pieceDepth(piece: ObjectPiece, yaw: Camera['yaw']): number {
  if (piece.shape === 'round') return isoDepth(piece.x, piece.y, yaw)
  if (piece.shape === 'shadow') return isoDepth(piece.clip.minX + 0.5, piece.clip.minY + 0.5, yaw)
  return isoDepth((piece.x0 + piece.x1) / 2, (piece.y0 + piece.y1) / 2, yaw)
}

/** Paints one piece of an object standing in a room whose floor is `elevation` steps up. */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  piece: ObjectPiece,
  elevation: number,
  light: ObjectLight,
): void {
  const base = roomLift(elevation + piece.lift)
  if (piece.shape === 'box') drawBox(ctx, camera, piece, base, light)
  else if (piece.shape === 'round') drawRound(ctx, camera, piece, base, light)
  else if (piece.shape === 'shadow') drawShadow(ctx, camera, piece, base)
  else drawFlat(ctx, camera, piece, base, light)
}

/** Every mark in one path, filled once, so where they overlap is no darker. */
function drawShadow(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  shadow: Extract<ObjectPiece, { shape: 'shadow' }>,
  base: number,
): void {
  ctx.save()
  ctx.beginPath()
  diamond(ctx, liftCorners(rectCorners(shadow.clip, camera), camera, base))
  ctx.clip()
  ctx.beginPath()
  const scale = camera.zoom * Math.SQRT1_2
  for (const mark of shadow.marks) {
    if ('r' in mark) {
      const centre = at(camera, mark.x, mark.y, base)
      ctx.moveTo(centre.x + mark.r * TILE_WIDTH * scale, centre.y)
      ctx.ellipse(centre.x, centre.y, mark.r * TILE_WIDTH * scale, mark.r * TILE_HEIGHT * scale, 0, 0, Math.PI * 2)
      continue
    }
    polygon(ctx, [
      at(camera, mark.x0, mark.y0, base),
      at(camera, mark.x1, mark.y0, base),
      at(camera, mark.x1, mark.y1, base),
      at(camera, mark.x0, mark.y1, base),
    ])
  }
  ctx.fillStyle = `rgba(0, 0, 0, ${shadow.opacity})`
  ctx.fill('nonzero')
  ctx.restore()
}

function at(camera: Camera, x: number, y: number, height: number): Point {
  return lift(cellToScreen(x, y, camera), camera, height)
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  box: Extract<ObjectPiece, { shape: 'box' }>,
  base: number,
  light: ObjectLight,
): void {
  const grid = [
    { x: box.x0, y: box.y0 },
    { x: box.x1, y: box.y0 },
    { x: box.x1, y: box.y1 },
    { x: box.x0, y: box.y1 },
  ]
  const low = grid.map((p) => at(camera, p.x, p.y, base + box.z))
  const high = grid.map((p) => at(camera, p.x, p.y, base + box.z + box.h))
  const middle = (low[0]!.x + low[1]!.x + low[2]!.x + low[3]!.x) / 4
  // Back faces first; a box is convex, so the faces in front then cover them.
  const sides = [0, 1, 2, 3]
    .map((i) => {
      const j = (i + 1) % 4
      const mid = { x: (grid[i]!.x + grid[j]!.x) / 2, y: (grid[i]!.y + grid[j]!.y) / 2 }
      return { i, j, depth: isoDepth(mid.x, mid.y, camera.yaw) }
    })
    .sort((a, b) => a.depth - b.depth)
  for (const side of sides) {
    const lo = low[side.i]!
    const hi = low[side.j]!
    const onLeft = (lo.x + hi.x) / 2 < middle
    ctx.beginPath()
    ctx.moveTo(lo.x, lo.y)
    ctx.lineTo(hi.x, hi.y)
    ctx.lineTo(high[side.j]!.x, high[side.j]!.y)
    ctx.lineTo(high[side.i]!.x, high[side.i]!.y)
    ctx.closePath()
    ctx.fillStyle = tone(box.color, onLeft ? light.left : light.right, light.fog)
    ctx.fill()
  }
  ctx.beginPath()
  polygon(ctx, high)
  ctx.fillStyle = tone(box.top, 1, light.fog)
  ctx.fill()
}

function drawRound(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  round: Extract<ObjectPiece, { shape: 'round' }>,
  base: number,
  light: ObjectLight,
): void {
  // A circle on the grid is an upright ellipse on screen, whatever the yaw.
  const scale = camera.zoom * Math.SQRT1_2
  const rx0 = round.r * TILE_WIDTH * scale
  const ry0 = round.r * TILE_HEIGHT * scale
  const rx1 = round.r2 * TILE_WIDTH * scale
  const ry1 = round.r2 * TILE_HEIGHT * scale
  const low = at(camera, round.x, round.y, base + round.z)
  const high = at(camera, round.x, round.y, base + round.z + round.h)

  ctx.beginPath()
  ctx.ellipse(low.x, low.y, rx0, ry0, 0, Math.PI, 0, true)
  ctx.lineTo(high.x + rx1, high.y)
  ctx.ellipse(high.x, high.y, rx1, ry1, 0, 0, Math.PI, true)
  ctx.closePath()
  const width = Math.max(rx0, rx1, 0.5)
  const side = ctx.createLinearGradient(low.x - width, 0, low.x + width, 0)
  side.addColorStop(0, tone(round.color, light.left, light.fog))
  side.addColorStop(0.7, tone(round.color, 1, light.fog))
  side.addColorStop(1, tone(round.color, light.right, light.fog))
  ctx.fillStyle = side
  ctx.fill()

  if (round.r2 <= 0) return
  ctx.beginPath()
  ctx.ellipse(high.x, high.y, rx1, ry1, 0, 0, Math.PI * 2)
  ctx.fillStyle = tone(round.top, 1, light.fog)
  ctx.fill()
}

function drawFlat(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  flat: Extract<ObjectPiece, { shape: 'flat' }>,
  base: number,
  light: ObjectLight,
): void {
  ctx.save()
  ctx.beginPath()
  diamond(ctx, liftCorners(rectCorners(flat.clip, camera), camera, base))
  ctx.clip()
  const outer = { x0: flat.x0, y0: flat.y0, x1: flat.x1, y1: flat.y1 }
  if (flat.border) {
    fillGridRect(ctx, camera, outer, base, tone(flat.border, 1, light.fog))
    const inner = { x0: flat.x0 + BORDER, y0: flat.y0 + BORDER, x1: flat.x1 - BORDER, y1: flat.y1 - BORDER }
    if (inner.x1 > inner.x0 && inner.y1 > inner.y0) fillGridRect(ctx, camera, inner, base, tone(flat.color, 1, light.fog))
  } else {
    fillGridRect(ctx, camera, outer, base, tone(flat.color, 1, light.fog))
  }
  ctx.restore()
}

function fillGridRect(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  rect: { x0: number; y0: number; x1: number; y1: number },
  base: number,
  color: string,
): void {
  ctx.beginPath()
  polygon(ctx, [
    at(camera, rect.x0, rect.y0, base),
    at(camera, rect.x1, rect.y0, base),
    at(camera, rect.x1, rect.y1, base),
    at(camera, rect.x0, rect.y1, base),
  ])
  ctx.fillStyle = color
  ctx.fill()
}

function polygon(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)))
  ctx.closePath()
}

function diamond(ctx: CanvasRenderingContext2D, corners: IsoCorners): void {
  polygon(ctx, [corners.n, corners.e, corners.s, corners.w])
}

/**
 * An object drawn whole, outside the map's paint order: the ghost of one being
 * placed or moved, or a picker thumbnail. Its footprint is outlined on the floor
 * when `outline` is given.
 */
export function drawWholeObject(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  pose: ObjectPose,
  elevation: number,
  light: ObjectLight,
  outline?: string,
): void {
  const pieces = placedPieces(pose, camera.yaw)
  pieces.sort(
    (a, b) =>
      isoDepth(a.cellX, a.cellY, camera.yaw) - isoDepth(b.cellX, b.cellY, camera.yaw) ||
      pieceOrder(a.piece, b.piece, camera.yaw),
  )
  if (outline) {
    const rect = objectFootprint(pose)
    ctx.beginPath()
    diamond(ctx, liftCorners(rectCorners(rect, camera), camera, roomLift(elevation)))
    ctx.fillStyle = `${outline}33`
    ctx.fill()
    ctx.strokeStyle = outline
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  for (const item of pieces) drawPiece(ctx, camera, item.piece, elevation, light)
}

/** Draws an object centred in a `size`-pixel square, for the picker. */
export function drawObjectThumb(ctx: CanvasRenderingContext2D, def: ObjectDef, size: number): void {
  const probe: Camera = { x: 0, y: 0, zoom: 1, yaw: 0 }
  const bounds = objectScreenBounds(def, probe)
  const pad = 4
  const zoom = Math.min((size - pad * 2) / (bounds.maxX - bounds.minX), (size - pad * 2) / (bounds.maxY - bounds.minY), 1.4)
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2
  const camera: Camera = { x: midX - size / 2 / zoom, y: midY - size / 2 / zoom, zoom, yaw: 0 }
  ctx.clearRect(0, 0, size, size)
  drawWholeObject(ctx, camera, { kind: def.id, x: 0, y: 0, turn: 0 }, 0, { left: 0.66, right: 0.9, fog: false })
}

/** The screen box an object fills at a camera, footprint and height together. */
function objectScreenBounds(def: ObjectDef, camera: Camera): { minX: number; minY: number; maxX: number; maxY: number } {
  let tallest = 0
  for (const part of def.parts) if (part.shape !== 'flat') tallest = Math.max(tallest, part.z + part.h)
  const points: Point[] = []
  for (const [gx, gy] of [
    [0, 0],
    [def.w, 0],
    [def.w, def.d],
    [0, def.d],
  ] as const) {
    points.push(at(camera, gx, gy, 0), at(camera, gx, gy, tallest))
  }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  }
}

// ---------- Colour ----------

const tones = new Map<string, string>()

/** A catalog colour darkened by `light`, and drained to grey for rooms remembered but out of sight. */
function tone(color: string, light: number, fog: boolean): string {
  const key = `${color}|${light}|${fog ? 1 : 0}`
  const cached = tones.get(key)
  if (cached) return cached
  const value = Number.parseInt(color.slice(1), 16)
  let r = ((value >> 16) & 255) * light
  let g = ((value >> 8) & 255) * light
  let b = (value & 255) * light
  if (fog) {
    const grey = (r * 0.299 + g * 0.587 + b * 0.114) * 0.45
    r = grey
    g = grey
    b = grey
  }
  const result = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
  tones.set(key, result)
  return result
}

