import { CUSTOM_PREFIX, type ObjectDef, type ObjectPart } from './catalog.ts'

/**
 * Objects a DM builds in the object editor, kept in their Custom objects
 * collection. They are made of the same shapes as the catalog's, and a map
 * keeps a copy of each one placed on it, so they draw, turn, scale and travel
 * to players exactly as the catalog's own do.
 */

/** Largest footprint side, in cells, before the object is scaled. */
export const MAX_CUSTOM_SIZE = 4
/** Highest any part may reach, in world pixels: a little over two walls. */
export const MAX_CUSTOM_HEIGHT = 60
/** Smallest a part may be across, in cells, so it never vanishes. */
export const MIN_PART_SIZE = 0.02
export const MAX_CUSTOM_PARTS = 40
export const MAX_NAME_LENGTH = 32
export const MAX_LABEL_LENGTH = 24
/** Most objects one DM's collection holds. */
export const MAX_LIBRARY_OBJECTS = 500

const HEX = /^#[0-9a-f]{6}$/i
const FALLBACK_COLOR = '#8a8a90'

export function newCustomId(): string {
  return `${CUSTOM_PREFIX}${crypto.randomUUID()}`
}

/** A fresh object to start from: one crate-sized box. */
export function blankObject(): ObjectDef {
  return {
    id: newCustomId(),
    name: 'New object',
    w: 1,
    d: 1,
    parts: [{ shape: 'box', x: 0.2, y: 0.2, w: 0.6, d: 0.6, z: 0, h: 14, color: '#8c6a40', top: '#a17d4f' }],
  }
}

/** Any object, catalog or custom, copied under a new id to be changed. */
export function copyObject(def: ObjectDef, name = `${def.name} copy`): ObjectDef {
  return { ...def, id: newCustomId(), name, parts: def.parts.map((part) => ({ ...part })) }
}

/** A part to add: a small box in the middle of the footprint. */
export function newPart(def: Pick<ObjectDef, 'w' | 'd'>): ObjectPart {
  return { shape: 'box', x: def.w / 2 - 0.15, y: def.d / 2 - 0.15, w: 0.3, d: 0.3, z: 0, h: 10, color: '#7a5232', top: '#93653f' }
}

/**
 * A part changed to another shape, standing where it did: a box becomes the
 * round that fits inside it, and a round becomes the box around it.
 */
export function reshapePart(part: ObjectPart, shape: ObjectPart['shape']): ObjectPart {
  if (part.shape === shape) return part
  const bounds =
    part.shape === 'round'
      ? { x: part.x - part.r, y: part.y - part.r, w: part.r * 2, d: part.r * 2 }
      : { x: part.x, y: part.y, w: part.w, d: part.d }
  const z = part.shape === 'flat' ? 0 : part.z
  const h = part.shape === 'flat' ? 10 : part.h
  const top = part.shape === 'flat' ? undefined : part.top
  if (shape === 'round') {
    const r = Math.min(bounds.w, bounds.d) / 2
    return { shape, x: bounds.x + bounds.w / 2, y: bounds.y + bounds.d / 2, r, z, h, color: part.color, top }
  }
  if (shape === 'flat') return { shape, ...bounds, color: part.color }
  return { shape, ...bounds, z, h, color: part.color, top }
}

/**
 * An object made safe to store: a name, a footprint within limits, and every
 * part held inside the footprint and below the height limit with real colours.
 * Null when it has no parts left.
 */
export function cleanObject(def: ObjectDef): ObjectDef | null {
  const w = clampInt(def.w, 1, MAX_CUSTOM_SIZE)
  const d = clampInt(def.d, 1, MAX_CUSTOM_SIZE)
  const parts = def.parts
    .slice(0, MAX_CUSTOM_PARTS)
    .map((part) => ({ ...cleanPart(part, w, d), ...cleanLabel(part.label), ...(part.glow ? { glow: true } : {}) }))
  if (parts.length === 0) return null
  const name = def.name.trim().slice(0, MAX_NAME_LENGTH) || 'Custom object'
  return { id: def.id, name, w, d, parts }
}

