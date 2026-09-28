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
import { rectContains } from '../model/rect.ts'
import { edgeDelta, rampOccupancy } from '../model/ramps.ts'
import type { RampDraft, RampSlice } from '../model/ramps.ts'
import { cellKey, openingAt, openingIsOpen, spriteAt, stairsAt, stairsBlocks } from '../model/tiles.ts'
import { stairsRegion, wallCells, wallPaintCells } from '../model/tools.ts'
import { sharedWalls } from '../model/walls.ts'
import type { SharedWalls } from '../model/walls.ts'
import type { FeatureDraft, FeatureTool } from '../model/tools.ts'
import type { Camera, Cell, CellRect, ElevationRamp, Link, Player, Room, TileSprite } from '../model/types.ts'
import type { ViewMode } from '../model/visibility.ts'
import { tileVariant } from '../tiles/TileCache.ts'
import type { TileCache } from '../tiles/TileCache.ts'
import type { LinkBadge } from './badges.ts'
import {
  TILE_HEIGHT,
  WALL_HEIGHT,
  cellCenter,
  cellCorners,
  cellToScreen,
  isoDepth,
  lift,
  liftCorners,
  rectCorners,
  rectPaintDepth,
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

const FACE_LEFT: Record<string, string> = {
  wall: '#353840',
  'door-h': '#5a3a1c',
  'door-v': '#5a3a1c',
  'window-h': '#3d5c72',
  'window-v': '#3d5c72',
}

const FACE_RIGHT: Record<string, string> = {
  wall: '#4e525c',
  'door-h': '#7a4e24',
  'door-v': '#7a4e24',
  'window-h': '#547a96',
  'window-v': '#547a96',
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
  movePath: { playerId: string; cells: readonly Cell[]; feet: number } | null
  ghost: { player: Player; x: number; y: number } | null
  tokenPose: { playerId: string; x: number; y: number; tilt: number } | null
  turnPlayerId: string | null
  viewMode: ViewMode
  tileCache: TileCache
}

export function drawMap(ctx: CanvasRenderingContext2D, view: DrawView): void {
  ctx.clearRect(0, 0, view.width, view.height)
  ctx.fillStyle = '#121318'
  ctx.fillRect(0, 0, view.width, view.height)

  const bounds = visibleCellBounds(view)
  drawGrid(ctx, view, bounds)

  const shown = view.viewMode === 'player' ? view.rooms.filter((room) => room.visible) : view.rooms
  const shared = sharedWalls(shown)
  const top = topRoomAtCell(shown)
  const ramps = visibleRamps(view)
  const rampCells = rampOccupancy(ramps, shown)
  if (view.viewMode === 'player') {
    for (const slice of [...rampCells.values()]) {
      const room = occupantRoom(view.rooms, slice.x, slice.y)
      if (room && !room.visible) rampCells.delete(cellKey(slice.x, slice.y))
    }
  }
  const painted: DrawView = { ...view, rooms: shown }
  drawSupports(ctx, painted, top, rampCells)
  drawTiles(ctx, painted, bounds, shared, top, rampCells)
  drawStairsAll(ctx, painted, top, rampCells)
  drawRampChevrons(ctx, painted, top, rampCells)

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

  if (view.feature) drawFeaturePreview(ctx, view, view.feature)
  if (view.rampDraft) drawRampPreview(ctx, view, view.rampDraft)
  if (view.draft) drawDraft(ctx, view, view.draft)
}

function visibleCellBounds(view: DrawView): CellRect {
  const extra = view.rooms.reduce(
    (max, room) => Math.max(max, Math.abs(room.elevation) * 2 + 2),
    2,
  )
  const corners = [
    screenToCell(0, 0, view.camera),
    screenToCell(view.width, 0, view.camera),
    screenToCell(0, view.height, view.camera),
    screenToCell(view.width, view.height, view.camera),
  ]
  const xs = corners.map((cell) => cell.x)
  const ys = corners.map((cell) => cell.y)
  return {
    minX: Math.min(...xs) - extra,
    minY: Math.min(...ys) - extra,
    maxX: Math.max(...xs) + extra,
    maxY: Math.max(...ys) + extra,
  }
}

/** Highest room on each cell — overlapping lower floors must not paint there. */
function topRoomAtCell(rooms: readonly Room[]): Map<string, number> {
  const top = new Map<string, number>()
  rooms.forEach((room, index) => {
    const elevation = room.elevation ?? 0
    const rect = room.rect
    for (let y = rect.minY; y <= rect.maxY; y++) {
      for (let x = rect.minX; x <= rect.maxX; x++) {
        const key = cellKey(x, y)
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
  top: Map<string, number>,
  x: number,
  y: number,
): number {
  const index = top.get(cellKey(x, y))
  if (index === undefined) return 0
  return rooms[index].elevation ?? 0
}

/**
 * How far under this cell the solid should reach: the ground plane for a
 * raised room, or the floor of a lower neighbour (a pit) when one is adjacent.
 */
function supportBottom(
  rooms: readonly Room[],
  top: Map<string, number>,
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
  top: Map<string, number>,
  rampCells: Map<string, RampSlice>,
): void {
  const cells: {
    x: number
    y: number
    hideFace: (nx: number, ny: number) => boolean
    bottom: number
    elevation: number
    depth: number
    dim: boolean
  }[] = []
  view.rooms.forEach((room, roomIndex) => {
    const elevation = room.elevation ?? 0
    const rect = room.rect
    for (let y = rect.minY; y <= rect.maxY; y++) {
      for (let x = rect.minX; x <= rect.maxX; x++) {
        if (top.get(cellKey(x, y)) !== roomIndex) continue
        if (rampCells.has(cellKey(x, y))) continue
        const bottom = supportBottom(view.rooms, top, x, y, elevation)
        if (elevation <= bottom) continue
        cells.push({
          x,
          y,
          bottom,
          elevation,
          depth: isoDepth(x, y, view.camera.yaw),
          dim: view.viewMode === 'dm' && !room.visible,
          hideFace: (nx, ny) =>
            rectContains(room.rect, nx, ny) || elevationAt(view.rooms, top, nx, ny) >= elevation,
        })
      }
    }
  })
  for (const slice of rampCells.values()) {
    if (slice.elevation <= slice.prevElev) continue
    cells.push({
      x: slice.x,
      y: slice.y,
      bottom: slice.prevElev,
      elevation: slice.elevation,
      depth: isoDepth(slice.x, slice.y, view.camera.yaw),
      dim: view.viewMode === 'dm' && occupantRoom(view.rooms, slice.x, slice.y)?.visible === false,
      hideFace: (nx, ny) => {
        const other = rampCells.get(cellKey(nx, ny))
        if (other && other.rampId === slice.rampId && other.slice === slice.slice) return true
        if (other && other.elevation >= slice.elevation) return true
        return !other && elevationAt(view.rooms, top, nx, ny) >= slice.elevation
      },
    })
  }
  cells.sort((a, b) => a.depth - b.depth || a.elevation - b.elevation)
  for (const cell of cells) {
    if (cell.dim) ctx.globalAlpha = 0.42
    drawSupportPrism(ctx, view, cell.x, cell.y, cell.bottom, cell.elevation, cell.hideFace)
    ctx.globalAlpha = 1
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
  stairs: boolean
  open: boolean
  dim: boolean
}

function paintOrder(a: QueuedTile, b: QueuedTile): number {
  return a.depth - b.depth || a.elevation - b.elevation || a.roomIndex - b.roomIndex
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  bounds: CellRect,
  shared: SharedWalls,
  top: Map<string, number>,
  rampCells: Map<string, RampSlice>,
): void {
  const queue: QueuedTile[] = []
  const yaw = view.camera.yaw
  view.rooms.forEach((room, roomIndex) => {
    const elevation = room.elevation ?? 0
    const rect = room.rect
    const minX = Math.max(rect.minX, bounds.minX)
    const maxX = Math.min(rect.maxX, bounds.maxX)
    const minY = Math.max(rect.minY, bounds.minY)
    const maxY = Math.min(rect.maxY, bounds.maxY)
    if (minX > maxX || minY > maxY) return
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (top.get(cellKey(x, y)) !== roomIndex) continue
        if (rampCells.has(cellKey(x, y))) continue
        const opening = openingAt(room, x, y)
        const planted = opening === 'wall' || opening === 'door' || opening === 'window'
        const sprite = shared.has(room.id, x, y) && !planted ? 'floor' : spriteAt(room, x, y)
        const bitmap = view.tileCache.get(sprite, tileVariant(x - rect.minX, y - rect.minY, sprite))
        if (!bitmap) continue
        queue.push({
          x,
          y,
          depth: isoDepth(x, y, yaw),
          elevation,
          roomIndex,
          sprite,
          bitmap,
          stairs: Boolean(stairsAt(room, x, y)),
          open: openingIsOpen(room, x, y),
          dim: view.viewMode === 'dm' && !room.visible,
        })
      }
    }
  })
  const stairsBitmap = view.tileCache.get('stairs', 0)
  if (stairsBitmap) {
    for (const slice of rampCells.values()) {
      queue.push({
        x: slice.x,
        y: slice.y,
        depth: isoDepth(slice.x, slice.y, yaw),
        elevation: slice.elevation,
        roomIndex: view.rooms.length,
        sprite: 'stairs',
        bitmap: stairsBitmap,
        stairs: false,
        open: false,
        dim: view.viewMode === 'dm' && occupantRoom(view.rooms, slice.x, slice.y)?.visible === false,
      })
    }
  }
  queue.sort(paintOrder)
  ctx.imageSmoothingEnabled = true
  for (const tile of queue) {
    drawingUnderOccluders(ctx, view, top, rampCells, tile.x, tile.y, tile.elevation, () => {
      if (tile.dim) ctx.globalAlpha = 0.42
      if (tile.sprite === 'floor' || tile.sprite === 'stairs') {
        drawFloor(ctx, view, tile.x, tile.y, tile.bitmap, tile.elevation)
      } else drawWall(ctx, view, tile.x, tile.y, tile.bitmap, tile.sprite, tile.elevation, tile.open)
      if (tile.stairs && stairsBitmap) {
        drawFloor(ctx, view, tile.x, tile.y, stairsBitmap, tile.elevation)
      }
      ctx.globalAlpha = 1
    })
  }
  ctx.imageSmoothingEnabled = false
}

/** Keep a lower tile from painting inside a higher room's solid volume. */
function drawingUnderOccluders(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  top: Map<string, number>,
  rampCells: Map<string, RampSlice>,
  x: number,
  y: number,
  elevation: number,
  paint: () => void,
): void {
  const yaw = view.camera.yaw
  const tileDepth = isoDepth(x, y, yaw)
  const solids: { ground: IsoCorners; deck: IsoCorners }[] = []
  for (let roomIndex = 0; roomIndex < view.rooms.length; roomIndex++) {
    const room = view.rooms[roomIndex]
    if (!room) continue
    const above = room.elevation ?? 0
    if (above <= elevation) continue
    const rect = room.rect
    const span = Math.abs(above - elevation) * 2 + 2
    const minX = Math.max(rect.minX, x - span)
    const maxX = Math.min(rect.maxX, x + span)
    const minY = Math.max(rect.minY, y - span)
    const maxY = Math.min(rect.maxY, y + span)
    if (minX > maxX || minY > maxY) continue
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (rampCells.has(cellKey(cx, cy))) continue
        if (top.get(cellKey(cx, cy)) !== roomIndex) continue
        // Only nearer cubes occlude. A raised volume behind this tile must
        // not punch a hole — this tile is in front and should paint over it.
        if (isoDepth(cx, cy, yaw) <= tileDepth) continue
        const bottom = supportBottom(view.rooms, top, cx, cy, above)
        if (above <= bottom) continue
        const base = screenCorners(cellCorners(cx, cy, view.camera))
        solids.push({
          ground: liftCorners(base, view.camera, roomLift(bottom)),
          deck: liftCorners(base, view.camera, roomLift(above)),
        })
      }
    }
  }
  for (const slice of rampCells.values()) {
    if (slice.elevation <= elevation) continue
    if (isoDepth(slice.x, slice.y, yaw) <= tileDepth) continue
    if (Math.abs(slice.x - x) > 8 || Math.abs(slice.y - y) > 8) continue
    if (slice.elevation <= slice.prevElev) continue
    const base = screenCorners(cellCorners(slice.x, slice.y, view.camera))
    solids.push({
      ground: liftCorners(base, view.camera, roomLift(slice.prevElev)),
      deck: liftCorners(base, view.camera, roomLift(slice.elevation)),
    })
  }
  if (solids.length === 0) {
    paint()
    return
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, view.width, view.height)
  for (const solid of solids) appendCubePath(ctx, solid.ground, solid.deck)
  ctx.clip('evenodd')
  paint()
  ctx.restore()
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
  sprite: TileSprite,
  elevation: number,
  open = false,
): void {
  const floor = liftCorners(cellCorners(x, y, view.camera), view.camera, roomLift(elevation))
  const top = liftCorners(floor, view.camera, WALL_HEIGHT)
  const [leftFace, rightFace] = visibleWallFaces(floor, top)
  const left = FACE_LEFT[sprite] ?? FACE_LEFT.wall
  const right = FACE_RIGHT[sprite] ?? FACE_RIGHT.wall

  fillWallFace(ctx, leftFace, left ?? '#353840')
  fillWallFace(ctx, rightFace, right ?? '#4e525c')
  mapBitmap(ctx, bitmap, top)

  if (sprite.startsWith('door') || sprite.startsWith('window')) {
    const axis = sprite.endsWith('-h') ? 'h' : 'v'
    const face = leftFace.axis === axis ? leftFace : rightFace
    drawOpeningFace(ctx, face, sprite, open)
  }
}

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

function fillWallFace(ctx: CanvasRenderingContext2D, face: WallFace, color: string): void {
  ctx.beginPath()
  ctx.moveTo(face.lo.x, face.lo.y)
  ctx.lineTo(face.hi.x, face.hi.y)
  ctx.lineTo(face.hiTop.x, face.hiTop.y)
  ctx.lineTo(face.loTop.x, face.loTop.y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
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
  ctx: CanvasRenderingContext2D,
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
  if (faces[0]) fillWallFace(ctx, faces[0], '#2a2c34')
  if (faces[1]) fillWallFace(ctx, faces[1], '#353840')
}

function drawOpeningFace(
  ctx: CanvasRenderingContext2D,
  face: WallFace,
  sprite: TileSprite,
  open: boolean,
): void {
  const color = sprite.startsWith('door') ? '#c4843a' : '#7eb7d6'
  if (open) {
    fillQuad(
      ctx,
      lerp(face.lo, face.hi, 0.12),
      lerp(face.hi, face.lo, 0.12),
      lerp(face.hiTop, face.loTop, 0.12),
      lerp(face.loTop, face.hiTop, 0.12),
      'rgba(8, 8, 12, 0.9)',
    )
    fillQuad(
      ctx,
      lerp(face.lo, face.hi, 0.12),
      lerp(face.lo, face.hi, 0.22),
      lerp(face.loTop, face.hiTop, 0.22),
      lerp(face.loTop, face.hiTop, 0.12),
      color,
    )
    fillQuad(
      ctx,
      lerp(face.hi, face.lo, 0.22),
      lerp(face.hi, face.lo, 0.12),
      lerp(face.hiTop, face.loTop, 0.12),
      lerp(face.hiTop, face.loTop, 0.22),
      color,
    )
    return
  }
  fillQuad(
    ctx,
    lerp(face.lo, face.hi, 0.18),
    lerp(face.hi, face.lo, 0.18),
    lerp(face.hiTop, face.loTop, 0.18),
    lerp(face.loTop, face.hiTop, 0.18),
    'rgba(12, 12, 16, 0.72)',
  )
  fillQuad(
    ctx,
    lerp(face.lo, face.hi, 0.28),
    lerp(face.hi, face.lo, 0.28),
    lerp(lerp(face.hiTop, face.loTop, 0.18), lerp(face.hi, face.lo, 0.18), 0.22),
    lerp(lerp(face.loTop, face.hiTop, 0.18), lerp(face.lo, face.hi, 0.18), 0.22),
    color,
  )
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  color: string,
): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Skew a square bitmap onto an iso diamond. */
function mapBitmap(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, diamond: IsoCorners): void {
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
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, 1, 1)
  ctx.restore()
}

function diamondPath(ctx: CanvasRenderingContext2D, diamond: IsoCorners): void {
  ctx.moveTo(diamond.n.x, diamond.n.y)
  ctx.lineTo(diamond.e.x, diamond.e.y)
  ctx.lineTo(diamond.s.x, diamond.s.y)
  ctx.lineTo(diamond.w.x, diamond.w.y)
  ctx.closePath()
}

function drawStairsAll(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  top: Map<string, number>,
  rampCells: Map<string, RampSlice>,
): void {
  const blocks = view.rooms.flatMap((room, roomIndex) =>
    stairsBlocks(room).map((block) => ({ block, roomIndex, elevation: room.elevation })),
  )
  blocks.sort(
    (a, b) =>
      rectPaintDepth(a.block.rect, view.camera.yaw) -
        rectPaintDepth(b.block.rect, view.camera.yaw) ||
      (a.elevation ?? 0) - (b.elevation ?? 0) ||
      a.roomIndex - b.roomIndex,
  )
  for (const { block, roomIndex, elevation } of blocks) {
    const cx = Math.round((block.rect.minX + block.rect.maxX) / 2)
    const cy = Math.round((block.rect.minY + block.rect.maxY) / 2)
    if (top.get(cellKey(cx, cy)) !== roomIndex) continue
    if (rampCells.has(cellKey(cx, cy))) continue
    drawingUnderOccluders(ctx, view, top, rampCells, cx, cy, elevation ?? 0, () => {
      const mid = lift(
        cellCenter(
          (block.rect.minX + block.rect.maxX) / 2,
          (block.rect.minY + block.rect.maxY) / 2,
          view.camera,
        ),
        view.camera,
        roomLift(elevation),
      )
      const cols = block.rect.maxX - block.rect.minX + 1
      const rows = block.rect.maxY - block.rect.minY + 1
      const half = Math.min(cols, rows) * TILE_HEIGHT * view.camera.zoom * 0.22
      ctx.fillStyle = '#1a1b21'
      if (block.dir === 'both') {
        chevron(ctx, mid.x, mid.y - half * 1.1, half, true)
        chevron(ctx, mid.x, mid.y + half * 1.1, half, false)
      } else {
        chevron(ctx, mid.x, mid.y, half * 1.4, block.dir === 'up')
      }
    })
  }
}

function chevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  half: number,
  up: boolean,
): void {
  const tip = up ? cy - half * 0.7 : cy + half * 0.7
  const base = up ? cy + half * 0.7 : cy - half * 0.7
  ctx.beginPath()
  ctx.moveTo(cx - half, base)
  ctx.lineTo(cx, tip)
  ctx.lineTo(cx + half, base)
  ctx.closePath()
  ctx.fill()
}

function chevronToward(ctx: CanvasRenderingContext2D, from: Point, to: Point, half: number): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const tip = { x: from.x + ux * half * 0.7, y: from.y + uy * half * 0.7 }
  const base = { x: from.x - ux * half * 0.45, y: from.y - uy * half * 0.45 }
  ctx.beginPath()
  ctx.moveTo(base.x + px * half, base.y + py * half)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(base.x - px * half, base.y - py * half)
  ctx.closePath()
  ctx.fill()
}

