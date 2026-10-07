import { objectDef, type ObjectDef, type ObjectPart } from '../objects/catalog.ts'
import { footprintAt, objectHover, objectScale, turnPoint, type ObjectPose } from '../model/objects.ts'
import { cellId, cellKey } from '../model/tiles.ts'
import type { Camera, CellRect, Room, RoomObject } from '../model/types.ts'
import {
  LEVEL_HEIGHT,
  TILE_HEIGHT,
  TILE_WIDTH,
  cellToScreen,
  unorient,
  orient,
  isoDepth,
  lift,
  liftCorners,
  rectCorners,
  roomLift,
  type IsoCorners,
  type Point,
} from './camera.ts'
import { DETAIL_ZOOM, clipSolid, drawSolid, frustum, solidBounds, type Face, type SolidBounds } from './solids.ts'

/**
 * One shape of an object, placed on the map in grid coordinates. Boxes and
 * rounds are cut at cell lines into one piece per cell, so each piece can be
 * painted in turn with the walls and floors around it; rugs and shadows are
 * clipped to each cell instead. `lift` is how many steps above its room's
 * floor the piece's object floats; `owner` and `order` say which object and
 * which of its parts it came from: the part's layer.
 */
export type ObjectPiece = (
  | { shape: 'box'; x0: number; y0: number; x1: number; y1: number; z: number; h: number; color: string; top: string }
  /** A round, as a many-sided solid already cut to its cell. */
  | { shape: 'solid'; faces: readonly Face[]; bounds: SolidBounds; color: string; top: string }
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
  /**
   * The halo where a glowing part burns. It paints in turn like any piece, so
   * what stands in front of the flame hides its light too.
   */
  | ({ shape: 'glow' } & GlowSource)
) & { lift: number; owner: string; order: number }

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
export function placedPieces(
  pose: ObjectPose,
  yaw: Camera['yaw'] = 0,
  def: ObjectDef = objectDef(pose.kind),
  owner = '',
  coarse = false,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
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
        out.push({ cellX: cx, cellY: cy, piece: { shape: 'shadow', marks, opacity, clip, lift: 0, owner, order: -1 } })
      }
    }
  }
  // Where boxes overlap, the later one (the higher layer) is cut out of the earlier, so no
  // two boxes share space and each can be painted in the right order from every side.
  const boxes = def.parts.map((part) => (part.shape === 'box' ? placedCuboid(size, part, pose.x, pose.y, pose.turn, scale) : null))
  def.parts.forEach((part, order) => {
    if (part.shape !== 'box') {
      for (const piece of placePart(size, part, pose.x, pose.y, pose.turn, scale, lift, owner, order, coarse)) out.push(piece)
      return
    }
    let kept = [boxes[order]!]
    for (let later = order + 1; later < boxes.length; later++) {
      const cutter = boxes[later]
      if (cutter) kept = kept.flatMap((cuboid) => subtract(cuboid, cutter))
    }
    for (const cuboid of kept) for (const piece of placeCuboid(cuboid, part, lift, owner, order)) out.push(piece)
  })
  def.parts.forEach((part, order) => {
    // A glowing rug lights the floor around it but has no flame to haze; its own colour is its light.
    const glow = part.glow && part.shape !== 'flat' ? glowOf(part, size, pose.x, pose.y, pose.turn, scale) : null
    if (!glow) return
    // Painted with the nearest cell its part has a piece in, so the whole part is lit and
    // only what stands in front of it can hide its light (see withoutHiddenHalos).
    let cell: { x: number; y: number } | null = null
    for (const item of out) {
      if (item.piece.order !== order || item.piece.shape === 'shadow') continue
      if (!cell || isoDepth(item.cellX, item.cellY, yaw) > isoDepth(cell.x, cell.y, yaw)) cell = { x: item.cellX, y: item.cellY }
    }
    cell ??= { x: Math.floor(glow.x), y: Math.floor(glow.y) }
    out.push({ cellX: cell.x, cellY: cell.y, piece: { shape: 'glow', ...glow, lift, owner, order: order + 0.5 } })
  })
  return out
}

/** A box's space once placed: grid cells across, pixels up. */
interface Cuboid {
  x0: number
  y0: number
  x1: number
  y1: number
  z0: number
  z1: number
}

