import {
  characterNameOf,
  occupantRoom,
  playerAirFeet,
  playerCenter,
  playerHover,
  playerInitials,
  playerSize,
  playerStatuses,
} from '../model/players.ts'
import { statusEffect } from '../model/status.ts'
import type { StatusId } from '../model/status.ts'
import { sameLink } from '../model/links.ts'
import { roomCells, roomContains } from '../model/rect.ts'
import { rampFlight, rampOccupancy } from '../model/ramps.ts'
import type { RampDraft, RampSlice } from '../model/ramps.ts'
import { openingGroup } from '../model/openings.ts'
import type { OpeningGroup } from '../model/openings.ts'
import { cellId, openingAt, openingIsLocked, openingIsOpen, parseCellKey, spriteAt, stairsAt } from '../model/tiles.ts'
import { stairsRegion, wallCells, wallPaintCells } from '../model/tools.ts'
import { sharedWalls } from '../model/walls.ts'
import type { SharedWalls } from '../model/walls.ts'
import type { FeatureDraft, FeatureTool } from '../model/tools.ts'
import type { Camera, Cell, CellRect, Edge, ElevationRamp, Link, Player, Room, StairsBlock, TileSprite } from '../model/types.ts'
import { playerRooms, roomExplored, roomShade } from '../model/visibility.ts'
import type { ViewMode } from '../model/visibility.ts'
import type { TileCache } from '../tiles/TileCache.ts'
import { seedFor, type FaceKind, type Variant } from '../tiles/tileset.ts'
import type { LinkBadge } from './badges.ts'
import type { ObjectDraft } from '../model/objects.ts'
import { DETAIL_ZOOM } from './solids.ts'
import {
  drawGlowPool,
  drawPiece,
  drawWholeObject,
  objectTop,
  roomGlows,
  roomObjectPieces,
  type GlowSource,
  type ObjectLight,
  type ObjectPiece,
} from './objects.ts'
import {
  TILE_HEIGHT,
  TILE_WIDTH,
  WALL_HEIGHT,
  cellCenter,
  cellCorners,
  cellToScreen,
  isoDepth,
  lift,
  liftCorners,
  rectCorners,
  roomLift,
  screenCorners,
  screenToCell,
  type IsoCorners,
  type Point,
} from './camera.ts'
import { HANDLE_SIZE, handleSpots } from './handles.ts'
import {
  cellElevation,
  playerGroundCenterAt,
  playerTokenCenterAt,
  tokenCenter,
  tokenEllipse,
  tokenStandee,
} from './pick.ts'

const HOVER = '#e5484d'
const ACCENT = '#e8c468'
const SELECT = '#78d39b'
const LINK = '#78d39b'
const MEASURE = '#f4f1ea'

const TOOL_TINT: Record<FeatureTool, string> = {
  doors: '#e09a4a',
  windows: '#6bb0d6',
  stairs: '#d8cba0',
  walls: '#8b8f9c',
}

export interface DrawView {
  width: number
  height: number
  camera: Camera
  rooms: readonly Room[]
  selectedRoomId: string | null
  hoverRoomId: string | null
  resizeRoomId: string | null
  linkRoomId: string | null
  draft: CellRect | null
  feature: FeatureDraft | null
  badges: readonly LinkBadge[]
  hoverLink: Link | null
  ramps: readonly ElevationRamp[]
  rampDraft: RampDraft | null
  players: readonly Player[]
  selectedPlayerId: string | null
  hoverPlayerId: string | null
  portraits: ReadonlyMap<string, CanvasImageSource>
  /** One per token being moved, by anyone at the table. */
  movePaths: readonly { playerId: string; cells: readonly Cell[]; feet: number }[]
  ghosts: readonly { player: Player; x: number; y: number }[]
  tokenPoses: readonly { playerId: string; x: number; y: number; tilt: number }[]
  turnPlayerId: string | null
  viewMode: ViewMode
  /** Explored rooms the party can see into now; the rest of the explored ones draw greyed out for players. */
  sight: ReadonlySet<string>
  /** Tokens players can't see now, drawn faded for the DM. */
  unseen: ReadonlySet<string>
  /** A word over a door for a moment, such as why it would not open. */
  notice: { x: number; y: number; text: string } | null
  /** The object the Objects tool would place, or one being moved, drawn as a ghost. */
  objectDraft: ObjectDraft | null
  /** Object footprints to outline: the one picked, and the one under the pointer with the Objects tool. */
  objectFocus: readonly { rect: CellRect; elevation: number; selected: boolean }[]
  /** The map's tiles. */
  tileCache: TileCache
  /** The tiles one room draws with, when it has a tileset of its own. */
  tilesFor?: (room: Room) => TileCache
}

/**
 * How a room's tiles are toned: the DM sees rooms players haven't explored
 * faded; players see explored rooms they can't see into now greyed out.
 */
type Shade = 'none' | 'dim' | 'fog'

function shadeOf(view: DrawView, room: Room | undefined): Shade {
  if (!room) return 'none'
  if (view.viewMode === 'dm') return roomExplored(room) ? 'none' : 'dim'
  return roomShade(room, view.sight) === 'fog' ? 'fog' : 'none'
}

/**
 * Tone whatever `paint` draws by its room's shade. A greyed-out room already
 * draws with greyed tiles (see `roomView`); it only fades if those weren't made.
 * Plain alpha, never a canvas filter: this runs for every tile, every frame.
 */
function shaded(ctx: CanvasRenderingContext2D, shade: Shade, tiles: TileCache, paint: () => void): void {
  const alpha = shade === 'dim' ? 0.42 : shade === 'fog' && !tiles.isFog ? 0.45 : 1
  if (alpha === 1) {
    paint()
    return
  }
  ctx.globalAlpha = alpha
  paint()
  ctx.globalAlpha = 1
}

/** The view as one room draws itself: with its own tiles when they differ from the map's, greyed when out of sight. */
function roomView(view: DrawView, room: Room | undefined, shade: Shade = 'none'): DrawView {
  const own = room && view.tilesFor ? view.tilesFor(room) : view.tileCache
  const tileCache = shade === 'fog' ? (own.fogged() ?? own) : own
  return tileCache === view.tileCache ? view : { ...view, tileCache }
}

/** The map's empty ground, under the grid. */
export const GROUND = '#0b0c10'

/** How far a glowing part's halo spreads around its flame, in pixels at zoom 1, and a little over. */
const HALO_REACH = 70

/**
 * What painting the scene needs to know about the whole floor. It doesn't
 * depend on the camera's position or zoom, so it's worked out once and shared
 * by every piece of the map painted until the map changes (see SceneCache).
 */
export interface ScenePrep {
  /** The rooms this view shows, in paint order. */
  shown: readonly Room[]
  shared: SharedWalls
  /** Highest room on each cell, by `cellId`. */
  top: Map<number, number>
  rampCells: Map<number, RampSlice>
  raised: RaisedCells
  lights: Map<number, { glow: GlowSource; elevation: number }[]>
  /**
   * How far what's painted for a cell can reach past where its floor would sit
   * on flat ground, in pixels at zoom 1: up for raised floors, walls, objects
   * and halos; down for sunken floors and the stone under raised ones; and
   * sideways for halos.
   */
  reach: { up: number; down: number; side: number }
}

export function prepareScene(view: DrawView): ScenePrep {
  const shown = view.viewMode === 'player' ? playerRooms(view.rooms) : view.rooms
  const top = topRoomAtCell(shown)
  const ramps = visibleRamps(view)
  const rampCells = new Map<number, RampSlice>()
  for (const slice of rampOccupancy(ramps, shown).values()) {
    const room = view.viewMode === 'player' ? occupantRoom(view.rooms, slice.x, slice.y) : undefined
    if (!room || roomExplored(room)) rampCells.set(cellId(slice.x, slice.y), slice)
  }
  let rise = 0
  let sink = 0
  for (const room of shown) {
    const elevation = room.elevation ?? 0
    let tallest = WALL_HEIGHT
    for (const object of room.objects ?? []) tallest = Math.max(tallest, objectTop(object))
    rise = Math.max(rise, roomLift(elevation) + tallest)
    sink = Math.max(sink, -roomLift(elevation))
  }
  for (const ramp of ramps) {
    rise = Math.max(rise, roomLift(Math.max(ramp.fromElev, ramp.toElev)) + WALL_HEIGHT)
    sink = Math.max(sink, -roomLift(Math.min(ramp.fromElev, ramp.toElev)))
  }
  const painted: DrawView = { ...view, rooms: shown }
  return {
    shown,
    shared: sharedWalls(shown),
    top,
    rampCells,
    raised: raisedCells(painted, top, rampCells),
    lights: floorLights(painted),
    reach: { up: rise + HALO_REACH, down: sink + HALO_REACH, side: HALO_REACH },
  }
}

/**
 * The map under its overlays: the grid, the rooms and everything in them. It
 * depends only on the floor, the camera, the view mode, what the party can see
 * and the tiles, so it can be painted once and kept (see SceneCache).
 */
export function drawScene(ctx: CanvasRenderingContext2D, view: DrawView, prep: ScenePrep = prepareScene(view)): void {
  ctx.clearRect(0, 0, view.width, view.height)
  ctx.fillStyle = GROUND
  ctx.fillRect(0, 0, view.width, view.height)

  const bounds = visibleCellBounds(view, prep.reach)
  drawGrid(ctx, view, bounds)

  const painted: DrawView = { ...view, rooms: prep.shown }
  drawSupports(ctx, painted, bounds, prep.top, prep.rampCells)
  drawTiles(ctx, painted, bounds, prep)
  if (view.viewMode === 'dm') drawLocks(ctx, painted)
}

/** Everything drawn over the scene each frame: outlines, badges, paths, tokens and previews. */
export function drawOverlays(ctx: CanvasRenderingContext2D, view: DrawView): void {
  const painted: DrawView = { ...view, rooms: view.viewMode === 'player' ? playerRooms(view.rooms) : view.rooms }
  for (const focus of view.objectFocus) drawObjectFocus(ctx, view, focus)

  const selected =
    view.viewMode === 'player' ? undefined : painted.rooms.find((room) => room.id === view.selectedRoomId)
  if (selected && selected.id !== view.hoverRoomId && selected.id !== view.linkRoomId) {
    outlineRoom(ctx, painted, selected, SELECT, 1.5)
  }

  const linking = painted.rooms.find((room) => room.id === view.linkRoomId)
  if (linking && linking.id !== view.hoverRoomId) {
    outlineRoom(ctx, painted, linking, LINK, 2)
  }

  const hovered =
    view.viewMode === 'player' ? undefined : painted.rooms.find((room) => room.id === view.hoverRoomId)
  if (hovered) {
    const color = view.linkRoomId && hovered.id !== view.linkRoomId ? LINK : SELECT
    outlineRoom(ctx, painted, hovered, color, 2)
    drawRoomLabel(ctx, painted, hovered)
  }

  if (linking && hovered && hovered.id !== linking.id) {
    drawLinkPreview(ctx, painted, linking, hovered)
  }

  const resizing = painted.rooms.find((room) => room.id === view.resizeRoomId)
  if (resizing) drawResizeHandles(ctx, painted, resizing)

  for (const badge of view.badges) {
    drawLinkBadge(ctx, badge, view.hoverLink ? sameLink(view.hoverLink, badge.link) : false)
  }

  drawMovePath(ctx, view)
  drawTokens(ctx, view)

  if (view.objectDraft) drawObjectDraft(ctx, view, view.objectDraft)
  if (view.feature) drawFeaturePreview(ctx, view, view.feature)
  if (view.rampDraft) drawRampPreview(ctx, view, view.rampDraft)
  if (view.draft) drawDraft(ctx, view, view.draft)
  if (view.notice) drawDoorNotice(ctx, painted, view.notice)
}

/**
 * The cells whose painting can reach into the view: the view's rectangle grown
 * by how far painted things reach from their cells (see `ScenePrep`), so a tall
 * object standing just below the view still shows its top in it.
 */