function drawRampChevrons(
  ctx: CanvasRenderingContext2D,
  view: DrawView,
  top: Map<string, number>,
  rampCells: Map<string, RampSlice>,
): void {
  const half = TILE_HEIGHT * view.camera.zoom * 0.28
  ctx.fillStyle = '#1a1b21'
  for (const slice of rampCells.values()) {
    drawingUnderOccluders(ctx, view, top, rampCells, slice.x, slice.y, slice.elevation, () => {
      const from = lift(
        cellCenter(slice.x, slice.y, view.camera),
        view.camera,
        roomLift(slice.elevation),
      )
      const step = edgeDelta(slice.up)
      const to = lift(
        cellCenter(slice.x + step.dx, slice.y + step.dy, view.camera),
        view.camera,
        roomLift(slice.elevation + Math.max(0, slice.elevation - slice.prevElev)),
      )
      chevronToward(ctx, from, to, half)
    })
  }
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
    ? 'Erase ramp'
    : ramp
      ? `${ramp.fromElev} → ${ramp.toElev}`
      : 'Ramp'
  drawChip(ctx, label, east.x + 6, east.y, color)
}

function drawMovePath(ctx: CanvasRenderingContext2D, view: DrawView): void {
  const path = view.movePath
  if (!path || path.cells.length < 2) return
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
  const pose = view.tokenPose
  if (pose && pose.playerId === player.id) return pose
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
    if (!player.visible) ctx.globalAlpha = 0.42
    else if (statuses.includes('invisible')) ctx.globalAlpha = 0.38
    if (air > 0) {
      const ground = playerGroundCenterAt(player, cell.x, cell.y, view.rooms, view.ramps, view.camera)
      drawAirShadow(ctx, ground, standee)
      drawAirColumn(ctx, ground, pos, standee)
    }
    const turnWreath =
      player.id === view.turnPlayerId && (view.viewMode !== 'player' || player.visible)
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

    const trail = view.movePath
    const walking = view.tokenPose?.playerId === player.id
    if (walking && trail && trail.playerId === player.id && trail.feet > 0) {
      drawMeasureChip(
        ctx,
        `${trail.feet} ft`,
        pos.x + standee.width / 2 + 6,
        pos.y - standee.height + standee.tab,
      )
    }
    ctx.globalAlpha = 1
  }
  drawGhostToken(ctx, view)
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

function drawGhostToken(ctx: CanvasRenderingContext2D, view: DrawView): void {
  const ghost = view.ghost
  if (!ghost) return
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
  const trail = view.movePath
  if (trail && trail.playerId === player.id && trail.feet > 0) {
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
  if (!room.visible) {
    drawChip(ctx, 'Hidden', x, y + height + 4, '#8b8f9c')
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