function placedCuboid(
  size: { w: number; d: number },
  part: Extract<ObjectPart, { shape: 'box' }>,
  ox: number,
  oy: number,
  turn: ObjectPose['turn'],
  scale: number,
): Cuboid {
  const a = turnPoint(size, turn, part.x * scale, part.y * scale)
  const b = turnPoint(size, turn, (part.x + part.w) * scale, (part.y + part.d) * scale)
  return {
    x0: ox + Math.min(a.x, b.x),
    x1: ox + Math.max(a.x, b.x),
    y0: oy + Math.min(a.y, b.y),
    y1: oy + Math.max(a.y, b.y),
    z0: part.z * scale,
    z1: (part.z + part.h) * scale,
  }
}

/** What's left of `a` with `b` taken out: up to six boxes around the hole, or `a` whole if they don't meet. */
function subtract(a: Cuboid, b: Cuboid): Cuboid[] {
  const meet =
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > GAP &&
    Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > GAP &&
    Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > GAP
  if (!meet) return [a]
  const out: Cuboid[] = []
  if (b.x0 > a.x0 + GAP) out.push({ ...a, x1: b.x0 })
  if (b.x1 < a.x1 - GAP) out.push({ ...a, x0: b.x1 })
  const x0 = Math.max(a.x0, b.x0)
  const x1 = Math.min(a.x1, b.x1)
  if (b.y0 > a.y0 + GAP) out.push({ ...a, x0, x1, y1: b.y0 })
  if (b.y1 < a.y1 - GAP) out.push({ ...a, x0, x1, y0: b.y1 })
  const y0 = Math.max(a.y0, b.y0)
  const y1 = Math.min(a.y1, b.y1)
  if (b.z0 > a.z0 + GAP) out.push({ x0, x1, y0, y1, z0: a.z0, z1: b.z0 })
  if (b.z1 < a.z1 - GAP) out.push({ x0, x1, y0, y1, z0: b.z1, z1: a.z1 })
  return out
}

/** A box's space cut into a piece for every cell it covers. */
function placeCuboid(
  c: Cuboid,
  part: Extract<ObjectPart, { shape: 'box' }>,
  lift: number,
  owner: string,
  order: number,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  const out: { cellX: number; cellY: number; piece: ObjectPiece }[] = []
  for (let cy = Math.floor(c.y0); cy < c.y1; cy++) {
    for (let cx = Math.floor(c.x0); cx < c.x1; cx++) {
      const px0 = Math.max(c.x0, cx)
      const px1 = Math.min(c.x1, cx + 1)
      const py0 = Math.max(c.y0, cy)
      const py1 = Math.min(c.y1, cy + 1)
      if (px1 - px0 <= GAP || py1 - py0 <= GAP) continue
      out.push({
        cellX: cx,
        cellY: cy,
        piece: {
          shape: 'box',
          x0: px0,
          y0: py0,
          x1: px1,
          y1: py1,
          z: c.z0,
          h: c.z1 - c.z0,
          color: part.color,
          top: part.top ?? part.color,
          lift,
          owner,
          order,
        },
      })
    }
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

/**
 * A round or a rug where the pose puts it. `size` is the footprint once scaled,
 * before turning; the part's own numbers are scaled here. Boxes go through
 * `placeCuboid`, once the boxes over them are cut out.
 */
function placePart(
  size: { w: number; d: number },
  part: Exclude<ObjectPart, { shape: 'box' }>,
  ox: number,
  oy: number,
  turn: ObjectPose['turn'],
  scale: number,
  lift: number,
  owner: string,
  order: number,
  coarse: boolean,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  if (part.shape === 'round') return placeRound(size, part, ox, oy, turn, scale, lift, owner, order, coarse)
  const a = turnPoint(size, turn, part.x * scale, part.y * scale)
  const b = turnPoint(size, turn, (part.x + part.w) * scale, (part.y + part.d) * scale)
  const x0 = ox + Math.min(a.x, b.x)
  const x1 = ox + Math.max(a.x, b.x)
  const y0 = oy + Math.min(a.y, b.y)
  const y1 = oy + Math.max(a.y, b.y)
  const out: { cellX: number; cellY: number; piece: ObjectPiece }[] = []
  // A rug is drawn whole in every cell it covers, clipped to that cell.
  for (let cy = Math.floor(y0); cy < y1; cy++) {
    for (let cx = Math.floor(x0); cx < x1; cx++) {
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
          owner,
          order,
        },
      })
    }
  }
  return out
}