function visibleCellBounds(view: DrawView, reach: ScenePrep['reach']): CellRect {
  const zoom = view.camera.zoom
  // Things rising up the screen come from cells below the view; sinking ones from above it.
  const left = -reach.side * zoom
  const right = view.width + reach.side * zoom
  const above = -reach.down * zoom
  const below = view.height + reach.up * zoom
  const corners = [
    screenToCell(left, above, view.camera),
    screenToCell(right, above, view.camera),
    screenToCell(left, below, view.camera),
    screenToCell(right, below, view.camera),
  ]
  const xs = corners.map((cell) => cell.x)
  const ys = corners.map((cell) => cell.y)
  return {
    minX: Math.min(...xs) - 1,
    minY: Math.min(...ys) - 1,
    maxX: Math.max(...xs) + 1,
    maxY: Math.max(...ys) + 1,
  }
}

/** Highest room on each cell — overlapping lower floors must not paint there. */
function topRoomAtCell(rooms: readonly Room[]): Map<number, number> {
  const top = new Map<number, number>()
  rooms.forEach((room, index) => {
    const elevation = room.elevation ?? 0
    const rect = room.rect
    for (let y = rect.minY; y <= rect.maxY; y++) {
      for (let x = rect.minX; x <= rect.maxX; x++) {
        if (!roomContains(room, x, y)) continue
        const key = cellId(x, y)
        const prev = top.get(key)
        if (prev === undefined) {
          top.set(key, index)
          continue
        }
        const earlier = rooms[prev]
        const earlierElev = earlier.elevation ?? 0
        if (elevation > earlierElev || (elevation === earlierElev && index > prev)) {
          top.set(key, index)
        }
      }
    }
  })
  return top
}

function visibleRamps(view: DrawView): ElevationRamp[] {
  const ramps = [...(view.ramps ?? [])]
  const draft = view.rampDraft
  if (draft?.ramp && !draft.erase) {
    ramps.push({ ...draft.ramp, id: 'preview' })
  }
  return ramps
}

const ORTHO: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Empty grid sits on the ground plane (elevation 0). */
function elevationAt(
  rooms: readonly Room[],
  top: Map<number, number>,
  x: number,
  y: number,
): number {
  const index = top.get(cellId(x, y))
  if (index === undefined) return 0
  return rooms[index].elevation ?? 0
}

/**
 * How far under this cell the solid should reach: the ground plane for a
 * raised room, or the floor of a lower neighbour (a pit) when one is adjacent.
 */
function supportBottom(
  rooms: readonly Room[],
  top: Map<number, number>,
  x: number,
  y: number,
  elevation: number,
): number {
  let bottom = Math.min(elevation, 0)
  for (const [dx, dy] of ORTHO) {
    const next = elevationAt(rooms, top, x + dx, y + dy)
    if (next < bottom) bottom = next
  }
  return bottom
}

function drawSupports(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  bounds: CellRect,
  top: Map<number, number>,
  rampCells: Map<number, RampSlice>,
): void {
  const cells: {
    x: number
    y: number
    hideFace: (nx: number, ny: number) => boolean
    bottom: number
    elevation: number
    depth: number
    shade: Shade
    view: DrawView
  }[] = []
  view.rooms.forEach((room, roomIndex) => {
    const elevation = room.elevation ?? 0
    const rect = room.rect
    // Off screen is skipped: the bounds already reach far enough for the tallest prism.
    const minX = Math.max(rect.minX, bounds.minX)
    const maxX = Math.min(rect.maxX, bounds.maxX)
    const minY = Math.max(rect.minY, bounds.minY)
    const maxY = Math.min(rect.maxY, bounds.maxY)
    if (minX > maxX || minY > maxY) return
    const shade = shadeOf(view, room)
    const own = roomView(view, room, shade)
    const hideFace = (nx: number, ny: number) =>
      roomContains(room, nx, ny) || elevationAt(view.rooms, top, nx, ny) >= elevation
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (top.get(cellId(x, y)) !== roomIndex) continue
        if (rampCells.has(cellId(x, y))) continue
        const bottom = supportBottom(view.rooms, top, x, y, elevation)
        if (elevation <= bottom) continue
        cells.push({
          x,
          y,
          bottom,
          elevation,
          depth: isoDepth(x, y, view.camera.yaw),
          shade,
          view: own,
          hideFace,
        })
      }
    }
  })
  cells.sort((a, b) => a.depth - b.depth || a.elevation - b.elevation)
  for (const cell of cells) {
    shaded(ctx, cell.shade, cell.view.tileCache, () =>
      drawSupportPrism(ctx, cell.view, cell.x, cell.y, cell.bottom, cell.elevation, cell.hideFace),
    )
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, view: DrawView, bounds: CellRect): void {
  if (TILE_HEIGHT * view.camera.zoom < 8) return

  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)'
  strokeIsoGrid(ctx, view, bounds, 1)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  strokeIsoGrid(ctx, view, bounds, 10)
}

function strokeIsoGrid(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  bounds: CellRect,
  step: number,
): void {
  ctx.beginPath()
  const startX = Math.floor(bounds.minX / step) * step
  const startY = Math.floor(bounds.minY / step) * step
  for (let x = startX; x <= bounds.maxX; x += step) {
    const a = cellToScreen(x, bounds.minY, view.camera)
    const b = cellToScreen(x, bounds.maxY + 1, view.camera)
    ctx.moveTo(a.x + 0.5, a.y + 0.5)
    ctx.lineTo(b.x + 0.5, b.y + 0.5)
  }
  for (let y = startY; y <= bounds.maxY; y += step) {
    const a = cellToScreen(bounds.minX, y, view.camera)
    const b = cellToScreen(bounds.maxX + 1, y, view.camera)
    ctx.moveTo(a.x + 0.5, a.y + 0.5)
    ctx.lineTo(b.x + 0.5, b.y + 0.5)
  }
  ctx.stroke()
}

interface QueuedTile {
  depth: number
  elevation: number
  roomIndex: number
  x: number
  y: number
  sprite: TileSprite
  bitmap: ImageBitmap
  variant: Variant
  stairs: StairsBlock | undefined
  /** A cell of stairs between rooms. */
  ramp?: RampSlice
  open: boolean
  /** For a door or window, its place in the run it merges with. */
  group?: OpeningGroup
  shade: Shade
  /** Carries the tiles of the room this tile belongs to. */
  view: DrawView
}

/** A piece of an object, painted after its cell's floor: rugs (layer 1) before furniture (layer 2). */
interface QueuedPiece {
  depth: number
  elevation: number
  roomIndex: number
  x: number
  y: number
  layer: 1 | 2
  piece: ObjectPiece
  shade: Shade
  view: DrawView
}

type Queued = QueuedTile | QueuedPiece

function layerOf(item: Queued): number {
  return 'piece' in item ? item.layer : 0
}

function paintOrder(a: Queued, b: Queued): number {
  return a.depth - b.depth || a.elevation - b.elevation || layerOf(a) - layerOf(b) || a.roomIndex - b.roomIndex
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  bounds: CellRect,
  prep: ScenePrep,
): void {
  const { shared, top, rampCells, lights } = prep
  const queue: Queued[] = []
  const yaw = view.camera.yaw
  view.rooms.forEach((room, roomIndex) => {
    const elevation = room.elevation ?? 0
    const rect = room.rect
    const minX = Math.max(rect.minX, bounds.minX)
    const maxX = Math.min(rect.maxX, bounds.maxX)
    const minY = Math.max(rect.minY, bounds.minY)
    const maxY = Math.min(rect.maxY, bounds.maxY)
    if (minX > maxX || minY > maxY) return
    // Each room shuffles its art by its own id, so rooms of the same size never match.
    const seed = seedFor(room.id)
    const shade = shadeOf(view, room)
    const own = roomView(view, room, shade)
    const pieces = room.objects?.length ? roomObjectPieces(room, view.camera) : null
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (top.get(cellId(x, y)) !== roomIndex) continue
        if (rampCells.has(cellId(x, y))) continue
        const opening = openingAt(room, x, y)
        const planted = opening === 'wall' || opening === 'door' || opening === 'window'
        const sprite = shared.has(room.id, x, y) && !planted ? 'floor' : spriteAt(room, x, y)
        const variant = { x: x - rect.minX, y: y - rect.minY, seed }
        const bitmap = own.tileCache.top(sprite, variant)
        if (!bitmap) continue
        // The bounds reach as far as the tallest thing on the floor; a plain tile reaches only its wall's height.
        if (cellReachesView(view, x, y, elevation)) queue.push({
          x,
          y,
          variant,
          depth: isoDepth(x, y, yaw),
          elevation,
          roomIndex,
          sprite,
          bitmap,
          stairs: stairsAt(room, x, y),
          open: openingIsOpen(room, x, y),
          group: opening === 'door' || opening === 'window' ? openingGroup(room, x, y) : undefined,
          shade,
          view: own,
        })
        // Objects only show where their room's floor does; a wall painted over one hides it.
        const here = sprite === 'floor' ? pieces?.get(cellId(x, y)) : undefined
        for (const piece of here ?? []) {
          queue.push({
            x,
            y,
            depth: isoDepth(x, y, yaw),
            elevation,
            roomIndex,
            layer: piece.shape === 'shadow' || (piece.shape === 'flat' && piece.lift === 0) ? 1 : 2,
            piece,
            shade,
            view: own,
          })
        }
      }
    }
  })
  const stairsBitmap = view.tileCache.top('stairs', { x: 0, y: 0, seed: 0 })
  if (stairsBitmap) {
    for (const slice of rampCells.values()) {
      // Stairs between rooms take the look of the room they stand in.
      const host = occupantRoom(view.rooms, slice.x, slice.y)
      const shade = shadeOf(view, host)
      queue.push({
        x: slice.x,
        y: slice.y,
        depth: isoDepth(slice.x, slice.y, yaw),
        elevation: slice.prevElev,
        roomIndex: view.rooms.length,
        sprite: 'stairs',
        bitmap: stairsBitmap,
        variant: { x: slice.x, y: slice.y, seed: 0 },
        stairs: undefined,
        ramp: slice,
        open: false,
        shade,
        view: roomView(view, host, shade),
      })
    }
  }
  queue.sort(paintOrder)
  const occluders = new Occluders(view, prep.raised)
  const detail = view.camera.zoom >= DETAIL_ZOOM
  ctx.imageSmoothingEnabled = true
  for (const tile of queue) {
    const own = tile.view
    if ('piece' in tile) {
      const light = objectLight(own, tile.shade)
      occluders.under(ctx, tile.x, tile.y, tile.elevation, () =>
        shaded(ctx, tile.shade, own.tileCache, () => drawPiece(ctx, view.camera, tile.piece, tile.elevation, light, detail)),
      )
      continue
    }
    occluders.under(ctx, tile.x, tile.y, tile.elevation, () =>
      shaded(ctx, tile.shade, own.tileCache, () => {
        if (tile.ramp) {
          // Its stone reaches down to the ground, or to a lower neighbour's floor.
          const bottom = Math.min(tile.ramp.ramp.fromElev, supportBottom(view.rooms, top, tile.x, tile.y, tile.ramp.ramp.fromElev))
          drawRampStairs(ctx, own, tile.ramp, bottom, tile.variant)
        } else if (tile.sprite === 'floor' || tile.sprite === 'stairs') {
          drawFloor(ctx, own, tile.x, tile.y, tile.bitmap, tile.elevation)
          for (const light of lights.get(cellId(tile.x, tile.y)) ?? []) {
            if (light.elevation === tile.elevation) drawGlowPool(ctx, view.camera, light.glow, light.elevation, tile)
          }
        } else if (tile.sprite === 'wall') {
          drawWall(ctx, own, tile.x, tile.y, tile.bitmap, tile.elevation, tile.variant)
        } else drawOpening(ctx, own, tile.x, tile.y, tile.sprite, tile.elevation, tile.open, tile.variant, tile.group)
        if (tile.stairs && tile.sprite === 'floor') {
          drawStairs(ctx, own, tile.x, tile.y, tile.stairs, tile.elevation, tile.variant)
        }
      }),
    )
  }
  ctx.imageSmoothingEnabled = false
}

/**
 * Whether a room's tile at (x, y), `elevation` steps up, can show in the view:
 * its floor, and the wall, doorway or stairs standing on it, at most a wall high.
 */