/**
 * An object read from somewhere untrusted (the network, browser storage),
 * checked for shape and then cleaned; null when it isn't one.
 */
export function parseObject(value: unknown): ObjectDef | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !CUSTOM_ID.test(raw.id) || !Array.isArray(raw.parts)) return null
  const parts: ObjectPart[] = []
  for (const item of raw.parts) {
    const part = parsePart(item)
    if (!part) return null
    const { label, glow } = item as { label?: unknown; glow?: unknown }
    parts.push({ ...part, ...(typeof label === 'string' ? { label } : {}), ...(glow === true ? { glow: true } : {}) })
  }
  return cleanObject({
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    w: num(raw.w),
    d: num(raw.d),
    parts,
  })
}

const CUSTOM_ID = new RegExp(`^${CUSTOM_PREFIX}[0-9a-f-]{36}$`)

function parsePart(value: unknown): ObjectPart | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const color = typeof raw.color === 'string' ? raw.color : ''
  const optional = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : undefined)
  if (raw.shape === 'box') {
    return { shape: 'box', x: num(raw.x), y: num(raw.y), w: num(raw.w), d: num(raw.d), z: num(raw.z), h: num(raw.h), color, top: optional('top') }
  }
  if (raw.shape === 'round') {
    const r2 = raw.r2 === undefined ? undefined : num(raw.r2)
    return { shape: 'round', x: num(raw.x), y: num(raw.y), r: num(raw.r), r2, z: num(raw.z), h: num(raw.h), color, top: optional('top') }
  }
  if (raw.shape === 'flat') {
    return { shape: 'flat', x: num(raw.x), y: num(raw.y), w: num(raw.w), d: num(raw.d), color, border: optional('border') }
  }
  return null
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN
}

function cleanPart(part: ObjectPart, fw: number, fd: number): ObjectPart {
  const color = cleanColor(part.color)
  if (part.shape === 'round') {
    const r = clamp(part.r, MIN_PART_SIZE / 2, Math.min(fw, fd) / 2)
    const r2 = part.r2 === undefined ? undefined : clamp(part.r2, 0, Math.min(fw, fd) / 2)
    const { z, h } = cleanHeight(part.z, part.h)
    return {
      shape: 'round',
      x: round2(clamp(part.x, r, fw - r)),
      y: round2(clamp(part.y, r, fd - r)),
      r: round2(r),
      ...(r2 !== undefined && r2 !== r ? { r2: round2(r2) } : {}),
      z,
      h,
      color,
      ...(part.top && part.top !== part.color ? { top: cleanColor(part.top) } : {}),
    }
  }
  const w = clamp(part.w, MIN_PART_SIZE, fw)
  const d = clamp(part.d, MIN_PART_SIZE, fd)
  const x = round2(clamp(part.x, 0, fw - w))
  const y = round2(clamp(part.y, 0, fd - d))
  if (part.shape === 'flat') {
    return { shape: 'flat', x, y, w: round2(w), d: round2(d), color, ...(part.border ? { border: cleanColor(part.border) } : {}) }
  }
  const { z, h } = cleanHeight(part.z, part.h)
  return {
    shape: 'box',
    x,
    y,
    w: round2(w),
    d: round2(d),
    z,
    h,
    color,
    ...(part.top && part.top !== part.color ? { top: cleanColor(part.top) } : {}),
  }
}

function cleanLabel(label: string | undefined): { label?: string } {
  const text = label?.trim().slice(0, MAX_LABEL_LENGTH)
  return text ? { label: text } : {}
}

function cleanHeight(z: number, h: number): { z: number; h: number } {
  const bottom = clampInt(z, 0, MAX_CUSTOM_HEIGHT - 1)
  return { z: bottom, h: clampInt(h, 1, MAX_CUSTOM_HEIGHT - bottom) }
}

function cleanColor(color: string | undefined): string {
  return color && HEX.test(color) ? color.toLowerCase() : FALLBACK_COLOR
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