/** A round as a solid, cut into a piece for every cell it reaches into. */
function placeRound(
  size: { w: number; d: number },
  part: Extract<ObjectPart, { shape: 'round' }>,
  ox: number,
  oy: number,
  turn: ObjectPose['turn'],
  scale: number,
  lift: number,
  owner: string,
  order: number,
  coarse: boolean,
): { cellX: number; cellY: number; piece: ObjectPiece }[] {
  const at = turnPoint(size, turn, part.x * scale, part.y * scale)
  const x = ox + at.x
  const y = oy + at.y
  const r = part.r * scale
  const r2 = (part.r2 ?? part.r) * scale
  const reach = Math.max(r, r2)
  const whole = frustum(x, y, r, r2, part.z * scale, part.h * scale, coarse)
  const out: { cellX: number; cellY: number; piece: ObjectPiece }[] = []
  for (let cy = Math.floor(y - reach); cy < y + reach; cy++) {
    for (let cx = Math.floor(x - reach); cx < x + reach; cx++) {
      let faces: Face[] = whole
      if (x - reach < cx) faces = clipSolid(faces, 'x', cx, 'hi')
      if (x + reach > cx + 1) faces = clipSolid(faces, 'x', cx + 1, 'lo')
      if (y - reach < cy) faces = clipSolid(faces, 'y', cy, 'hi')
      if (y + reach > cy + 1) faces = clipSolid(faces, 'y', cy + 1, 'lo')
      if (faces.length === 0) continue
      const bounds = solidBounds(faces)
      if (bounds.x1 - bounds.x0 < 1e-6 || bounds.y1 - bounds.y0 < 1e-6) continue
      out.push({
        cellX: cx,
        cellY: cy,
        piece: { shape: 'solid', faces, bounds, color: part.color, top: part.top ?? part.color, lift, owner, order },
      })
    }
  }
  return out
}

/**
 * A room's objects as pieces grouped by the cell they paint with, each cell's
 * pieces in the order they paint: rugs first, then from the floor up and from
 * the back forward. Keyed by `cellId`. Zoomed out past `DETAIL_ZOOM`, rounds
 * are built with fewer sides.
 */
export function roomObjectPieces(room: Room, camera: Camera): ReadonlyMap<number, readonly ObjectPiece[]> {
  const objects = room.objects
  if (!objects?.length) return new Map()
  const yaw = camera.yaw
  const coarse = camera.zoom < DETAIL_ZOOM
  // Kept while the room's objects, the side they're seen from and their shapes stay the same:
  // only an edit changes them, not a pan, a zoom or anything moving over the map.
  const defs = objects.map((object) => objectDef(object.kind))
  const slot = yaw + (coarse ? 4 : 0)
  let bySlot = piecesCache.get(objects)
  const known = bySlot?.get(slot)
  if (known && sameDefs(known.defs, defs)) return known.cells
  const cells = new Map<number, ObjectPiece[]>()
  const placed = objects.flatMap((object, i) => placedPieces(object, yaw, defs[i], object.id, coarse))
  for (const item of withoutHiddenHalos(placed, yaw)) {
    const key = cellId(item.cellX, item.cellY)
    const list = cells.get(key)
    if (list) list.push(item.piece)
    else cells.set(key, [item.piece])
  }
  for (const [key, list] of cells) cells.set(key, sortPieces(list, yaw))
  if (!bySlot) piecesCache.set(objects, (bySlot = new Map()))
  bySlot.set(slot, { defs, cells })
  return cells
}

/** Each room's pieces by the side they're seen from and how finely, with the shapes they were built from. */
const piecesCache = new WeakMap<
  readonly RoomObject[],
  Map<number, { defs: readonly ObjectDef[]; cells: ReadonlyMap<number, readonly ObjectPiece[]> }>
>()

/** The lights a room's objects give off, kept like its pieces until an edit changes them. */
export function roomGlows(room: Room): readonly GlowSource[] {
  const objects = room.objects
  if (!objects?.length) return []
  const defs = objects.map((object) => objectDef(object.kind))
  const known = glowsCache.get(objects)
  if (known && sameDefs(known.defs, defs)) return known.glows
  const glows = objects.flatMap((object, i) => objectGlows(object, defs[i]))
  glowsCache.set(objects, { defs, glows })
  return glows
}

const glowsCache = new WeakMap<readonly RoomObject[], { defs: readonly ObjectDef[]; glows: readonly GlowSource[] }>()

function sameDefs(a: readonly ObjectDef[], b: readonly ObjectDef[]): boolean {
  return a.length === b.length && a.every((def, i) => def === b[i])
}

/**
 * Drops the halo of any light hidden behind something. Cells paint one after another,
 * so a halo can spread over pieces of earlier cells that are nearer than its flame; a
 * hidden flame shouldn't haze what hides it. Hidden means every point sampled through
 * the glowing part is behind something, so a lantern's bars don't put out its light.
 */