function cellReachesView(view: DrawView, x: number, y: number, elevation: number): boolean {
  const { camera } = view
  const centre = cellCenter(x, y, camera)
  const halfWidth = (TILE_WIDTH / 2) * camera.zoom + 2
  const halfHeight = (TILE_HEIGHT / 2) * camera.zoom + 2
  const floor = centre.y - roomLift(elevation) * camera.zoom
  return (
    centre.x + halfWidth >= 0 &&
    centre.x - halfWidth <= view.width &&
    floor + halfHeight >= 0 &&
    floor - halfHeight - (WALL_HEIGHT + 8) * camera.zoom <= view.height
  )
}

/**
 * The pools of light glowing objects cast, gathered by the floor cells they
 * reach, so each floor tile can be lit as it's painted. A room remembered but
 * out of sight stays dark; light spills only onto floor of the same height.
 */
function floorLights(view: DrawView): Map<number, { glow: GlowSource; elevation: number }[]> {
  const cells = new Map<number, { glow: GlowSource; elevation: number }[]>()
  for (const room of view.rooms) {
    if (!room.objects?.length || shadeOf(view, room) === 'fog') continue
    const elevation = room.elevation ?? 0
    for (const glow of roomGlows(room)) {
      const entry = { glow, elevation }
      for (let y = Math.floor(glow.y - glow.reach); y <= Math.floor(glow.y + glow.reach); y++) {
        for (let x = Math.floor(glow.x - glow.reach); x <= Math.floor(glow.x + glow.reach); x++) {
          const key = cellId(x, y)
          const list = cells.get(key)
          if (list) list.push(entry)
          else cells.set(key, [entry])
        }
      }
    }
  }
  return cells
}

function objectLight(view: DrawView, shade: Shade): ObjectLight {
  const falloff = view.tileCache.tileset.shade
  return { left: falloff.left, right: falloff.right, fog: shade === 'fog' }
}

/** A cell of a raised room standing above its surroundings: a solid that hides lower tiles behind it. */
interface RaisedCell {
  above: number
  bottom: number
  depth: number
}

/** The floor's raised solids by `cellId`, and the highest of them. */
interface RaisedCells {
  cells: Map<number, RaisedCell>
  highest: number
}

function raisedCells(view: DrawView, top: Map<number, number>, rampCells: Map<number, RampSlice>): RaisedCells {
  const cells = new Map<number, RaisedCell>()
  let highest = -Infinity
  const yaw = view.camera.yaw
  view.rooms.forEach((room, roomIndex) => {
    const above = room.elevation ?? 0
    const rect = room.rect
    for (let y = rect.minY; y <= rect.maxY; y++) {
      for (let x = rect.minX; x <= rect.maxX; x++) {
        const id = cellId(x, y)
        if (rampCells.has(id) || top.get(id) !== roomIndex) continue
        const bottom = supportBottom(view.rooms, top, x, y, above)
        if (above <= bottom) continue
        cells.set(id, { above, bottom, depth: isoDepth(x, y, yaw) })
        highest = Math.max(highest, above)
      }
    }
  })
  return { cells, highest }
}

/**
 * The clips that keep lower tiles out of the raised solids in front of them,
 * for one paint, found through the floor's index of raised cells rather than
 * by scanning every room. Each cell and height's clip is kept: a cell's floor
 * and every object piece on it share one.
 */
class Occluders {
  private readonly cells: Map<number, RaisedCell>
  private readonly highest: number
  private readonly clips = new Map<number, Path2D | null>()
  /** Each raised cell's outline on screen, worked out the first time a clip needs it. */
  private readonly outlines = new Map<number, { ground: IsoCorners; deck: IsoCorners }>()
  private readonly view: DrawView

  constructor(view: DrawView, raised: RaisedCells) {
    this.view = view
    this.cells = raised.cells
    this.highest = raised.highest
  }

  /** Paint with lower tiles kept out of any higher room's solid volume in front of them. */
  under(ctx: CanvasRenderingContext2D, x: number, y: number, elevation: number, paint: () => void): void {
    const clip = this.clip(x, y, elevation)
    if (!clip) {
      paint()
      return
    }
    ctx.save()
    ctx.clip(clip, 'evenodd')
    paint()
    ctx.restore()
  }

  private clip(x: number, y: number, elevation: number): Path2D | null {
    if (elevation >= this.highest) return null
    // Heights run -8..8, so 32 slots per cell keeps every cell and height apart.
    const key = cellId(x, y) * 32 + (elevation + 16)
    const known = this.clips.get(key)
    if (known !== undefined) return known
    const { camera } = this.view
    const tileDepth = isoDepth(x, y, camera.yaw)
    const reach = (this.highest - elevation) * 2 + 2
    let path: Path2D | null = null
    for (let cy = y - reach; cy <= y + reach; cy++) {
      for (let cx = x - reach; cx <= x + reach; cx++) {
        const id = cellId(cx, cy)
        const cell = this.cells.get(id)
        if (!cell || cell.above <= elevation) continue
        const span = (cell.above - elevation) * 2 + 2
        if (Math.abs(cx - x) > span || Math.abs(cy - y) > span) continue
        // Only nearer cubes occlude. A raised volume behind this tile must
        // not punch a hole — this tile is in front and should paint over it.
        if (cell.depth <= tileDepth) continue
        let outline = this.outlines.get(id)
        if (!outline) {
          const base = screenCorners(cellCorners(cx, cy, camera))
          outline = { ground: liftCorners(base, camera, roomLift(cell.bottom)), deck: liftCorners(base, camera, roomLift(cell.above)) }
          this.outlines.set(id, outline)
        }
        if (!path) {
          path = new Path2D()
          path.rect(0, 0, this.view.width, this.view.height)
        }
        appendCubePath(path, outline.ground, outline.deck)
      }
    }
    this.clips.set(key, path)
    return path
  }
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  x: number,
  y: number,
  bitmap: ImageBitmap,
  elevation: number,
): void {
  const diamond = liftCorners(cellCorners(x, y, view.camera), view.camera, roomLift(elevation))
  mapBitmap(ctx, bitmap, diamond)
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  x: number,
  y: number,
  bitmap: ImageBitmap,
  elevation: number,
  variant: Variant,
): void {
  const floor = liftCorners(cellCorners(x, y, view.camera), view.camera, roomLift(elevation))
  const top = liftCorners(floor, view.camera, WALL_HEIGHT)
  const [leftFace, rightFace] = visibleWallFaces(floor, top)
  const tiles = view.tileCache
  paintFace(ctx, tiles.face('wall', variant, 0), leftFace, tiles.tileset.shade.left)
  paintFace(ctx, tiles.face('wall', variant, 1), rightFace, tiles.tileset.shade.right)
  mapBitmap(ctx, bitmap, top)
}

/** Where a piece samples its art, as fractions of the texture. */
interface ArtWindow {
  u0: number
  u1: number
  v0: number
  v1: number
}

/**
 * A piece of a doorway or window in wall-local terms: `a` runs along the wall,
 * `c` across it, `z` up as a share of the wall's height.
 */
interface OpeningPiece {
  a0: number
  a1: number
  c0: number
  c1: number
  z0: number
  z1: number
  art: 'stone' | FaceKind
  /** The stretch of wall its art is spread across, if wider than the piece (a double leaf). */
  span?: [number, number]
  /** A fixed slice of the art across the piece, for a leaf swung open. */
  u?: [number, number]
}

/** Width of each stone jamb, as a share of the cell. */
const JAMB = 0.18
const DOOR_HEAD = 0.72
const WINDOW_SILL = 0.36
const WINDOW_HEAD = 0.78

/** Depth of the frame standing on the cell's edge, as a share of the cell. */
const FRAME_DEPTH = 0.12
/** How far a closed leaf sits back inside its frame. */
const LEAF_INSET = 0.025
/** How thick a leaf is once swung open. */
const LEAF_THICKNESS = 0.08
/** How far an open door's leaf reaches into the room, as a share of its width. */
const SWING = 0.86

/**
 * A doorway or window stands on the cell edge that faces the camera, flush with
 * the visible face of the walls beside it: jambs, a lintel (plus a sill for
 * windows) and the leaf, all in one thin plane. The rest of the cell is open
 * floor, with no wall top over it. `front` is that edge, 0 or 1 across the wall.
 * Pieces span the whole opening, `size` cells along the wall; each cell then
 * draws its own share, so a double door has jambs only at its two ends.
 */
function openingPieces(opening: 'door' | 'window', open: boolean, front: 0 | 1, size: number): OpeningPiece[] {
  const c0 = front === 1 ? 1 - FRAME_DEPTH : 0
  const c1 = front === 1 ? 1 : FRAME_DEPTH
  const leaf = { c0: c0 + LEAF_INSET, c1: c1 - LEAF_INSET }
  const pieces: OpeningPiece[] = [
    { a0: 0, a1: JAMB, c0, c1, z0: 0, z1: 1, art: 'stone' },
    { a0: size - JAMB, a1: size, c0, c1, z0: 0, z1: 1, art: 'stone' },
  ]
  const span: [number, number] = [JAMB, size - JAMB]
  if (opening === 'door') {
    pieces.push({ a0: JAMB, a1: size - JAMB, c0, c1, z0: DOOR_HEAD, z1: 1, art: 'stone' })
    const art = size === 1 ? 'door' : 'door-double'
    if (!open) {
      pieces.push({ a0: JAMB, a1: size - JAMB, ...leaf, z0: 0, z1: DOOR_HEAD, art, span })
      return pieces
    }
    // Open, each leaf swings back into the room against its own jamb; a pair meets in the middle.
    const width = (size - 2 * JAMB) / size
    const swung = front === 1 ? { c0: c0 - width * SWING, c1: c0 } : { c0: c1, c1: c1 + width * SWING }
    pieces.push({ a0: JAMB, a1: JAMB + LEAF_THICKNESS, ...swung, z0: 0, z1: DOOR_HEAD, art, u: size === 1 ? [0, 1] : [0, 0.5] })
    if (size > 1) {
      pieces.push({ a0: size - JAMB - LEAF_THICKNESS, a1: size - JAMB, ...swung, z0: 0, z1: DOOR_HEAD, art, u: [0.5, 1] })
    }
    return pieces
  }
  pieces.push({ a0: JAMB, a1: size - JAMB, c0, c1, z0: 0, z1: WINDOW_SILL, art: 'stone' })
  pieces.push({ a0: JAMB, a1: size - JAMB, c0, c1, z0: WINDOW_HEAD, z1: 1, art: 'stone' })
  // Bars repeat in each cell; shutters spread across the whole window.
  pieces.push(
    open
      ? { a0: JAMB, a1: size - JAMB, ...leaf, z0: WINDOW_SILL, z1: WINDOW_HEAD, art: 'window-open' }
      : { a0: JAMB, a1: size - JAMB, ...leaf, z0: WINDOW_SILL, z1: WINDOW_HEAD, art: size === 1 ? 'window' : 'window-double', span },
  )
  return pieces
}

