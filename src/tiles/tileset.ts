import type { TileSprite } from '../model/types.ts'

/** A rectangle on a tileset's spritesheet, in sheet pixels. */
export interface SheetRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Upright art. `wall` is a wall's side, which doorways and windows are also
 * cut from; `door` is the leaf, `window` the closed shutters and
 * `window-open` the bars (transparent between them). `door-double` and
 * `window-double` span two cells: a pair of leaves meeting in the middle, used
 * where two doors or windows stand side by side. `foundation` is the
 * rough stone under a raised room. Stairs between floors are built from
 * `tread` (a step's top, square, seen from above), `riser` (a step's face)
 * and `shaft` (the inner wall of a stairwell going down).
 */
export type FaceKind =
  | 'wall'
  | 'door'
  | 'door-double'
  | 'window'
  | 'window-double'
  | 'window-open'
  | 'foundation'
  | 'tread'
  | 'riser'
  | 'shaft'

/**
 * One look for the map: a spritesheet plus which part of it is which. Every
 * slot takes one or more variants; tiles pick among them by position so a
 * floor never repeats in an obvious grid.
 */
export interface Tileset {
  id: string
  name: string
  /** URL of the spritesheet image. */
  sheet: string
  /** Seen from above and skewed onto a tile's diamond. Square art works best. */
  tops: Record<TileSprite, readonly SheetRect[]>
  /** Stood upright on a cube's side; about 16:9 matches a wall's proportions. */
  faces: Record<FaceKind, readonly SheetRect[]>
  /** Light falloff on the two faces the camera sees, 1 = unshaded. */
  shade: { left: number; right: number }
  /**
   * Catalog ids of the objects that suit this look, offered first when dressing
   * its rooms. Any object can still go in any room.
   */
  objects: readonly string[]
}

/** A row of equal cells, starting `from` cells in from the sheet's left edge. */
export function cells(y: number, w: number, h: number, count: number, from = 0): SheetRect[] {
  return Array.from({ length: count }, (_, i) => ({ x: (from + i) * w, y, w, h }))
}

/**
 * Which art a tile shows: its cell within its room, plus that room's seed, so
 * every room is shuffled differently yet keeps its look when redrawn or moved.
 */
export interface Variant {
  x: number
  y: number
  seed: number
}

/** A stable 32-bit seed from an id (FNV-1a). */
export function seedFor(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Chooses one of `count` variants, stable for the same inputs. */
export function variantAt(variant: Variant, count: number, salt = 0): number {
  if (count <= 1) return 0
  let n = Math.imul(variant.x, 374761393) ^ Math.imul(variant.y, 668265263)
  n ^= Math.imul(variant.seed ^ Math.imul(salt + 1, 0x9e3779b1), 1442695041)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b)
  return ((n ^ (n >>> 13)) >>> 0) % count
}