function withoutHiddenHalos<T extends { piece: ObjectPiece }>(placed: T[], yaw: Camera['yaw']): T[] {
  const halos = placed.filter((item) => item.piece.shape === 'glow')
  if (!halos.length) return placed
  const along = alongAxes(yaw)
  const standing = placed
    .map((item) => item.piece)
    .filter((piece) => piece.shape === 'box' || piece.shape === 'solid' || (piece.shape === 'flat' && piece.lift > 0))
    .map((piece) => ({ piece, space: extent(piece), outline: screenOutline(extent(piece), yaw) }))
  const hidden = new Set<ObjectPiece>()
  for (const { piece: halo } of halos) {
    const own = (piece: ObjectPiece) => piece.owner === halo.owner && piece.order === halo.order - 0.5
    const part = standing.filter((other) => own(other.piece)).map((other) => other.space)
    const centre = extent(halo)
    const space = part.reduce(
      (a, b) => ({
        x0: Math.min(a.x0, b.x0),
        y0: Math.min(a.y0, b.y0),
        z0: Math.min(a.z0, b.z0),
        x1: Math.max(a.x1, b.x1),
        y1: Math.max(a.y1, b.y1),
        z1: Math.max(a.z1, b.z1),
      }),
      centre,
    )
    // The middle and, pulled halfway in, the corners of the part: a cone or ball doesn't fill them.
    const mix = (lo: number, hi: number, mid: number) => [mid + (lo - mid) * 0.5, mid + (hi - mid) * 0.5]
    const samples = [centre]
    for (const x of mix(space.x0, space.x1, centre.x0)) {
      for (const y of mix(space.y0, space.y1, centre.y0)) {
        for (const z of mix(space.z0, space.z1, centre.z0)) samples.push({ x0: x, x1: x, y0: y, y1: y, z0: z, z1: z })
      }
    }
    const behind = (point: SolidBounds) => {
      const seen = screenOutline(point, yaw)
      return standing.some(
        (other) =>
          !own(other.piece) && outlinesMeet(seen, other.outline) && relation(halo, other.piece, point, other.space, along) === -2,
      )
    }
    if (samples.every(behind)) hidden.add(halo)
  }
  return placed.filter((item) => !hidden.has(item.piece))
}

/** -1 along an axis when the piece on its low side paints first: the camera is toward the high side. */
function alongAxes(yaw: Camera['yaw']): { x: number; y: number } {
  return {
    x: isoDepth(1, 0, yaw) > isoDepth(0, 0, yaw) ? -1 : 1,
    y: isoDepth(0, 1, yaw) > isoDepth(0, 0, yaw) ? -1 : 1,
  }
}

/** The space a piece takes: plan extent in cells, height in pixels above its room's floor. */
function extent(piece: ObjectPiece): SolidBounds {
  const lifted = piece.lift * LEVEL_HEIGHT
  if (piece.shape === 'solid') return { ...piece.bounds, z0: piece.bounds.z0 + lifted, z1: piece.bounds.z1 + lifted }
  if (piece.shape === 'box') {
    return { x0: piece.x0, y0: piece.y0, x1: piece.x1, y1: piece.y1, z0: lifted + piece.z, z1: lifted + piece.z + piece.h }
  }
  if (piece.shape === 'flat') return { x0: piece.x0, y0: piece.y0, x1: piece.x1, y1: piece.y1, z0: lifted, z1: lifted }
  // Halos never reach the sort (see sortPieces); a point where they burn will do.
  if (piece.shape === 'glow') return { x0: piece.x, y0: piece.y, x1: piece.x, y1: piece.y, z0: lifted + piece.z, z1: lifted + piece.z }
  return { x0: piece.clip.minX, y0: piece.clip.minY, x1: piece.clip.minX + 1, y1: piece.clip.minY + 1, z0: 0, z1: 0 }
}

const GAP = 1e-6

/**
 * Which of two standing pieces paints first: negative for `a`. Pieces with
 * space between them go by where they stand, which is right from every side:
 * the lower one first, or the one farther from the camera. Pieces that overlap
 * have no right answer, so their object's layer order decides (later on top).
 * Zero when nothing decides; ±2 when space between them decides, ±1 for a best guess.
 */