function drawOpening(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  x: number,
  y: number,
  sprite: TileSprite,
  elevation: number,
  open: boolean,
  variant: Variant,
  group: OpeningGroup = { index: 0, size: 1 },
): void {
  const tiles = view.tileCache
  const floor = tiles.top('floor', variant)
  if (floor) drawFloor(ctx, view, x, y, floor, elevation)
  const opening = sprite.startsWith('door') ? 'door' : 'window'
  // `h` walls run along x, `v` walls along y.
  const alongX = sprite.endsWith('-h')
  const yaw = view.camera.yaw
  // The edge across the wall that is nearer the camera; it changes as the view rotates.
  const nearFar = alongX
    ? isoDepth(x + 0.5, y + 1, yaw) - isoDepth(x + 0.5, y, yaw)
    : isoDepth(x + 1, y + 0.5, yaw) - isoDepth(x, y + 0.5, yaw)
  const front: 0 | 1 = nearFar > 0 ? 1 : 0
  // This cell's share of the whole opening, shifted to its own 0..1 along the wall.
  const shift = group.index
  const pieces = openingPieces(opening, open, front, group.size).flatMap((whole): OpeningPiece[] => {
    const a0 = Math.max(whole.a0, shift)
    const a1 = Math.min(whole.a1, shift + 1)
    if (a1 - a0 < 1e-6) return []
    // Stone follows the cell, as a wall face does; other art fills its piece unless it spans wider.
    const [lo, hi] = whole.art === 'stone' ? [shift, shift + 1] : (whole.span ?? [a0, a1])
    return [{ ...whole, a0: a0 - shift, a1: a1 - shift, span: [lo - shift, hi - shift] }]
  })
  const boxes = pieces.map((piece) => {
    const box = alongX
      ? { x0: x + piece.a0, x1: x + piece.a1, y0: y + piece.c0, y1: y + piece.c1 }
      : { x0: x + piece.c0, x1: x + piece.c1, y0: y + piece.a0, y1: y + piece.a1 }
    return {
      ...box,
      z0: piece.z0,
      z1: piece.z1,
      art: piece.art,
      axis: alongX ? ('h' as const) : ('v' as const),
      span: piece.span,
      u: piece.u,
      depth: isoDepth((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, yaw),
    }
  })
  // Far pieces first, and within a piece's footprint the lower one first.
  boxes.sort((a, b) => a.depth - b.depth || a.z0 - b.z0)
  for (const box of boxes) drawOpeningBox(ctx, view, x, y, box, elevation, variant)
}

/** One upright box inside a cell, textured from the tileset. */
function drawOpeningBox(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  cx: number,
  cy: number,
  box: {
    x0: number
    x1: number
    y0: number
    y1: number
    z0: number
    z1: number
    art: 'stone' | FaceKind
    axis: 'h' | 'v'
    span?: [number, number]
    u?: [number, number]
  },
  elevation: number,
  variant: Variant,
): void {
  const camera = view.camera
  const tiles = view.tileCache
  const ground: IsoCorners = {
    n: cellToScreen(box.x0, box.y0, camera),
    e: cellToScreen(box.x1, box.y0, camera),
    s: cellToScreen(box.x1, box.y1, camera),
    w: cellToScreen(box.x0, box.y1, camera),
  }
  const base = roomLift(elevation)
  const floor = liftCorners(ground, camera, base + box.z0 * WALL_HEIGHT)
  const top = liftCorners(ground, camera, base + box.z1 * WALL_HEIGHT)
  const cellAt: Record<Corner, Point> = {
    n: { x: box.x0 - cx, y: box.y0 - cy },
    e: { x: box.x1 - cx, y: box.y0 - cy },
    s: { x: box.x1 - cx, y: box.y1 - cy },
    w: { x: box.x0 - cx, y: box.y1 - cy },
  }
  const stone = box.art === 'stone'
  const art = stone ? tiles.face('wall', variant, 0) : tiles.face(box.art as FaceKind, variant, 0)
  // Bars are see-through; shading them would lay a dark film over the gaps.
  const solid = box.art !== 'window-open'

  const south = southCorner(floor)
  const faces = [PREV[south], NEXT[south]].map((from) => {
    const face: WallFace = {
      axis: edgeAxis(from, south),
      lo: floor[from],
      hi: floor[south],
      loTop: top[from],
      hiTop: top[south],
    }
    const v = stone ? { v0: 1 - box.z1, v1: 1 - box.z0 } : { v0: 0, v1: 1 }
    if (box.u) return { face, window: { u0: box.u[0], u1: box.u[1], ...v }, mid: face.lo.x + face.hi.x }
    // Sample the art at this piece's place along its span, measured from the
    // screen-left end as a whole wall face is, so stone meets its neighbours
    // and the halves of a double leaf meet in the middle. Ends, across the
    // wall, sample across the cell.
    const along = (corner: Corner) => (face.axis === 'h' ? cellAt[corner].x : cellAt[corner].y)
    const loOnLeft = face.lo.x <= face.hi.x
    const left = along(loOnLeft ? from : south)
    const right = along(loOnLeft ? south : from)
    const [lo, hi] = face.axis === box.axis && box.span ? box.span : [0, 1]
    const at = (p: number) => (left < right ? p - lo : hi - p) / (hi - lo)
    return { face, window: { u0: at(left), u1: at(right), ...v }, mid: face.lo.x + face.hi.x }
  })
  faces.sort((a, b) => a.mid - b.mid)
  const shade = tiles.tileset.shade
  faces.forEach(({ face, window }, index) =>
    paintFace(ctx, art, face, index === 0 ? shade.left : shade.right, window, solid),
  )

  // Just the frame's top edge, never wall-top art: the cell reads as an opening, not a wall.
  if (!solid) return
  ctx.beginPath()
  diamondPath(ctx, top)
  ctx.fillStyle = stone ? OPENING_STONE_EDGE : OPENING_WOOD_EDGE
  ctx.fill()
}

const OPENING_STONE_EDGE = '#5c5d66'
const OPENING_WOOD_EDGE = '#5a3a1e'

type Corner = keyof IsoCorners

const NEXT: Record<Corner, Corner> = { n: 'e', e: 's', s: 'w', w: 'n' }
const PREV: Record<Corner, Corner> = { n: 'w', e: 'n', s: 'e', w: 's' }

interface WallFace {
  axis: 'h' | 'v'
  lo: Point
  hi: Point
  loTop: Point
  hiTop: Point
}

function southCorner(floor: IsoCorners): Corner {
  let best: Corner = 'n'
  for (const key of ['n', 'e', 's', 'w'] as const) {
    if (floor[key].y > floor[best].y) best = key
  }
  return best
}

function edgeAxis(a: Corner, b: Corner): 'h' | 'v' {
  const pair = a < b ? `${a}${b}` : `${b}${a}`
  return pair === 'en' || pair === 'sw' ? 'h' : 'v'
}

/** The two cube faces that point at the camera, left then right on screen. */
function visibleWallFaces(floor: IsoCorners, top: IsoCorners): [WallFace, WallFace] {
  const south = southCorner(floor)
  const make = (from: Corner): WallFace => ({
    axis: edgeAxis(from, south),
    lo: floor[from],
    hi: floor[south],
    loTop: top[from],
    hiTop: top[south],
  })
  const a = make(PREV[south])
  const b = make(NEXT[south])
  const aMid = (a.lo.x + a.hi.x) / 2
  const bMid = (b.lo.x + b.hi.x) / 2
  return aMid <= bMid ? [a, b] : [b, a]
}

/**
 * Stands a face texture upright on a cube side: the art's top edge follows the
 * face's top edge left to right on screen, then light falloff darkens it.
 */
function paintFace(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap | undefined,
  face: WallFace,
  light: number,
  window: ArtWindow = { u0: 0, u1: 1, v0: 0, v1: 1 },
  solid = true,
): void {
  const loOnLeft = face.lo.x <= face.hi.x
  const topLeft = loOnLeft ? face.loTop : face.hiTop
  const topRight = loOnLeft ? face.hiTop : face.loTop
  const bottomLeft = loOnLeft ? face.lo : face.hi
  if (bitmap) {
    ctx.save()
    ctx.transform(
      topRight.x - topLeft.x,
      topRight.y - topLeft.y,
      bottomLeft.x - topLeft.x,
      bottomLeft.y - topLeft.y,
      topLeft.x,
      topLeft.y,
    )
    drawWindow(ctx, bitmap, window)
    ctx.restore()
  }
  if (!solid) return
  ctx.beginPath()
  ctx.moveTo(face.lo.x, face.lo.y)
  ctx.lineTo(face.hi.x, face.hi.y)
  ctx.lineTo(face.hiTop.x, face.hiTop.y)
  ctx.lineTo(face.loTop.x, face.loTop.y)
  ctx.closePath()
  if (light < 1) {
    ctx.fillStyle = `rgba(0, 0, 0, ${(1 - light).toFixed(3)})`
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function neighborForEdge(a: Corner, b: Corner): { dx: number; dy: number } {
  const pair = a < b ? `${a}${b}` : `${b}${a}`
  if (pair === 'en') return { dx: 0, dy: -1 }
  if (pair === 'es') return { dx: 1, dy: 0 }
  if (pair === 'sw') return { dx: 0, dy: 1 }
  return { dx: -1, dy: 0 }
}

function appendCubePath(
  ctx: CanvasPath,
  ground: IsoCorners,
  deck: IsoCorners,
): void {
  ctx.moveTo(deck.n.x, deck.n.y)
  ctx.lineTo(deck.e.x, deck.e.y)
  ctx.lineTo(ground.e.x, ground.e.y)
  ctx.lineTo(ground.s.x, ground.s.y)
  ctx.lineTo(ground.w.x, ground.w.y)
  ctx.lineTo(deck.w.x, deck.w.y)
  ctx.closePath()
}

function drawSupportPrism(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  x: number,
  y: number,
  bottom: number,
  topElev: number,
  hideFace: (nx: number, ny: number) => boolean,
): void {
  const base = cellCorners(x, y, view.camera)
  const floor = liftCorners(base, view.camera, roomLift(bottom))
  const deckPts = liftCorners(base, view.camera, roomLift(topElev))
  const ground = screenCorners(floor)
  const deck = screenCorners(deckPts)
  ctx.beginPath()
  appendCubePath(ctx, ground, deck)
  ctx.fillStyle = '#25262c'
  ctx.fill()

  const south = southCorner(floor)
  const faces: WallFace[] = []
  for (const from of [PREV[south], NEXT[south]]) {
    const step = neighborForEdge(from, south)
    const nx = x + step.dx
    const ny = y + step.dy
    if (hideFace(nx, ny)) continue
    faces.push({
      axis: edgeAxis(from, south),
      lo: floor[from],
      hi: floor[south],
      loTop: deckPts[from],
      hiTop: deckPts[south],
    })
  }
  faces.sort((a, b) => a.lo.x + a.hi.x - (b.lo.x + b.hi.x))
  const shade = view.tileCache.tileset.shade
  // The rough stone a raised room stands on, a touch darker than the walls above it.
  const variant = { x, y, seed: 0 }
  if (faces[0]) paintFace(ctx, view.tileCache.face('foundation', variant, 0), faces[0], shade.left * 0.85)
  if (faces[1]) paintFace(ctx, view.tileCache.face('foundation', variant, 1), faces[1], shade.right * 0.85)
}

/** Skew a square bitmap onto an iso diamond. */
/** Draws part of a bitmap into the unit square of the current transform. */
function drawWindow(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, window: ArtWindow): void {
  const sx = window.u0 * bitmap.width
  const sy = window.v0 * bitmap.height
  const sw = Math.max(1, (window.u1 - window.u0) * bitmap.width)
  const sh = Math.max(1, (window.v1 - window.v0) * bitmap.height)
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, 1, 1)
}

function mapBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  diamond: IsoCorners,
  window: ArtWindow = { u0: 0, u1: 1, v0: 0, v1: 1 },
): void {
  ctx.save()
  ctx.beginPath()
  diamondPath(ctx, diamond)
  ctx.clip()
  ctx.transform(
    diamond.e.x - diamond.n.x,
    diamond.e.y - diamond.n.y,
    diamond.w.x - diamond.n.x,
    diamond.w.y - diamond.n.y,
    diamond.n.x,
    diamond.n.y,
  )
  drawWindow(ctx, bitmap, window)
  ctx.restore()
}

function diamondPath(ctx: CanvasRenderingContext2D, diamond: IsoCorners): void {
  ctx.moveTo(diamond.n.x, diamond.n.y)
  ctx.lineTo(diamond.e.x, diamond.e.y)
  ctx.lineTo(diamond.s.x, diamond.s.y)
  ctx.lineTo(diamond.w.x, diamond.w.y)
  ctx.closePath()
}

/** How far a climbing stair rises over its run: one wall, onto the wall tops. */
const STAIR_RISE = WALL_HEIGHT

/** Steps per cell of run: three on short flights, two on long ones so the steps keep some height. */
function stairSteps(length: number): number {
  return length * (length <= 2 ? 3 : 2)
}

/** Steps on a flight between rooms: three to a level of height. */
const STEPS_PER_LEVEL = 3

/** How deep a stair well drops: a wall's height, deeper for long flights. */
function stairDrop(length: number): number {
  return WALL_HEIGHT * Math.min(2, Math.max(1, length / 2))
}

/**
 * A stair block in its own terms: `a` runs along the flight from its foot, `c`
 * across it from the side nearer the camera. Stairs to other floors have no set
 * foot, so they climb or drop away from the viewer and face the camera at every
 * rotation; stairs between rooms climb toward the higher room, `uphill`.
 */
interface StairFrame {
  length: number
  width: number
  /** The flight's foot is the end nearer the camera. */
  footNear: boolean
  /** The grid point `a` along and `c` across. */
  at(a: number, c: number): Point
  /** A cell's footprint in frame terms. */
  cell(x: number, y: number): { a0: number; a1: number; c0: number; c1: number }
}

function stairFrame(rect: CellRect, yaw: Camera['yaw'], uphill?: Edge): StairFrame {
  const alongX = uphill ? uphill === 'left' || uphill === 'right' : rect.maxX - rect.minX >= rect.maxY - rect.minY
  const [runMin, runMax, crossMin, crossMax] = alongX
    ? [rect.minX, rect.maxX + 1, rect.minY, rect.maxY + 1]
    : [rect.minY, rect.maxY + 1, rect.minX, rect.maxX + 1]
  const grid = (run: number, cross: number): Point => (alongX ? { x: run, y: cross } : { x: cross, y: run })
  const depth = (run: number, cross: number) => {
    const p = grid(run, cross)
    return isoDepth(p.x, p.y, yaw)
  }
  // A larger depth is nearer the camera.
  const runMid = (runMin + runMax) / 2
  const crossMid = (crossMin + crossMax) / 2
  const maxNearer = depth(runMax, crossMid) > depth(runMin, crossMid)
  const runFromMax = uphill ? uphill === 'left' || uphill === 'top' : maxNearer
  const crossFromMax = depth(runMid, crossMax) > depth(runMid, crossMin)
  const toRun = (a: number) => (runFromMax ? runMax - a : runMin + a)
  const toCross = (c: number) => (crossFromMax ? crossMax - c : crossMin + c)
  // Each mapping is its own inverse up to the offset.
  const fromRun = (g: number) => (runFromMax ? runMax - g : g - runMin)
  const fromCross = (g: number) => (crossFromMax ? crossMax - g : g - crossMin)
  return {
    length: runMax - runMin,
    width: crossMax - crossMin,
    footNear: runFromMax === maxNearer,
    at: (a, c) => grid(toRun(a), toCross(c)),
    cell: (x, y) => {
      const [r, s] = alongX ? [x, y] : [y, x]
      const a = [fromRun(r), fromRun(r + 1)]
      const c = [fromCross(s), fromCross(s + 1)]
      return { a0: Math.min(a[0], a[1]), a1: Math.max(a[0], a[1]), c0: Math.min(c[0], c[1]), c1: Math.max(c[0], c[1]) }
    },
  }
}

/** What a stair cell draws with: its frame, its footprint, and a pen for points on it. */
interface StairPen {
  frame: StairFrame
  cell: { a0: number; a1: number; c0: number; c1: number }
  tiles: TileCache
  variant: Variant
  /** Screen point `a` along, `c` across, `z` above the flight's foot. */
  at(a: number, c: number, z: number): Point
  /** Light on the flight's faces that look toward the camera: along the run, and across it. */
  runLight: number
  crossLight: number
}

function stairPen(view: DrawView, frame: StairFrame, x: number, y: number, elevation: number, variant: Variant): StairPen {
  const camera = view.camera
  const base = roomLift(elevation)
  const at = (a: number, c: number, z: number) => {
    const g = frame.at(a, c)
    return lift(cellToScreen(g.x, g.y, camera), camera, base + z)
  }
  // A face leaning left on screen takes the left light. The run face that shows
  // is the foot's when the foot is near, the head's when it is far.
  const shade = view.tileCache.tileset.shade
  const footLeft = at(0, 0, 0).x < at(1, 0, 0).x
  const runLeft = frame.footNear ? footLeft : !footLeft
  const crossLeft = at(0, 0, 0).x < at(0, 1, 0).x
  return {
    frame,
    cell: frame.cell(x, y),
    tiles: view.tileCache,
    variant,
    at,
    runLight: runLeft ? shade.left : shade.right,
    crossLight: crossLeft ? shade.left : shade.right,
  }
}

/** A flat piece of a step: `n`→`e` runs across the stair, `n`→`w` toward its nose at `a0` or `a1`. */
function stairTop(pen: StairPen, a0: number, a1: number, c0: number, c1: number, z: number, nose: 'a0' | 'a1'): IsoCorners {
  const [back, front] = nose === 'a0' ? [a1, a0] : [a0, a1]
  return { n: pen.at(back, c0, z), e: pen.at(back, c1, z), s: pen.at(front, c1, z), w: pen.at(front, c0, z) }
}

/** An upright face across the run at `a`. */
function stairRunFace(pen: StairPen, a: number, c0: number, c1: number, z0: number, z1: number): WallFace {
  return { axis: 'h', lo: pen.at(a, c0, z0), hi: pen.at(a, c1, z0), loTop: pen.at(a, c0, z1), hiTop: pen.at(a, c1, z1) }
}

/** An upright face along the run at `c`. */
function stairSideFace(pen: StairPen, c: number, a0: number, a1: number, z0: number, z1: number): WallFace {
  return { axis: 'v', lo: pen.at(a0, c, z0), hi: pen.at(a1, c, z0), loTop: pen.at(a0, c, z1), hiTop: pen.at(a1, c, z1) }
}

/** Wall art up a face of any height, a wall's height at a time from the bottom, so the stone keeps its scale. */
function paintColumn(
  ctx: CanvasRenderingContext2D,
  art: ImageBitmap | undefined,
  face: (z0: number, z1: number) => WallFace,
  z0: number,
  z1: number,
  light: number,
  u: { u0: number; u1: number },
): void {
  for (let low = z0; low < z1 - 0.01; low += WALL_HEIGHT) {
    const high = Math.min(z1, low + WALL_HEIGHT)
    paintFace(ctx, art, face(low, high), light, { ...u, v0: 1 - (high - low) / WALL_HEIGHT, v1: 1 })
  }
}

function strokeEdge(ctx: CanvasRenderingContext2D, from: Point, to: Point, color: string): void {
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.stroke()
}

const STAIR_NOSE = 'rgba(255, 240, 210, 0.22)'
const STAIR_LIP = 'rgba(0, 0, 0, 0.55)'
const STAIR_WELL = '#09090c'

/**
 * Stairs to other floors stand in their cell: going up, a flight of steps
 * climbing away from the camera to wall-top height; going down, a well cut into
 * the floor with the steps dropping away inside it; both ways, the well on the
 * near side and the climb behind it. Treads, risers and the well's walls come
 * from the tileset.
 */
function drawStairs(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  x: number,
  y: number,
  block: StairsBlock,
  elevation: number,
  variant: Variant,
): void {
  const frame = stairFrame(block.rect, view.camera.yaw)
  const pen = stairPen(view, frame, x, y, elevation, variant)
  const flight: Flight = { rise: STAIR_RISE, steps: stairSteps(frame.length), bottom: 0, start: 0, length: frame.length }
  const half = frame.width / 2
  if (block.dir === 'down') drawStairsDown(ctx, pen, 0, frame.width)
  else if (block.dir === 'up') drawFlight(ctx, pen, flight, 0, frame.width)
  else {
    drawStairsDown(ctx, pen, 0, half)
    drawFlight(ctx, pen, flight, half, frame.width)
  }
}

/**
 * One cell of the stairs between two rooms: its part of a single flight from
 * the lower room's floor to the higher room's, in the same steps as stairs to
 * other floors, standing on solid stone down to the ground beneath.
 */
function drawRampStairs(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  slice: RampSlice,
  bottom: number,
  variant: Variant,
): void {
  const { ramp } = slice
  const frame = stairFrame(ramp.rect, view.camera.yaw, ramp.up)
  const pen = stairPen(view, frame, slice.x, slice.y, ramp.fromElev, variant)
  const levels = ramp.toElev - ramp.fromElev
  const { start, length } = rampFlight(ramp)
  const flight: Flight = {
    rise: roomLift(levels),
    steps: Math.max(1, Math.round(levels * STEPS_PER_LEVEL)),
    bottom: roomLift(bottom) - roomLift(ramp.fromElev),
    start,
    length,
  }
  drawFlight(ctx, pen, flight, 0, frame.width)
}

/**
 * A climbing flight: its height and steps, how far below its foot its stone
 * reaches, and where along the run the steps sit; any run before them is a
 * landing at the foot's height, any after a landing at the top's.
 */
interface Flight {
  rise: number
  steps: number
  bottom: number
  start: number
  length: number
}

/** A step or a landing: `a0`–`a1` along the run, its top at `z`. */
interface FlightPiece {
  a0: number
  a1: number
  z: number
  step: number | null
}

function flightPieces(flight: Flight, runLength: number): FlightPiece[] {
  const pieces: FlightPiece[] = []
  if (flight.start > 0) pieces.push({ a0: 0, a1: flight.start, z: 0, step: null })
  const run = flight.length / flight.steps
  for (let k = 0; k < flight.steps; k++) {
    pieces.push({ a0: flight.start + k * run, a1: flight.start + (k + 1) * run, z: ((k + 1) / flight.steps) * flight.rise, step: k })
  }
  const end = flight.start + flight.length
  if (end < runLength) pieces.push({ a0: end, a1: runLength, z: flight.rise, step: null })
  return pieces
}

/** This cell's part of a climbing flight across `[s0, s1]`, far pieces first. */
function drawFlight(ctx: CanvasRenderingContext2D, pen: StairPen, flight: Flight, s0: number, s1: number): void {
  const { frame, cell, tiles, variant } = pen
  const c0 = Math.max(cell.c0, s0)
  const c1 = Math.min(cell.c1, s1)
  if (c1 <= c0) return
  const { bottom } = flight
  const tread = tiles.face('tread', variant, 0)
  const riser = tiles.face('riser', variant, 0)
  const wall = tiles.face('wall', variant, 0)
  const floor = tiles.top('floor', variant)
  // Treads and risers span the whole flight, so a runner or a slab crosses it once.
  const u = { u0: (c0 - s0) / (s1 - s0), u1: (c1 - s0) / (s1 - s0) }
  const pieces = flightPieces(flight, frame.length)
  const order = pieces.map((_, i) => i)
  if (frame.footNear) order.reverse()
  for (const i of order) {
    const piece = pieces[i]
    const a0 = Math.max(piece.a0, cell.a0)
    const a1 = Math.min(piece.a1, cell.a1)
    if (a1 <= a0) continue
    const { z } = piece
    const along = { u0: a0 - cell.a0, u1: a1 - cell.a0 }
    // The flight's open side, faced like the walls; inner cuts are covered by the next cell's piece.
    if (c0 === s0 && z > bottom) {
      paintColumn(ctx, wall, (low, high) => stairSideFace(pen, c0, a0, a1, low, high), bottom, z, pen.crossLight, along)
    }
    if (frame.footNear && a0 === piece.a0) {
      // Under the foot, the stone the flight stands on.
      if (i === 0 && bottom < 0) {
        paintColumn(ctx, wall, (low, high) => stairRunFace(pen, a0, c0, c1, low, high), bottom, 0, pen.runLight, u)
      }
      // Only a riser's own height shows; nearer pieces hide the rest of the column.
      const under = i > 0 ? pieces[i - 1].z : 0
      if (piece.step !== null && z > under) {
        const band = Math.min(1, (z - under) / WALL_HEIGHT)
        const v0 = ((piece.step * 0.37) % 1) * (1 - band)
        paintFace(ctx, riser, stairRunFace(pen, a0, c0, c1, under, z), pen.runLight, { ...u, v0, v1: v0 + band })
      }
    }
    // Climbing toward the camera, the risers face away; only the head's end shows, as stone.
    if (!frame.footNear && a1 === frame.length && z > bottom) {
      paintColumn(ctx, wall, (low, high) => stairRunFace(pen, a1, c0, c1, low, high), bottom, z, pen.runLight, u)
    }
    const top = stairTop(pen, a0, a1, c0, c1, z, 'a0')
    if (piece.step === null && floor) {
      mapBitmap(ctx, floor, top, { u0: c0 - cell.c0, u1: c1 - cell.c0, v0: 1 - (a1 - cell.a0), v1: 1 - (a0 - cell.a0) })
    } else if (piece.step !== null && tread) {
      const depth = piece.a1 - piece.a0
      mapBitmap(ctx, tread, top, { ...u, v0: 1 - (a1 - piece.a0) / depth, v1: 1 - (a0 - piece.a0) / depth })
    } else {
      ctx.beginPath()
      diamondPath(ctx, top)
      ctx.fillStyle = '#a39782'
      ctx.fill()
    }
    if (piece.step !== null && a0 === piece.a0) strokeEdge(ctx, pen.at(a0, c0, z), pen.at(a0, c1, z), STAIR_NOSE)
  }
}

/**
 * This cell's opening onto a well across `[s0, s1]`. Through it shows whatever
 * of the well lies below: the far walls and the steps going down, darker as they go.
 */
function drawStairsDown(ctx: CanvasRenderingContext2D, pen: StairPen, s0: number, s1: number): void {
  const { frame, cell, tiles, variant } = pen
  const c0 = Math.max(cell.c0, s0)
  const c1 = Math.min(cell.c1, s1)
  if (c1 <= c0) return
  const drop = stairDrop(frame.length)
  const steps = stairSteps(frame.length)
  const run = frame.length / steps
  const shaft = tiles.face('shaft', variant, 0)
  const tread = tiles.face('tread', variant, 0)

  const opening = stairTop(pen, cell.a0, cell.a1, c0, c1, 0, 'a0')
  ctx.save()
  ctx.beginPath()
  diamondPath(ctx, opening)
  ctx.clip()
  ctx.fillStyle = STAIR_WELL
  ctx.fill()

  // The well's far walls, in wall-height bands so the art keeps its scale.
  const bands: [number, number][] = []
  for (let top = 0; top > -drop; top -= WALL_HEIGHT) bands.push([Math.max(-drop, top - WALL_HEIGHT), top])
  for (const [zLow, zHigh] of bands) {
    const v = { v0: -zHigh / WALL_HEIGHT - Math.floor(-zHigh / WALL_HEIGHT), v1: 0 }
    v.v1 = v.v0 + (zHigh - zLow) / WALL_HEIGHT
    for (let j = Math.floor(s0); j < s1; j++) {
      const w0 = Math.max(s0, j)
      const w1 = Math.min(s1, j + 1)
      const end = stairRunFace(pen, frame.length, w0, w1, zLow, zHigh)
      paintFace(ctx, shaft, end, pen.runLight * 0.8, { u0: w0 - j, u1: w1 - j, ...v })
    }
    for (let j = 0; j < frame.length; j++) {
      paintFace(ctx, shaft, stairSideFace(pen, s1, j, j + 1, zLow, zHigh), pen.crossLight * 0.8, { u0: 0, u1: 1, ...v })
    }
  }

  // The steps, farthest and deepest first, so each higher one laps the next.
  for (let k = steps - 1; k >= 0; k--) {
    const a0 = k * run
    const a1 = a0 + run
    const z = -((k + 1) / steps) * drop
    const top = stairTop(pen, a0, a1, s0, s1, z, 'a1')
    if (tread) mapBitmap(ctx, tread, top, { u0: 0, u1: 1, v0: Math.max(0, 1 - run), v1: 1 })
    ctx.beginPath()
    diamondPath(ctx, top)
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.18 + 0.55 * ((k + 1) / steps)).toFixed(3)})`
    ctx.fill()
    strokeEdge(ctx, pen.at(a1, s0, z), pen.at(a1, s1, z), STAIR_NOSE)
  }
  ctx.restore()

  // The floor's lip on the near edges of the well.
  if (cell.a0 === 0) strokeEdge(ctx, pen.at(0, c0, 0), pen.at(0, c1, 0), STAIR_LIP)
  if (c0 === s0) strokeEdge(ctx, pen.at(cell.a0, c0, 0), pen.at(cell.a1, c0, 0), STAIR_LIP)
}

function drawRampPreview(ctx: CanvasRenderingContext2D, view: DrawView, draft: RampDraft): void {
  const ramp = draft.ramp
  const rect = ramp?.rect ?? draft.rect
  const elev = ramp ? Math.round((ramp.fromElev + ramp.toElev) / 2) : 0
  const color = draft.erase ? HOVER : '#d8cba0'
  const diamond = liftCorners(rectCorners(rect, view.camera), view.camera, roomLift(elev))
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  diamondPath(ctx, diamond)
  ctx.stroke()
  ctx.restore()

  const east = screenCorners(diamond).e
  const label = draft.erase
    ? 'Erase stairs'
    : ramp
      ? `Stairs ${ramp.fromElev} → ${ramp.toElev}`
      : 'Stairs'
  drawChip(ctx, label, east.x + 6, east.y, color)
}

function drawMovePath(ctx: CanvasRenderingContext2D, view: DrawView): void {
  for (const path of view.movePaths) drawOnePath(ctx, view, path)
}

function drawOnePath(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  path: DrawView['movePaths'][number],
): void {
  if (path.cells.length < 2) return
  const flyer = view.players.find((player) => player.id === path.playerId)
  const size = flyer ? playerSize(flyer) : 1
  const points = path.cells.map((cell) => {
    const mid = playerCenter(cell.x, cell.y, size)
    return tokenCenter(
      mid.x,
      mid.y,
      cellElevation(view.rooms, view.ramps, cell.x, cell.y),
      view.camera,
    )
  })
  const first = points[0]
  if (!first) return
  ctx.save()
  // A token hidden from players (shown faded to the DM) gets a faded path to match.
  if (flyer && view.unseen.has(flyer.id)) ctx.globalAlpha = 0.42
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 1.5
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point) ctx.lineTo(point.x, point.y)
  }
  ctx.strokeStyle = MEASURE
  ctx.lineWidth = 2.75
  ctx.stroke()

  const { rx, ry } = tokenEllipse(view.camera)
  const pipRx = Math.max(3, rx * 0.18)
  const pipRy = Math.max(1.5, ry * 0.18)
  for (let i = 0; i < points.length - 1; i++) {
    const point = points[i]
    if (!point) continue
    ctx.beginPath()
    ctx.ellipse(point.x, point.y, pipRx, pipRy, 0, 0, Math.PI * 2)
    ctx.fillStyle = MEASURE
    ctx.fill()
  }
  ctx.restore()
}

function tokenDrawCell(
  player: Player,
  view: DrawView,
): { x: number; y: number; tilt: number } {
  const pose = view.tokenPoses.find((item) => item.playerId === player.id)
  if (pose) return pose
  return { x: player.x, y: player.y, tilt: 0 }
}

function drawTokens(ctx: CanvasRenderingContext2D, view: DrawView): void {
  const sorted = [...view.players].sort((a, b) => {
    const aCell = tokenDrawCell(a, view)
    const bCell = tokenDrawCell(b, view)
    const aMid = playerCenter(aCell.x, aCell.y, playerSize(a))
    const bMid = playerCenter(bCell.x, bCell.y, playerSize(b))
    return (
      isoDepth(aMid.x, aMid.y, view.camera.yaw) - isoDepth(bMid.x, bMid.y, view.camera.yaw) ||
      cellElevation(view.rooms, view.ramps, Math.round(aCell.x), Math.round(aCell.y)) +
        playerHover(a) -
        (cellElevation(view.rooms, view.ramps, Math.round(bCell.x), Math.round(bCell.y)) +
          playerHover(b))
    )
  })
  for (const player of sorted) {
    const cell = tokenDrawCell(player, view)
    const size = playerSize(player)
    const standee = tokenStandee(view.camera, size)
    const pos = playerTokenCenterAt(player, cell.x, cell.y, view.rooms, view.ramps, view.camera)
    const hover = player.id === view.hoverPlayerId
    const selected = player.id === view.selectedPlayerId
    const ring = selected ? ACCENT : hover ? HOVER : player.color
    const statuses = playerStatuses(player)
    const air = playerAirFeet(player)
    if (view.unseen.has(player.id)) ctx.globalAlpha = 0.42
    else if (statuses.includes('invisible')) ctx.globalAlpha = 0.38
    if (air > 0) {
      const ground = playerGroundCenterAt(player, cell.x, cell.y, view.rooms, view.ramps, view.camera)
      drawAirShadow(ctx, ground, standee)
      drawAirColumn(ctx, ground, pos, standee)
    }
    const turnWreath =
      player.id === view.turnPlayerId && (view.viewMode !== 'player' || !view.unseen.has(player.id))
    if (turnWreath) {
      ctx.save()
      ctx.globalAlpha = 1
      drawTurnWreath(ctx, pos.x, pos.y, standee.rx, standee.ry, 'back')
      ctx.restore()
    }
    drawStandee(
      ctx,
      pos,
      standee,
      player.color,
      ring,
      selected || hover,
      player.portrait ? view.portraits.get(player.portrait) : undefined,
      playerInitials(characterNameOf(player)),
      characterNameOf(player),
      statuses,
      cell.tilt,
    )
    if (turnWreath) {
      ctx.save()
      ctx.globalAlpha = 1
      drawTurnWreath(ctx, pos.x, pos.y, standee.rx, standee.ry, 'front')
      ctx.restore()
    }
    if (air > 0) {
      drawAirChip(ctx, `${air} ft`, pos.x + standee.width / 2 + 6, pos.y - standee.height * 0.55)
    }

    const trail = view.movePaths.find((item) => item.playerId === player.id)
    const walking = view.tokenPoses.some((item) => item.playerId === player.id)
    if (walking && trail && trail.feet > 0) {
      drawMeasureChip(
        ctx,
        `${trail.feet} ft`,
        pos.x + standee.width / 2 + 6,
        pos.y - standee.height + standee.tab,
      )
    }
    ctx.globalAlpha = 1
  }
  for (const ghost of view.ghosts) drawGhostToken(ctx, view, ghost)
}

function wreathArcSpan(start: number, end: number, dir: number): number {
  let span = end - start
  if (dir > 0) {
    while (span <= 0) span += Math.PI * 2
  } else {
    while (span >= 0) span -= Math.PI * 2
  }
  return span
}

function wreathLeafAngles(
  start: number,
  end: number,
  dir: number,
  count: number,
  rx: number,
  ry: number,
): number[] {
  const span = wreathArcSpan(start, end, dir)
  const samples = 48
  const angles: number[] = [start]
  const lens: number[] = [0]
  let dist = 0
  let px = Math.cos(start) * rx
  let py = Math.sin(start) * ry
  for (let i = 1; i <= samples; i++) {
    const a = start + (span * i) / samples
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    dist += Math.hypot(x - px, y - py)
    angles.push(a)
    lens.push(dist)
    px = x
    py = y
  }
  const total = dist || 1
  const slots: number[] = []
  for (let i = 0; i < count; i++) {
    const target = ((i + 0.12) / Math.max(1, count - 0.25)) * total
    let k = 1
    while (k < lens.length && lens[k] < target) k++
    const before = lens[k - 1] ?? 0
    const after = lens[k] ?? before
    const t = (target - before) / Math.max(1e-6, after - before)
    slots.push((angles[k - 1] ?? start) + ((angles[k] ?? end) - (angles[k - 1] ?? start)) * t)
  }
  return slots
}

function wrapAngleDelta(delta: number): number {
  let value = delta
  while (value > Math.PI) value -= Math.PI * 2
  while (value < -Math.PI) value += Math.PI * 2
  return value
}

function drawLaurelLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  fill: string,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(length * 0.04, 0)
  ctx.bezierCurveTo(length * 0.3, width, length * 0.66, width * 0.95, length, 0)
  ctx.bezierCurveTo(length * 0.66, -width * 0.95, length * 0.3, -width, length * 0.04, 0)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

function drawWreathBranch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  start: number,
  end: number,
  dir: number,
  leafLen: number,
): void {
  const leafWidth = leafLen * 0.4
  const angles = wreathLeafAngles(start, end, dir, 17, rx, ry)
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]
    if (a == null) continue
    const outer = i % 2 === 0
    const tx = -rx * Math.sin(a) * dir
    const ty = ry * Math.cos(a) * dir
    let nx = Math.cos(a) / rx
    let ny = Math.sin(a) / ry
    const nlen = Math.hypot(nx, ny) || 1
    nx /= nlen
    ny /= nlen
    const along = Math.atan2(ty, tx)
    const flare = wrapAngleDelta(Math.atan2(ny, nx) - along)
    const tip = Math.abs(Math.cos(a))
    const tilt = (outer ? 0.5 : 0.14) * (1 - tip * 0.4)
    const angle = along + Math.sign(flare || dir) * tilt
    const offset = (outer ? leafLen * 0.26 : -leafLen * 0.12) * (1 - tip * 0.2)
    const px = x + Math.cos(a) * rx + nx * offset
    const py = y + Math.sin(a) * ry + ny * offset
    const scale = (outer ? 1 : 0.86) * (1 - tip * 0.36)
    drawLaurelLeaf(
      ctx,
      px,
      py,
      angle,
      leafLen * scale,
      leafWidth * scale,
      outer ? 'rgba(120, 211, 155, 0.62)' : 'rgba(86, 168, 118, 0.55)',
    )
  }
}

function drawTurnWreath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  half: 'back' | 'front',
): void {
  const gap = Math.max(5, ry * 0.55)
  const leafLen = Math.max(5.8, ry * 0.82)
  const stemRx = rx + gap + leafLen * 0.22
  const stemRy = ry + gap + leafLen * 0.22
  const extent = Math.max(stemRx, stemRy) + leafLen + 4
  ctx.save()
  ctx.beginPath()
  if (half === 'back') ctx.rect(x - extent, y - extent, extent * 2, extent + 1.2)
  else ctx.rect(x - extent, y - 1.2, extent * 2, extent)
  ctx.clip()
  const join = 0.28
  const opening = 0.52
  drawWreathBranch(
    ctx,
    x,
    y,
    stemRx,
    stemRy,
    Math.PI / 2 + join,
    Math.PI * 1.5 - opening,
    1,
    leafLen,
  )
  drawWreathBranch(
    ctx,
    x,
    y,
    stemRx,
    stemRy,
    Math.PI / 2 - join,
    -Math.PI / 2 + opening,
    -1,
    leafLen,
  )
  if (half === 'front') {
    const dotRx = Math.max(1.5, ry * 0.12)
    ctx.beginPath()
    ctx.ellipse(x, y + stemRy, dotRx, dotRx * 0.55, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(120, 211, 155, 0.72)'
    ctx.fill()
  }
  ctx.restore()
}

function drawGhostToken(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  ghost: DrawView['ghosts'][number],
): void {
  const { player, x, y } = ghost
  const size = playerSize(player)
  const standee = tokenStandee(view.camera, size)
  const pos = playerTokenCenterAt(player, x, y, view.rooms, view.ramps, view.camera)
  const statuses = playerStatuses(player)
  const air = playerAirFeet(player)
  ctx.save()
  ctx.globalAlpha = 0.4
  if (air > 0) {
    const ground = playerGroundCenterAt(player, x, y, view.rooms, view.ramps, view.camera)
    drawAirShadow(ctx, ground, standee)
    drawAirColumn(ctx, ground, pos, standee)
  }
  drawStandee(
    ctx,
    pos,
    standee,
    player.color,
    player.color,
    false,
    player.portrait ? view.portraits.get(player.portrait) : undefined,
    playerInitials(characterNameOf(player)),
    characterNameOf(player),
    statuses,
  )
  const trail = view.movePaths.find((item) => item.playerId === player.id)
  if (trail && trail.feet > 0) {
    drawMeasureChip(
      ctx,
      `${trail.feet} ft`,
      pos.x + standee.width / 2 + 6,
      pos.y - standee.height + standee.tab,
    )
  }
  ctx.restore()
}

function drawStandee(
  ctx: CanvasRenderingContext2D,
  pos: Point,
  standee: ReturnType<typeof tokenStandee>,
  color: string,
  ring: string,
  emphasis: boolean,
  portrait: CanvasImageSource | undefined,
  initials: string,
  name: string,
  statuses: readonly StatusId[] = [],
  tilt = 0,
): void {
  const { rx, ry, width, height, tab, rim } = standee
  const plant = pos.y - tab * 0.15
  const botY = pos.y + rim

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(pos.x, botY + ry * 0.5, rx * 0.96, ry * 0.78, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(pos.x, botY, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(22, 18, 14, 0.82)'
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(pos.x, botY, rx, ry, 0, 0, Math.PI, false)
  ctx.ellipse(pos.x, pos.y, rx, ry, 0, Math.PI, 0, true)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)'
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(pos.x, pos.y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(pos.x, pos.y - ry * 0.08, rx * 0.7, ry * 0.62, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.fill()

  const slotW = Math.max(3, width * 0.16)
  const slotH = Math.max(1.5, ry * 0.28)
  ctx.beginPath()
  ctx.roundRect(pos.x - slotW / 2, pos.y - slotH / 2, slotW, slotH, slotH / 2)
  ctx.fillStyle = 'rgba(18, 16, 12, 0.55)'
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(pos.x, pos.y, rx, ry, 0, 0, Math.PI * 2)
  ctx.strokeStyle = ring
  ctx.lineWidth = emphasis ? 2.6 : 1.8
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(pos.x, pos.y, Math.max(1, rx - 1.4), Math.max(1, ry - 1.4), 0, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(18, 19, 24, 0.4)'
  ctx.lineWidth = 1
  ctx.stroke()

  drawStatusRings(ctx, pos.x, pos.y, rx, ry, statuses, 'back')

  ctx.save()
  if (statuses.includes('prone')) {
    ctx.translate(pos.x, plant)
    ctx.rotate(Math.PI / 2)
    ctx.translate(-pos.x, -plant)
  } else if (tilt) {
    ctx.translate(pos.x, plant)
    ctx.rotate(tilt)
    ctx.translate(-pos.x, -plant)
  }
  ctx.fillStyle = '#cbb892'
  ctx.fillRect(pos.x - slotW * 0.38, plant - tab * 0.35, slotW * 0.76, tab * 0.7)

  if (portrait) {
    const iw = imageWidth(portrait)
    const ih = imageHeight(portrait)
    const scale = Math.min(width / iw, height / ih)
    const dw = iw * scale
    const dh = ih * scale
    const dx = pos.x - dw / 2
    const dy = plant - dh
    ctx.save()
    ctx.filter = 'drop-shadow(0 1px 0 rgba(70, 52, 28, 0.7)) drop-shadow(1px 3px 3px rgba(0, 0, 0, 0.38))'
    ctx.drawImage(portrait, dx, dy, dw, dh)
    ctx.restore()
  } else {
    drawDefaultPawn(ctx, pos.x, plant, width * 0.72, height * 0.96, color, initials)
  }
  ctx.restore()
  drawBaseName(ctx, pos.x, pos.y, plant, rx, ry, name)
  drawStatusRings(ctx, pos.x, pos.y, rx, ry, statuses, 'front')
  ctx.restore()
}

function drawAirShadow(
  ctx: CanvasRenderingContext2D,
  ground: Point,
  standee: ReturnType<typeof tokenStandee>,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(ground.x, ground.y + standee.ry * 0.15, standee.rx * 0.9, standee.ry * 0.7, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)'
  ctx.fill()
  ctx.restore()
}

/** Translucent iso column from the floor up to a flying puck. */
function drawAirColumn(
  ctx: CanvasRenderingContext2D,
  ground: Point,
  pos: Point,
  standee: ReturnType<typeof tokenStandee>,
): void {
  const { rx, ry } = standee
  const cx = pos.x
  const topY = pos.y
  const botY = ground.y
  if (botY - topY < 1.5) return

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx - rx, topY)
  ctx.lineTo(cx - rx, botY)
  ctx.ellipse(cx, botY, rx, ry, 0, Math.PI, 0, true)
  ctx.lineTo(cx + rx, topY)
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI, true)
  ctx.closePath()
  const fill = ctx.createLinearGradient(cx, topY, cx, botY)
  fill.addColorStop(0, 'rgba(186, 220, 236, 0.08)')
  fill.addColorStop(1, 'rgba(186, 220, 236, 0.22)')
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = 'rgba(165, 210, 230, 0.4)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(cx, botY, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(16, 14, 12, 0.16)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(165, 210, 230, 0.48)'
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(165, 210, 230, 0.32)'
  ctx.stroke()
  ctx.restore()
}

function drawAirChip(ctx: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  ctx.save()
  ctx.font = '700 11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const pad = 5
  const height = 16
  const width = ctx.measureText(label).width + pad * 2
  ctx.fillStyle = 'rgba(18, 19, 24, 0.86)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = '#7dd3fc'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  ctx.fillStyle = '#7dd3fc'
  ctx.fillText(label, x + pad, y + height / 2 + 0.5)
  ctx.restore()
}

function drawStatusRings(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  statuses: readonly StatusId[],
  pass: 'back' | 'front',
): void {
  if (statuses.length === 0) return
  const effects = statuses.map((id) => statusEffect(id))
  ctx.save()
  ctx.lineCap = 'butt'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  effects.forEach((effect, index) => {
    const grow = 3.5 + index * 4.5
    ctx.beginPath()
    if (pass === 'back') {
      ctx.ellipse(cx, cy, rx + grow, ry + grow, 0, Math.PI, Math.PI * 2)
    } else {
      ctx.ellipse(cx, cy, rx + grow, ry + grow, 0, 0, Math.PI)
    }
    ctx.strokeStyle = effect.color
    ctx.lineWidth = Math.max(1.6, rx * 0.045)
    ctx.stroke()
    if (pass !== 'front') return
    const font = Math.max(7, Math.min(11, rx * 0.16))
    ctx.font = `700 ${font}px system-ui, sans-serif`
    const labelX = cx + rx + grow + 4
    const labelY = cy - ry * 0.15 + index * (font + 3)
    ctx.lineWidth = Math.max(2, font * 0.28)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(16, 13, 10, 0.78)'
    ctx.fillStyle = effect.color
    ctx.strokeText(effect.label, labelX, labelY)
    ctx.fillText(effect.label, labelX, labelY)
  })
  ctx.restore()
}

function drawBaseName(
  ctx: CanvasRenderingContext2D,
  cx: number,
  puckY: number,
  portraitBottom: number,
  rx: number,
  ry: number,
  name: string,
): void {
  const text = name.trim()
  if (!text) return
  const minSize = Math.max(5, rx * 0.12)
  const maxSize = Math.max(minSize, rx * 0.26)
  let size = maxSize
  const trackingOf = (fontSize: number) => fontSize * 0.1
  const layout = (fontSize: number) => {
    const tracking = trackingOf(fontSize)
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`
    ctx.letterSpacing = `${tracking}px`
    const width = ctx.measureText(text).width
    const stroke = Math.max(1.4, fontSize * 0.2)
    const y = portraitBottom + fontSize * 0.72
    const oy = y - puckY
    const halfH = fontSize * 0.5 + stroke * 0.35
    const inset = Math.max(3, rx * 0.08)
    const innerRx = Math.max(4, rx - inset)
    const innerRy = Math.max(4, ry - inset)
    if (Math.abs(oy) + halfH >= innerRy) return { ok: false, y, tracking }
    const halfW = innerRx * Math.sqrt(Math.max(0, 1 - (oy / innerRy) ** 2))
    return { ok: width / 2 + stroke * 0.3 <= halfW, y, tracking }
  }
  while (size > minSize && !layout(size).ok) size -= 0.5
  const placed = layout(size)
  ctx.font = `700 ${size}px system-ui, sans-serif`
  ctx.letterSpacing = `${placed.tracking}px`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1.4, size * 0.2)
  ctx.strokeStyle = 'rgba(16, 13, 10, 0.78)'
  ctx.fillStyle = '#f4efe4'
  ctx.strokeText(text, cx, placed.y)
  ctx.fillText(text, cx, placed.y)
  ctx.letterSpacing = '0px'
}

