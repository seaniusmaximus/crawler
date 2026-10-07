/**
 * What objects are made of, and helpers for building them. Shapes sit in the
 * object's own footprint: `x` runs 0..w and `y` runs 0..d in cells, with +y
 * the object's front (a chair faces +y), so its back (y = 0) is the side to
 * set against a wall. `z` and `h` are in world pixels above the floor; a
 * wall is 20 tall, a table top about 18, and a cell about 45 across.
 */

export type ObjectPart = (
  | { shape: 'box'; x: number; y: number; w: number; d: number; z: number; h: number; color: string; top?: string }
  /** Round in plan; `r2` narrows the top to a cone, 0 for a point. */
  | { shape: 'round'; x: number; y: number; r: number; r2?: number; z: number; h: number; color: string; top?: string }
  /** Lies flat on the floor, under anything standing on it. */
  | { shape: 'flat'; x: number; y: number; w: number; d: number; color: string; border?: string }
) & {
  /** What the object editor calls this part ("Seat", "Leg"); never drawn. */
  label?: string
  /** Gives off light: a soft glow of its colour on the map, for flames, embers, lava and magic. */
  glow?: boolean
}

export interface ObjectDef {
  id: string
  name: string
  /** Footprint across, in cells, before turning. */
  w: number
  /** Footprint deep, in cells, before turning. */
  d: number
  parts: readonly ObjectPart[]
}

// ---------- Shape helpers ----------

export function box(x: number, y: number, w: number, d: number, z: number, h: number, color: string, top?: string): ObjectPart {
  return { shape: 'box', x, y, w, d, z, h, color, top }
}

export function round(x: number, y: number, r: number, z: number, h: number, color: string, top?: string, r2?: number): ObjectPart {
  return { shape: 'round', x, y, r, r2, z, h, color, top }
}

export function flat(x: number, y: number, w: number, d: number, color: string, border?: string): ObjectPart {
  return { shape: 'flat', x, y, w, d, color, border }
}

/** Four square legs under the corners of a rectangle. */
export function legs(x0: number, y0: number, x1: number, y1: number, h: number, color: string, s = 0.08): ObjectPart[] {
  return [
    box(x0, y0, s, s, 0, h, color),
    box(x1 - s, y0, s, s, 0, h, color),
    box(x0, y1 - s, s, s, 0, h, color),
    box(x1 - s, y1 - s, s, s, 0, h, color),
  ]
}

/** A rug: a border band with the field laid inside it. */
export function rug(w: number, d: number, field: string, border: string, inset = 0.08): ObjectPart[] {
  return [flat(inset, inset, w - inset * 2, d - inset * 2, field, border)]
}

/** The part, giving off light. */
export function lit(part: ObjectPart): ObjectPart {
  return { ...part, glow: true }
}

/** Every part, giving off light. */
export function allLit(parts: ObjectPart[]): ObjectPart[] {
  return parts.map(lit)
}

/** World pixels along one cell's edge, for shapes as tall as they are wide. */
export const CELL_HEIGHT = 45.25

/** A round narrowing to a point: a flame, a spike, a tent. */
export function cone(x: number, y: number, r: number, z: number, h: number, color: string, tip?: string): ObjectPart {
  return round(x, y, r, z, h, color, tip ?? color, 0)
}

/** A round point-down, hanging from `top`: a stalactite, an icicle. */
export function hangingCone(x: number, y: number, r: number, top: number, h: number, color: string, cap?: string): ObjectPart {
  return round(x, y, 0, top - h, h, color, cap ?? color, r)
}

/** A ball of radius `r` cells resting on `z`, three rounds swelling out and back in. */
export function ball(x: number, y: number, r: number, z: number, color: string, top?: string, glow = false): ObjectPart[] {
  const height = r * 2 * CELL_HEIGHT
  const cap = height * 0.28
  const middle = height - cap * 2
  return [
    round(x, y, r * 0.6, z, cap, color, color, r),
    { ...round(x, y, r, z + cap, middle, color), ...(glow ? { glow: true } : {}) },
    round(x, y, r, z + cap + middle, cap, color, top ?? color, r * 0.6),
  ]
}

/** A cut gem: a narrow foot widening to the girdle, then a point. */
export function gem(x: number, y: number, r: number, z: number, h: number, color: string, shine?: string): ObjectPart[] {
  return [round(x, y, r * 0.2, z, h * 0.42, color, color, r), cone(x, y, r, z + h * 0.42, h * 0.58, shine ?? color)]
}