function relation(a: ObjectPiece, b: ObjectPiece, ea: SolidBounds, eb: SolidBounds, along: { x: number; y: number }): number {
  if (ea.z1 <= eb.z0 + GAP) return -2
  if (eb.z1 <= ea.z0 + GAP) return 2
  if (ea.x1 <= eb.x0 + GAP) return 2 * along.x
  if (eb.x1 <= ea.x0 + GAP) return -2 * along.x
  if (ea.y1 <= eb.y0 + GAP) return 2 * along.y
  if (eb.y1 <= ea.y0 + GAP) return -2 * along.y
  // Parts that only just sink into each other (a flame into a hearth's stone, tiers of a
  // tree) are nearly apart: order them by where their middles sit on the shallowest axis.
  const shallow = shallowestOverlap(ea, eb)
  if (shallow) {
    const ahead = shallow.axis === 'z' ? -1 : along[shallow.axis]
    return shallow.aFirst ? ahead : -ahead
  }
  if (a.owner === b.owner && a.order !== b.order) return Math.sign(a.order - b.order)
  return 0
}

/** How deep an overlap may go, against the smaller part's size, and still count as resting against it. */
const SHALLOW = 0.3

/**
 * The axis two overlapping pieces sink into each other least along, if that's
 * shallow enough to treat them as side by side, and whether \`a\` is the low side.
 */
function shallowestOverlap(ea: SolidBounds, eb: SolidBounds): { axis: 'x' | 'y' | 'z'; aFirst: boolean } | null {
  let best: { axis: 'x' | 'y' | 'z'; aFirst: boolean; ratio: number } | null = null
  for (const axis of ['x', 'y', 'z'] as const) {
    const lo = axis === 'x' ? 'x0' : axis === 'y' ? 'y0' : 'z0'
    const hi = axis === 'x' ? 'x1' : axis === 'y' ? 'y1' : 'z1'
    const depth = Math.min(ea[hi], eb[hi]) - Math.max(ea[lo], eb[lo])
    const smaller = Math.min(ea[hi] - ea[lo], eb[hi] - eb[lo])
    if (smaller <= GAP) continue
    const ratio = depth / smaller
    if (ratio < SHALLOW && (!best || ratio < best.ratio)) {
      best = { axis, aFirst: ea[lo] + ea[hi] < eb[lo] + eb[hi], ratio }
    }
  }
  return best
}

/**
 * A piece's outline on screen at zoom 1, as the hexagon its box projects to:
 * the range it covers along screen x, screen y, and the two grid diagonals.
 * Two outlines that miss on any of the four can't cover each other.
 */
interface Outline {
  sx0: number
  sx1: number
  sy0: number
  sy1: number
  u0: number
  u1: number
  v0: number
  v1: number
}

function screenOutline(e: SolidBounds, yaw: Camera['yaw']): Outline {
  const out = { sx0: Infinity, sx1: -Infinity, sy0: Infinity, sy1: -Infinity, u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity }
  for (const x of [e.x0, e.x1]) {
    for (const y of [e.y0, e.y1]) {
      const view = orient(x, y, yaw)
      for (const z of [e.z0, e.z1]) {
        const sx = (view.x - view.y) * (TILE_WIDTH / 2)
        const sy = (view.x + view.y) * (TILE_HEIGHT / 2) - z
        // Screen directions along the two grid axes, where a box's side edges run.
        const u = sy + sx / 2
        const v = sy - sx / 2
        out.sx0 = Math.min(out.sx0, sx)
        out.sx1 = Math.max(out.sx1, sx)
        out.sy0 = Math.min(out.sy0, sy)
        out.sy1 = Math.max(out.sy1, sy)
        out.u0 = Math.min(out.u0, u)
        out.u1 = Math.max(out.u1, u)
        out.v0 = Math.min(out.v0, v)
        out.v1 = Math.max(out.v1, v)
      }
    }
  }
  return out
}

const OUTLINE_GAP = 0.01

function outlinesMeet(a: Outline, b: Outline): boolean {
  return (
    a.sx0 < b.sx1 - OUTLINE_GAP &&
    b.sx0 < a.sx1 - OUTLINE_GAP &&
    a.sy0 < b.sy1 - OUTLINE_GAP &&
    b.sy0 < a.sy1 - OUTLINE_GAP &&
    a.u0 < b.u1 - OUTLINE_GAP &&
    b.u0 < a.u1 - OUTLINE_GAP &&
    a.v0 < b.v1 - OUTLINE_GAP &&
    b.v0 < a.v1 - OUTLINE_GAP
  )
}

