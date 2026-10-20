import { ASSET_SRC } from './notes.ts'

/**
 * World maps are the campaign's flat overview pictures: a continent, a kingdom, a
 * region. Unlike battle maps they're one image, seen from above, that the DM marks
 * up with pins, labels and routes; a pin can lead to one of the campaign's
 * battle maps. Like notes they're kept by the campaign beside its maps (see
 * worker/room.ts), and the table only ever gets `playerView` of one.
 *
 * Positions are in the picture's own pixels, so marks stay put however it's zoomed.
 */

/** The little picture in a pin's head. */
export type PinGlyph = 'dot' | 'town' | 'castle' | 'dungeon' | 'camp' | 'danger' | 'star'

export const PIN_GLYPHS: ReadonlyArray<{ id: PinGlyph; label: string }> = [
  { id: 'dot', label: 'Place' },
  { id: 'town', label: 'Town' },
  { id: 'castle', label: 'Castle' },
  { id: 'dungeon', label: 'Dungeon' },
  { id: 'camp', label: 'Camp' },
  { id: 'danger', label: 'Danger' },
  { id: 'star', label: 'Point of interest' },
]

/** Pin and route colours: readable over both parchment and dark maps. */
export const WORLD_COLORS = ['#e3bf6a', '#d9625e', '#6fb58a', '#6bb0d6', '#b48ad9', '#ece7da', '#2a2622'] as const

export type LabelSize = 's' | 'm' | 'l'

/** A label's letter height, as a share of the picture's longer side. */
export const LABEL_SCALE: Record<LabelSize, number> = { s: 0.012, m: 0.02, l: 0.034 }

export interface WorldImage {
  /** The campaign's own upload. */
  src: string
  width: number
  height: number
}

export interface WorldPin {
  id: string
  x: number
  y: number
  name: string
  glyph: PinGlyph
  color: string
  /** What the table reads when they open the pin. */
  text: string
  /** The DM's own notes on the place; never sent to players. */
  secret: string
  /** The battle map this place leads to, if any. */
  mapId: string | null
  /** Kept from players until the DM reveals it. */
  hidden: boolean
}

export interface WorldLabel {
  id: string
  x: number
  y: number
  text: string
  size: LabelSize
  hidden: boolean
}

export interface WorldRoute {
  id: string
  /** At least two, in order. */
  points: [number, number][]
  color: string
  dashed: boolean
  hidden: boolean
}

export interface World {
  id: string
  name: string
  image: WorldImage
  pins: WorldPin[]
  labels: WorldLabel[]
  routes: WorldRoute[]
  createdAt: number
  updatedAt: number
}

export type WorldMark = { kind: 'pin' | 'label' | 'route'; id: string }

export const MAX_WORLDS = 30
const MAX_PINS = 300
const MAX_LABELS = 300
const MAX_ROUTES = 100
const MAX_POINTS = 400
const MAX_NAME = 80
const MAX_PIN_NAME = 80
const MAX_TEXT = 4000
const MAX_LABEL = 80
const MAX_ID = 64
const MAX_SIDE = 16_384
/** A world's JSON is at most this long, well under a storage row. */
export const MAX_WORLD_CHARS = 600_000

const COLOR = /^#[0-9a-f]{6}$/i

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value && value.length <= MAX_ID ? value : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A spot on the picture, kept on it and rounded to a tenth of a pixel. */
function coord(value: unknown, max: number): number | null {
  const n = finite(value)
  return n === null ? null : Math.round(Math.min(max, Math.max(0, n)) * 10) / 10
}

function color(value: unknown): string {
  return typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : WORLD_COLORS[0]
}

function normalizeImage(raw: unknown): WorldImage | null {
  if (!raw || typeof raw !== 'object') return null
  const image = raw as Record<string, unknown>
  const width = finite(image.width)
  const height = finite(image.height)
  if (typeof image.src !== 'string' || !ASSET_SRC.test(image.src) || !width || !height) return null
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return null
  return { src: image.src, width: Math.round(width), height: Math.round(height) }
}

function list<T extends { id: string }>(raw: unknown, max: number, each: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  const seen = new Set<string>()
  for (const item of raw.slice(0, max)) {
    if (!item || typeof item !== 'object') continue
    const parsed = each(item as Record<string, unknown>)
    const key = parsed?.id
    if (!parsed || !key || seen.has(key)) continue
    seen.add(key)
    out.push(parsed)
  }
  return out
}

/** A world map as saved or sent, checked over; null if it isn't one. */
export function normalizeWorld(raw: unknown): World | null {
  if (!raw || typeof raw !== 'object') return null
  const world = raw as Record<string, unknown>
  const worldId = id(world.id)
  const image = normalizeImage(world.image)
  if (!worldId || !image) return null
  const { width, height } = image
  const glyphs = new Set<string>(PIN_GLYPHS.map((glyph) => glyph.id))
  const now = Date.now()

  const pins = list(world.pins, MAX_PINS, (pin): WorldPin | null => {
    const pinId = id(pin.id)
    const x = coord(pin.x, width)
    const y = coord(pin.y, height)
    if (!pinId || x === null || y === null) return null
    return {
      id: pinId,
      x,
      y,
      name: text(pin.name, MAX_PIN_NAME),
      glyph: typeof pin.glyph === 'string' && glyphs.has(pin.glyph) ? (pin.glyph as PinGlyph) : 'dot',
      color: color(pin.color),
      text: text(pin.text, MAX_TEXT),
      secret: text(pin.secret, MAX_TEXT),
      mapId: id(pin.mapId),
      hidden: pin.hidden === true,
    }
  })

  const labels = list(world.labels, MAX_LABELS, (label): WorldLabel | null => {
    const labelId = id(label.id)
    const x = coord(label.x, width)
    const y = coord(label.y, height)
    if (!labelId || x === null || y === null) return null
    const size = label.size === 's' || label.size === 'l' ? label.size : 'm'
    return { id: labelId, x, y, text: text(label.text, MAX_LABEL), size, hidden: label.hidden === true }
  })

  const routes = list(world.routes, MAX_ROUTES, (route): WorldRoute | null => {
    const routeId = id(route.id)
    if (!routeId || !Array.isArray(route.points)) return null
    const points: [number, number][] = []
    for (const point of route.points.slice(0, MAX_POINTS)) {
      if (!Array.isArray(point)) continue
      const x = coord(point[0], width)
      const y = coord(point[1], height)
      if (x !== null && y !== null) points.push([x, y])
    }
    if (points.length < 2) return null
    return { id: routeId, points, color: color(route.color), dashed: route.dashed === true, hidden: route.hidden === true }
  })

  return {
    id: worldId,
    name: text(world.name, MAX_NAME).trim() || 'World map',
    image,
    pins,
    labels,
    routes,
    createdAt: Math.round(finite(world.createdAt) ?? now),
    updatedAt: Math.round(finite(world.updatedAt) ?? now),
  }
}

/** What the table sees of a world map: nothing hidden, and none of the DM's own notes. */
export function playerView(world: World): World {
  return {
    ...world,
    pins: world.pins.filter((pin) => !pin.hidden).map((pin) => ({ ...pin, secret: '' })),
    labels: world.labels.filter((label) => !label.hidden),
    routes: world.routes.filter((route) => !route.hidden),
  }
}

export function blankWorld(name: string, image: WorldImage): World {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, MAX_NAME) || 'World map',
    image,
    pins: [],
    labels: [],
    routes: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function markId(): string {
  return crypto.randomUUID().slice(0, 12)
}

export function pinName(pin: Pick<WorldPin, 'name'>): string {
  return pin.name.trim() || 'Unnamed place'
}
