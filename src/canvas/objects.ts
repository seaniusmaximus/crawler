import { objectDef, type ObjectDef, type ObjectPart } from '../objects/catalog.ts'
import { footprintAt, turnPoint } from '../model/objects.ts'
import { cellKey } from '../model/tiles.ts'
import type { Camera, CellRect, ObjectTurn, Room } from '../model/types.ts'
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  cellToScreen,
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
 * with the walls and floors around it; rugs are clipped to each cell instead.
 */
export type ObjectPiece =
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

/** How objects take light: the tileset's falloff on the two faces the camera sees, and greyed when out of sight. */
export interface ObjectLight {
  left: number
  right: number
  fog: boolean
}

/** A rug's border band, in cells. */
const BORDER = 0.07

/** Every piece of an object at (x, y), placed and turned, each with the cell it paints with. */
export function placedPieces(
  def: ObjectDef,
  x: number,
  y: number,
  turn: ObjectTurn,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  const out: { cellX: number; cellY: number; piece: ObjectPiece }[] = []
  for (const part of def.parts) {
    for (const piece of placePart(def, part, x, y, turn)) out.push(piece)
  }
  return out
}

function placePart(
  def: ObjectDef,
  part: ObjectPart,
  ox: number,
  oy: number,
  turn: ObjectTurn,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  if (part.shape === 'round') {
    const at = turnPoint(def, turn, part.x, part.y)
    const piece: ObjectPiece = {
      shape: 'round',
      x: ox + at.x,
      y: oy + at.y,
      r: part.r,
      r2: part.r2 ?? part.r,
      z: part.z,
      h: part.h,
      color: part.color,
      top: part.top ?? part.color,
    }
    return [{ cellX: Math.floor(piece.x), cellY: Math.floor(piece.y), piece }]
  }
  const a = turnPoint(def, turn, part.x, part.y)
  const b = turnPoint(def, turn, part.x + part.w, part.y + part.d)
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
          z: part.z,
          h: part.h,
          color: part.color,
          top: part.top ?? part.color,
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
    for (const item of placedPieces(objectDef(object.kind), object.x, object.y, object.turn)) {
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

function pieceBottom(piece: ObjectPiece): number {
  return piece.shape === 'flat' ? -1 : piece.z
}

function pieceDepth(piece: ObjectPiece, yaw: Camera['yaw']): number {
  if (piece.shape === 'round') return isoDepth(piece.x, piece.y, yaw)
  return isoDepth((piece.x0 + piece.x1) / 2, (piece.y0 + piece.y1) / 2, yaw)
}

/** Paints one piece standing on a floor `elevation` steps up. */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  piece: ObjectPiece,
  elevation: number,
  light: ObjectLight,
): void {
  const base = roomLift(elevation)
  if (piece.shape === 'box') drawBox(ctx, camera, piece, base, light)
  else if (piece.shape === 'round') drawRound(ctx, camera, piece, base, light)
  else drawFlat(ctx, camera, piece, base, light)
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
  def: ObjectDef,
  x: number,
  y: number,
  turn: ObjectTurn,
  elevation: number,
  light: ObjectLight,
  outline?: string,
): void {
  const pieces = placedPieces(def, x, y, turn)
  pieces.sort(
    (a, b) =>
      isoDepth(a.cellX, a.cellY, camera.yaw) - isoDepth(b.cellX, b.cellY, camera.yaw) ||
      pieceOrder(a.piece, b.piece, camera.yaw),
  )
  if (outline) {
    const rect = footprintAt(def, x, y, turn)
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
  drawWholeObject(ctx, camera, def, 0, 0, 0, 0, { left: 0.66, right: 0.9, fog: false })
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