/** For pieces nothing else orders: from the floor up, then from the back forward. */
function fallback(ea: SolidBounds, eb: SolidBounds, yaw: Camera['yaw']): number {
  return (
    ea.z0 - eb.z0 ||
    isoDepth((ea.x0 + ea.x1) / 2, (ea.y0 + ea.y1) / 2, yaw) - isoDepth((eb.x0 + eb.x1) / 2, (eb.y0 + eb.y1) / 2, yaw)
  )
}

/**
 * One cell's pieces in the order they paint: rugs (in their layer order), the
 * shadows falling on them, then everything standing, each after whatever it
 * must cover.
 */
export function sortPieces(pieces: readonly ObjectPiece[], yaw: Camera['yaw']): ObjectPiece[] {
  const onFloor = pieces.filter((p) => p.shape === 'flat' && p.lift === 0).sort((a, b) => a.order - b.order)
  const shadows = pieces.filter((p) => p.shape === 'shadow')
  const halos = pieces.filter((p) => p.shape === 'glow')
  const standing = pieces.filter((p) => p.shape !== 'shadow' && p.shape !== 'glow' && !(p.shape === 'flat' && p.lift === 0))
  const painted = [...onFloor, ...shadows, ...paintStanding(standing, yaw)]
  // A halo goes straight after the last piece of the part it burns over, so it lights that
  // part and is covered by whatever paints over it next.
  for (const halo of halos) {
    let at = -1
    painted.forEach((piece, i) => {
      if (piece.owner === halo.owner && piece.order === halo.order - 0.5) at = i
    })
    painted.splice(at < 0 ? painted.length : at + 1, 0, halo)
  }
  return painted
}

/** A topological sort by `relation`, using `fallback` to choose among the free and to break any cycle. */
function paintStanding(pieces: ObjectPiece[], yaw: Camera['yaw']): ObjectPiece[] {
  const n = pieces.length
  if (n < 2) return pieces
  const extents = pieces.map(extent)
  const along = alongAxes(yaw)
  // Pieces that don't overlap on screen can paint in either order; leaving them unordered
  // keeps their spatial rules from chaining into cycles with pieces that do overlap.
  const outlines = extents.map((e) => screenOutline(e, yaw))
  const after: number[][] = pieces.map(() => [])
  const waiting = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!outlinesMeet(outlines[i]!, outlines[j]!)) continue
      const order = relation(pieces[i]!, pieces[j]!, extents[i]!, extents[j]!, along)
      if (order < 0) {
        after[i]!.push(j)
        waiting[j]!++
      } else if (order > 0) {
        after[j]!.push(i)
        waiting[i]!++
      }
    }
  }
  const done = new Array<boolean>(n).fill(false)
  const out: ObjectPiece[] = []
  for (let step = 0; step < n; step++) {
    let pick = -1
    for (let i = 0; i < n; i++) {
      if (done[i] || waiting[i]! > 0) continue
      if (pick < 0 || fallback(extents[i]!, extents[pick]!, yaw) < 0) pick = i
    }
    // A cycle: take the lowest, farthest piece left and carry on.
    if (pick < 0) {
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || fallback(extents[i]!, extents[pick]!, yaw) < 0)) pick = i
    }
    done[pick] = true
    out.push(pieces[pick]!)
    for (const next of after[pick]!) waiting[next]!--
  }
  return out
}

/** Somewhere an object gives off light: a point in grid cells, `z` pixels above its room's floor. */
export interface GlowSource {
  x: number
  y: number
  z: number
  /** How far the light reaches, in cells. */
  reach: number
  color: string
}

/** Where a glowing part's light comes from, placed: its middle, `z` pixels above the object's base. */
function glowOf(
  part: ObjectPart,
  size: { w: number; d: number },
  ox: number,
  oy: number,
  turn: ObjectPose['turn'],
  scale: number,
): GlowSource {
  let centre: { x: number; y: number }
  let across: number
  let z: number
  if (part.shape === 'round') {
    centre = turnPoint(size, turn, part.x * scale, part.y * scale)
    across = Math.max(part.r, part.r2 ?? part.r) * 2
    z = part.z + part.h * 0.55
  } else {
    centre = turnPoint(size, turn, (part.x + part.w / 2) * scale, (part.y + part.d / 2) * scale)
    across = Math.max(part.w, part.d)
    z = part.shape === 'flat' ? 0 : part.z + part.h / 2
  }
  return {
    x: ox + centre.x,
    y: oy + centre.y,
    z: z * scale,
    reach: Math.min(2.4, 0.5 + across * 1.3) * scale,
    color: part.shape === 'flat' ? part.color : (part.top ?? part.color),
  }
}