function imageWidth(source: CanvasImageSource): number {
  if ('naturalWidth' in source && source.naturalWidth) return source.naturalWidth
  if ('width' in source && typeof source.width === 'number') return source.width
  return 1
}

function imageHeight(source: CanvasImageSource): number {
  if ('naturalHeight' in source && source.naturalHeight) return source.naturalHeight
  if ('height' in source && typeof source.height === 'number') return source.height
  return 1
}

function drawDefaultPawn(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  color: string,
  initials: string,
): void {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.24)'
  cardPath(ctx, cx + 1.5, bottom + 1.8, w, h)
  ctx.fill()
  cardPath(ctx, cx, bottom, w, h)
  ctx.fillStyle = '#d7c4a0'
  ctx.fill()
  ctx.strokeStyle = 'rgba(72, 54, 32, 0.55)'
  ctx.lineWidth = 1.2
  ctx.stroke()

  const foot = Math.max(3, h * 0.13)
  ctx.fillStyle = color
  ctx.fillRect(cx - w / 2 + 1, bottom - foot, w - 2, foot)

  ctx.fillStyle = '#3f3428'
  ctx.font = `700 ${Math.round(w * 0.34)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials, cx, bottom - h * 0.52)
  ctx.restore()
}

function cardPath(ctx: CanvasRenderingContext2D, cx: number, bottom: number, w: number, h: number): void {
  const left = cx - w / 2
  const top = bottom - h
  const radius = w * 0.46
  ctx.beginPath()
  ctx.moveTo(left, bottom)
  ctx.lineTo(left, top + radius)
  ctx.arc(cx, top + radius, radius, Math.PI, 0)
  ctx.lineTo(left + w, bottom)
  ctx.closePath()
}

function drawLinkBadge(ctx: CanvasRenderingContext2D, badge: LinkBadge, breaking: boolean): void {
  const color = breaking ? HOVER : LINK
  ctx.save()
  ctx.beginPath()
  ctx.arc(badge.x, badge.y, badge.radius, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(18, 19, 24, 0.92)'
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()

  const loop = badge.radius * 0.32
  const gap = badge.radius * (breaking ? 0.52 : 0.33)
  ctx.translate(badge.x, badge.y)
  ctx.rotate(-Math.PI / 4)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.4, badge.radius * 0.17)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(-gap, 0, loop, Math.PI * 0.32, Math.PI * 1.68)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(gap, 0, loop, Math.PI * -0.68, Math.PI * 0.68)
  ctx.stroke()
  if (!breaking) {
    ctx.beginPath()
    ctx.moveTo(-gap, 0)
    ctx.lineTo(gap, 0)
    ctx.stroke()
  }
  ctx.restore()
}

function outlineRoom(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  room: Room,
  color: string,
  lineWidth: number,
): void {
  if (room.parts) {
    outlineShape(ctx, view, room, color, lineWidth)
    return
  }
  const floor = liftCorners(
    screenCorners(rectCorners(room.rect, view.camera)),
    view.camera,
    roomLift(room.elevation),
  )
  const top = liftCorners(floor, view.camera, WALL_HEIGHT)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(top.n.x, top.n.y)
  ctx.lineTo(top.e.x, top.e.y)
  ctx.lineTo(floor.e.x, floor.e.y)
  ctx.lineTo(floor.s.x, floor.s.y)
  ctx.lineTo(floor.w.x, floor.w.y)
  ctx.lineTo(top.w.x, top.w.y)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/**
 * A merged room has no single box to trace, so its outline follows every cell
 * edge with outside beyond it, along the floor and again along the wall tops.
 */
function outlineShape(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  room: Room,
  color: string,
  lineWidth: number,
): void {
  const base = roomLift(room.elevation)
  const edges: [number, number, number, number][] = []
  for (const cell of roomCells(room)) {
    const { x, y } = cell
    if (!roomContains(room, x, y - 1)) edges.push([x, y, x + 1, y])
    if (!roomContains(room, x, y + 1)) edges.push([x, y + 1, x + 1, y + 1])
    if (!roomContains(room, x - 1, y)) edges.push([x, y, x, y + 1])
    if (!roomContains(room, x + 1, y)) edges.push([x + 1, y, x + 1, y + 1])
  }
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const height of [base, base + WALL_HEIGHT]) {
    for (const [x0, y0, x1, y1] of edges) {
      const a = lift(cellToScreen(x0, y0, view.camera), view.camera, height)
      const b = lift(cellToScreen(x1, y1, view.camera), view.camera, height)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

function drawLinkPreview(ctx: CanvasRenderingContext2D, view: DrawView, a: Room, b: Room): void {
  const left = lift(
    cellCenter((a.rect.minX + a.rect.maxX) / 2, (a.rect.minY + a.rect.maxY) / 2, view.camera),
    view.camera,
    roomLift(a.elevation),
  )
  const right = lift(
    cellCenter((b.rect.minX + b.rect.maxX) / 2, (b.rect.minY + b.rect.maxY) / 2, view.camera),
    view.camera,
    roomLift(b.elevation),
  )
  ctx.save()
  ctx.strokeStyle = LINK
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(right.x, right.y)
  ctx.stroke()
  ctx.restore()
}

function drawFeaturePreview(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  draft: FeatureDraft,
): void {
  const room = view.rooms.find((item) => item.id === draft.roomId)
  if (!room) return
  const color = draft.erase ? HOVER : TOOL_TINT[draft.tool]

  const region = draft.tool === 'stairs' ? stairsRegion(room, draft.rect) : null
  const areas =
    draft.tool === 'stairs'
      ? region
        ? [region]
        : []
      : (draft.tool === 'walls'
          ? wallPaintCells(view.rooms, room, draft.rect, draft.erase)
          : wallCells(view.rooms, room, draft.rect)
        ).map((cell) => ({
          minX: cell.x,
          minY: cell.y,
          maxX: cell.x,
          maxY: cell.y,
        }))
  if (areas.length === 0) return

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  if (draft.erase) ctx.setLineDash([4, 3])
  ctx.fillStyle = color
  for (const area of areas) {
    const diamond = liftCorners(rectCorners(area, view.camera), view.camera, roomLift(room.elevation))
    ctx.beginPath()
    diamondPath(ctx, diamond)
    ctx.globalAlpha = 0.28
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.stroke()
  }
  ctx.restore()

  const last = areas[areas.length - 1]
  if (!last) return
  const pos = lift(
    cellToScreen(last.maxX + 1, last.minY, view.camera),
    view.camera,
    roomLift(room.elevation),
  )
  const label = region
    ? `${region.maxX - region.minX + 1} × ${region.maxY - region.minY + 1}`
    : `${areas.length} tiles`
  const multi = region ? region.maxX > region.minX || region.maxY > region.minY : areas.length > 1
  if (!multi) return
  drawChip(ctx, label, pos.x + 6, pos.y, color)
}

/** A padlock over each locked door and window. */
const OBJECT_FITS = '#78d39b'
const OBJECT_BLOCKED = '#e5484d'

/** The object about to be placed or moved, half see-through, its footprint green where it fits and red where not. */
function drawObjectDraft(ctx: CanvasRenderingContext2D, view: DrawView, draft: ObjectDraft): void {
  const shade = view.tileCache.tileset.shade
  ctx.save()
  ctx.globalAlpha = draft.fits ? 0.75 : 0.45
  drawWholeObject(
    ctx,
    view.camera,
    draft,
    draft.elevation,
    { left: shade.left, right: shade.right, fog: false },
    draft.fits ? OBJECT_FITS : OBJECT_BLOCKED,
  )
  ctx.restore()
}

function drawObjectFocus(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  focus: DrawView['objectFocus'][number],
): void {
  const corners = liftCorners(rectCorners(focus.rect, view.camera), view.camera, roomLift(focus.elevation))
  ctx.beginPath()
  ctx.moveTo(corners.n.x, corners.n.y)
  ctx.lineTo(corners.e.x, corners.e.y)
  ctx.lineTo(corners.s.x, corners.s.y)
  ctx.lineTo(corners.w.x, corners.w.y)
  ctx.closePath()
  ctx.strokeStyle = focus.selected ? SELECT : ACCENT
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawLocks(ctx: CanvasRenderingContext2D, view: DrawView): void {
  for (const room of view.rooms) {
    for (const key of Object.keys(room.openingLocked ?? {})) {
      const { x, y } = parseCellKey(key)
      if (!roomContains(room, x, y) || !openingIsLocked(room, x, y)) continue
      const at = lift(cellCenter(x, y, view.camera), view.camera, roomLift(room.elevation) + WALL_HEIGHT + 6)
      drawPadlock(ctx, at.x, at.y, Math.max(6, 6 * view.camera.zoom))
    }
  }
}

function drawPadlock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const width = size * 1.5
  const top = y - size / 2
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = Math.max(1.5, size * 0.25)
  ctx.beginPath()
  ctx.arc(x, top, width * 0.3, Math.PI, 0)
  ctx.stroke()
  ctx.fillStyle = ACCENT
  ctx.fillRect(x - width / 2, top, width, size)
  ctx.fillStyle = '#0b0c10'
  ctx.fillRect(x - size * 0.1, top + size * 0.3, size * 0.2, size * 0.45)
  ctx.restore()
}

function drawDoorNotice(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  notice: { x: number; y: number; text: string },
): void {
  const room = view.rooms.find((item) => roomContains(item, notice.x, notice.y))
  const at = lift(cellCenter(notice.x, notice.y, view.camera), view.camera, roomLift(room?.elevation) + WALL_HEIGHT)
  ctx.font = '600 12px system-ui, sans-serif'
  const width = ctx.measureText(notice.text).width + 12
  drawChip(ctx, notice.text, at.x - width / 2, at.y - 28, '#f6dcdb')
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const pad = 6
  const height = 20
  const width = ctx.measureText(label).width + pad * 2
  ctx.fillStyle = 'rgba(18, 19, 24, 0.9)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  ctx.fillStyle = color
  ctx.fillText(label, x + pad, y + height / 2 + 0.5)
}

function drawMeasureChip(ctx: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  ctx.save()
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const pad = 6
  const height = 20
  const width = ctx.measureText(label).width + pad * 2
  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 1.5
  ctx.fillStyle = 'rgba(18, 19, 24, 0.82)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = MEASURE
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  ctx.fillStyle = MEASURE
  ctx.fillText(label, x + pad, y + height / 2 + 0.5)
  ctx.restore()
}

function drawRoomLabel(ctx: CanvasRenderingContext2D, view: DrawView, room: Room): void {
  const east = screenCorners(rectCorners(room.rect, view.camera)).e
  const north = lift(east, view.camera, roomLift(room.elevation) + WALL_HEIGHT)
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const pad = 6
  const height = 20
  const width = ctx.measureText(room.name).width + pad * 2
  const x = north.x - width - 4
  const y = north.y - height - 4

  ctx.fillStyle = 'rgba(18, 19, 24, 0.88)'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = HOVER
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  ctx.fillStyle = '#f6dcdb'
  ctx.fillText(room.name, x + pad, y + height / 2 + 0.5)
  if (!roomExplored(room)) {
    drawChip(ctx, 'Unexplored', x, y + height + 4, '#8b8f9c')
  } else if (!view.sight.has(room.id)) {
    drawChip(ctx, 'Out of sight', x, y + height + 4, '#8b8f9c')
  }
}

function drawResizeHandles(ctx: CanvasRenderingContext2D, view: DrawView, room: Room): void {
  outlineRoom(ctx, view, room, ACCENT, 1.5)
  const half = HANDLE_SIZE / 2
  for (const spot of handleSpots(room.rect, view.camera, room.elevation)) {
    ctx.fillStyle = '#1c1d24'
    ctx.fillRect(spot.x - half, spot.y - half, HANDLE_SIZE, HANDLE_SIZE)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2
    ctx.strokeRect(spot.x - half + 1, spot.y - half + 1, HANDLE_SIZE - 2, HANDLE_SIZE - 2)
  }
}

function drawDraft(ctx: CanvasRenderingContext2D, view: DrawView, draft: CellRect): void {
  const diamond = rectCorners(draft, view.camera)
  ctx.beginPath()
  diamondPath(ctx, diamond)
  ctx.fillStyle = 'rgba(232, 196, 104, 0.18)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(232, 196, 104, 0.85)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  const cols = draft.maxX - draft.minX + 1
  const rows = draft.maxY - draft.minY + 1
  const label = `${cols} × ${rows}`
  const pos = screenCorners(diamond).e
  drawChip(ctx, label, pos.x + 6, pos.y, ACCENT)
}