/** The lights an object gives off where `pose` puts it, one for each glowing part; `z` includes its hover. */
export function objectGlows(pose: ObjectPose, def: ObjectDef = objectDef(pose.kind)): GlowSource[] {
  const scale = objectScale(pose)
  const lifted = objectHover(pose) * LEVEL_HEIGHT
  const size = { w: def.w * scale, d: def.d * scale }
  return def.parts
    .filter((part) => part.glow)
    .map((part) => {
      const glow = glowOf(part, size, pose.x, pose.y, pose.turn, scale)
      return { ...glow, z: glow.z + lifted }
    })
}

function glowRadius(camera: Camera, glow: GlowSource): number {
  return glow.reach * TILE_WIDTH * camera.zoom * Math.SQRT1_2
}

/**
 * The pool of light a glow casts on the floor beneath it, added over what's
 * painted, clipped to `cell` when given: the map lays it on each floor tile as
 * that tile is painted, so anything standing in front covers it.
 */
export function drawGlowPool(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  glow: GlowSource,
  elevation: number,
  cell?: { x: number; y: number },
): void {
  const rgb = hexRgb(glow.color)
  const base = roomLift(elevation)
  const radius = glowRadius(camera, glow)
  ctx.save()
  if (cell) {
    ctx.beginPath()
    diamond(ctx, liftCorners(rectCorners({ minX: cell.x, minY: cell.y, maxX: cell.x, maxY: cell.y }, camera), camera, base))
    ctx.clip()
  }
  ctx.globalCompositeOperation = 'lighter'
  // The pool lies on the floor, so it's squashed to the floor's slant.
  const floor = at(camera, glow.x, glow.y, base)
  ctx.translate(floor.x, floor.y)
  ctx.scale(1, TILE_HEIGHT / TILE_WIDTH)
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
  pool.addColorStop(0, `rgba(${rgb}, 0.32)`)
  pool.addColorStop(0.45, `rgba(${rgb}, 0.1)`)
  pool.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = pool
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** The halo where a glow burns, added over what's painted, `base` pixels up. */
function drawHalo(ctx: CanvasRenderingContext2D, camera: Camera, glow: GlowSource, base: number): void {
  const rgb = hexRgb(glow.color)
  const radius = glowRadius(camera, glow) * 0.6
  const source = at(camera, glow.x, glow.y, base + glow.z)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const halo = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, radius)
  halo.addColorStop(0, `rgba(${rgb}, 0.36)`)
  halo.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(source.x, source.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function hexRgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`
}

/** Paints one piece of an object standing in a room whose floor is `elevation` steps up. */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  piece: ObjectPiece,
  elevation: number,
  light: ObjectLight,
  /** False when zoomed out too far for rounds' seam hairlines to show. */
  detail = true,
): void {
  const base = roomLift(elevation + piece.lift)
  if (piece.shape === 'box') drawBox(ctx, camera, piece, base, light)
  else if (piece.shape === 'solid') {
    const fill = (top: boolean, shade: number) => tone(top ? piece.top : piece.color, shade, light.fog)
    drawSolid(ctx, camera, piece.faces, base, fill, light.left, light.right, detail)
  }
  else if (piece.shape === 'shadow') drawShadow(ctx, camera, piece, base)
  // Out of sight, nothing burns.
  else if (piece.shape === 'glow') {
    if (!light.fog) drawHalo(ctx, camera, piece, base)
  }
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
  // The floor is a flat grid seen at a slant, so the outline laid out in grid
  // cells once is carried onto the screen by the grid's own step across and down.
  const origin = at(camera, 0, 0, base)
  const across = at(camera, 1, 0, base)
  const down = at(camera, 0, 1, base)
  ctx.transform(across.x - origin.x, across.y - origin.y, down.x - origin.x, down.y - origin.y, origin.x, origin.y)
  ctx.fillStyle = `rgba(0, 0, 0, ${shadow.opacity})`
  ctx.fill(shadowOutline(shadow.marks), 'nonzero')
  ctx.restore()
}

/** A shadow's marks as one path in grid cells, built once and shared by every cell the shadow falls in. */
function shadowOutline(marks: readonly ShadowMark[]): Path2D {
  const known = shadowOutlines.get(marks)
  if (known) return known
  const path = new Path2D()
  for (const mark of marks) {
    if ('r' in mark) {
      path.moveTo(mark.x + mark.r, mark.y)
      path.arc(mark.x, mark.y, mark.r, 0, Math.PI * 2)
      continue
    }
    path.moveTo(mark.x0, mark.y0)
    path.lineTo(mark.x1, mark.y0)
    path.lineTo(mark.x1, mark.y1)
    path.lineTo(mark.x0, mark.y1)
    path.closePath()
  }
  shadowOutlines.set(marks, path)
  return path
}

const shadowOutlines = new WeakMap<readonly ShadowMark[], Path2D>()

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
  // Only the two sides turned to the camera: a box's far sides are hidden behind it, and
  // painting them anyway would show through a part that overlaps this one.
  const toward = unorient(1, 1, camera.yaw)
  const outward = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]
  const sides = [0, 1, 2, 3]
    .filter((i) => outward[i]!.x * toward.x + outward[i]!.y * toward.y > 0)
    .map((i) => ({ i, j: (i + 1) % 4 }))
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
 * when `outline` is given. `def` stands in for the catalog's, for an object
 * still being built in the editor.
 */
export function drawWholeObject(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  pose: ObjectPose,
  elevation: number,
  light: ObjectLight,
  outline?: string,
  def: ObjectDef = objectDef(pose.kind),
): void {
  // Cell by cell from the back, each cell's pieces in their own order, as the map paints them.
  const cells = new Map<string, { depth: number; pieces: ObjectPiece[] }>()
  for (const item of withoutHiddenHalos(placedPieces(pose, camera.yaw, def, 'whole'), camera.yaw)) {
    const key = cellKey(item.cellX, item.cellY)
    const cell = cells.get(key) ?? { depth: isoDepth(item.cellX, item.cellY, camera.yaw), pieces: [] }
    cell.pieces.push(item.piece)
    cells.set(key, cell)
  }
  const ordered = [...cells.values()].sort((a, b) => a.depth - b.depth)
  if (outline) {
    const rect = footprintAt(def, pose.x, pose.y, pose.turn, objectScale(pose))
    ctx.beginPath()
    diamond(ctx, liftCorners(rectCorners(rect, camera), camera, roomLift(elevation)))
    ctx.fillStyle = `${outline}33`
    ctx.fill()
    ctx.strokeStyle = outline
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  for (const cell of ordered) for (const piece of sortPieces(cell.pieces, camera.yaw)) drawPiece(ctx, camera, piece, elevation, light)
}

const THUMB_LIGHT: ObjectLight = { left: 0.66, right: 0.9, fog: false }

/** Draws an object centred in a `size`-pixel square, for the picker. */
export function drawObjectThumb(ctx: CanvasRenderingContext2D, def: ObjectDef, size: number): void {
  ctx.clearRect(0, 0, size, size)
  const camera = fitObjectCamera(def, size, size, 0, 4, 1.4)
  drawWholeObject(ctx, camera, { kind: def.id, x: 0, y: 0, turn: 0 }, 0, THUMB_LIGHT, undefined, def)
}

/**
 * A camera that fits an object, footprint and full height, centred in a
 * `width` by `height` pixel box seen from `yaw`, zoomed in no further than `maxZoom`.
 */
export function fitObjectCamera(
  def: ObjectDef,
  width: number,
  height: number,
  yaw: Camera['yaw'],
  pad: number,
  maxZoom: number,
  tallest?: number,
): Camera {
  const bounds = objectScreenBounds(def, { x: 0, y: 0, zoom: 1, yaw }, tallest)
  const zoom = Math.min(
    (width - pad * 2) / (bounds.maxX - bounds.minX),
    (height - pad * 2) / (bounds.maxY - bounds.minY),
    maxZoom,
  )
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2
  return { x: midX - width / 2 / zoom, y: midY - height / 2 / zoom, zoom, yaw }
}

/**
 * An object still being built, drawn standing on its outlined footprint, for
 * the object editor. The light matches the picker's.
 */
export function drawObjectPreview(ctx: CanvasRenderingContext2D, camera: Camera, def: ObjectDef, outline: string): void {
  const pose = { kind: def.id, x: 0, y: 0, turn: 0 as const }
  // No floor tiles here to lay the pools on, so they go under the object instead.
  for (const glow of objectGlows(pose, def)) drawGlowPool(ctx, camera, glow, 0)
  drawWholeObject(ctx, camera, pose, 0, THUMB_LIGHT, outline, def)
}

/** The screen box an object fills at a camera, footprint and height together (or `reach` high, when given). */
function objectScreenBounds(
  def: ObjectDef,
  camera: Camera,
  reach?: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let tallest = reach ?? 0
  if (reach === undefined) for (const part of def.parts) if (part.shape !== 'flat') tallest = Math.max(tallest, part.z + part.h)
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

