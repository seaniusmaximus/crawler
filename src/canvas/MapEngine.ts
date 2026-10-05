import { sameLink } from '../model/links.ts'
import { normalizeRect, resizeRect, topmostRoomAt, translateRect } from '../model/rect.ts'
import { featureAt, isFeatureTool, pendingFeature, stairsRegion, wallCells, wallPaintCells } from '../model/tools.ts'
import type { FeatureDraft, FeatureTool, Tool } from '../model/tools.ts'
import { pathFeet, tokenTrail } from '../model/movement.ts'
import { stairsEnteredOnPath, stairExits } from '../model/stairs.ts'
import { travelPose } from '../model/travel.ts'
import type { TokenTravel } from '../model/travel.ts'
import {
  canPlacePlayer,
  occupantRoom,
  playerCenter,
  playerHover,
  playerSize,
} from '../model/players.ts'
import { rampAt, rampFromDrag } from '../model/ramps.ts'
import type { RampDraft } from '../model/ramps.ts'
import { shownRooms, nextShownFloor } from '../model/visibility.ts'
import type { Cell, CellRect, Edge, Link, Player, Room } from '../model/types.ts'
import { useDungeonStore } from '../state/dungeonStore.ts'
import { useEditorStore } from '../state/editorStore.ts'
import { canControlPlayer, useSessionStore } from '../state/sessionStore.ts'
import { remoteTravelAnimating, useTravelStore, type RemoteTravel } from '../state/travelStore.ts'
import type { FocusRequest } from '../state/editorStore.ts'
import { getActiveFloor } from '../state/selectors.ts'
import { TileCache } from '../tiles/TileCache.ts'
import { tilesetById } from '../tiles/sets/index.ts'
import { hitLinkBadge, linkBadges } from './badges.ts'
import type { LinkBadge } from './badges.ts'
import { LEVEL_HEIGHT, cellToWorld, cameraFocused, centerOnWorld, panBy, screenToCell, zoomAt } from './camera.ts'
import { drawMap } from './draw.ts'
import { edgeCursor, hitHandle } from './handles.ts'
import {
  cellElevation,
  cellOnRoom,
  hitGhostToken,
  hitOpening,
  hitRoom,
  hitToken,
  pickTokenAnchor,
} from './pick.ts'

const DRAG_THRESHOLD = 4
const FOCUS_MS = 240

const TOOL_KEYS: Record<string, Tool> = {
  KeyH: 'select',
  KeyR: 'rooms',
  KeyD: 'doors',
  KeyW: 'windows',
  KeyS: 'stairs',
  KeyA: 'walls',
  KeyL: 'link',
}

type PointerMode = 'paint' | 'pan' | 'move' | 'resize' | 'feature' | 'link' | 'pick' | 'ramp' | 'token'

interface TokenDrag {
  id: string
  floorId: string
  x: number
  y: number
  origin: Cell
  waypoints: Cell[]
}

interface MovePath {
  playerId: string
  cells: readonly Cell[]
  feet: number
}

type Ghost = { player: Player; x: number; y: number }
type Pose = { playerId: string; x: number; y: number; tilt: number }

interface PointerSession {
  id: number
  mode: PointerMode
  link: Link | null
  startX: number
  startY: number
  lastX: number
  lastY: number
  startCellX: number
  startCellY: number
  roomId: string | null
  startRect: CellRect | null
  edge: Edge | null
  moved: boolean
}

function singleCell(x: number, y: number): CellRect {
  return { minX: x, minY: y, maxX: x, maxY: y }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

interface CameraTween {
  fromX: number
  fromY: number
  toX: number
  toY: number
  zoom: number
  start: number
}

export class MapEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private tiles = new TileCache(tilesetById(useDungeonStore.getState().dungeon.tileset))
  /** A tileset still loading; it replaces `tiles` once ready. */
  private pendingTiles: TileCache | null = null
  private readonly unsubs: Array<() => void> = []
  private resizeObserver: ResizeObserver | null = null
  private raf = 0
  private dirty = true
  private width = 0
  private height = 0
  private centered = false
  private spaceDown = false
  private hoverCell: { x: number; y: number } | null = null
  private draft: CellRect | null = null
  private hoverFeature: FeatureDraft | null = null
  private dragFeature: FeatureDraft | null = null
  private hoverRamp: RampDraft | null = null
  private dragRamp: RampDraft | null = null
  private tokenDrag: TokenDrag | null = null
  private travelFinishing = false
  private portraits = new Map<string, HTMLImageElement>()
  private hoverLink: Link | null = null
  private session: PointerSession | null = null
  private tween: CameraTween | null = null
  private lastFocusNonce = 0
  private destroyed = false

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Could not create 2D context')
    this.canvas = canvas
    this.ctx = ctx
  }

  async start(): Promise<void> {
    this.bind()
    await this.tiles.init()
    if (this.destroyed) {
      this.tiles.destroy()
      return
    }
    this.resize()
    this.loop()
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver?.disconnect()
    this.tiles.destroy()
    this.pendingTiles?.destroy()
    this.pendingTiles = null
    for (const unsub of this.unsubs) unsub()
    this.unsubs.length = 0
  }

  private bind(): void {
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.canvas)

    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('contextmenu', this.onContextMenu, { capture: true })
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)

    this.unsubs.push(
      () => this.canvas.removeEventListener('pointerdown', this.onPointerDown),
      () => this.canvas.removeEventListener('pointermove', this.onPointerMove),
      () => this.canvas.removeEventListener('pointerup', this.onPointerUp),
      () => this.canvas.removeEventListener('pointercancel', this.onPointerUp),
      () => this.canvas.removeEventListener('pointerleave', this.onPointerLeave),
      () => this.canvas.removeEventListener('contextmenu', this.onContextMenu, { capture: true }),
      () => this.canvas.removeEventListener('wheel', this.onWheel),
      () => window.removeEventListener('keydown', this.onKeyDown),
      () => window.removeEventListener('keyup', this.onKeyUp),
      useDungeonStore.subscribe((state) => {
        this.syncTileset(state.dungeon.tileset)
        this.markDirty()
      }),
      useTravelStore.subscribe(() => this.markDirty()),
      useEditorStore.subscribe((state, prev) => {
        this.markDirty()
        if (state.viewMode !== prev.viewMode && !this.session) this.applyCursor(null)
        if (state.focus && state.focus.nonce !== this.lastFocusNonce) {
          this.lastFocusNonce = state.focus.nonce
          this.startFocus(state.focus)
        }
      }),
    )
  }

  /**
   * Swaps in a new tile cache when the dungeon's tileset changes. The old one
   * keeps drawing until the new sheet is sliced, so the map never blanks.
   */
  private syncTileset(id: string | undefined): void {
    const tileset = tilesetById(id)
    if (tileset === this.pendingTiles?.tileset) return
    this.pendingTiles?.destroy()
    this.pendingTiles = null
    if (tileset === this.tiles.tileset) return
    const next = new TileCache(tileset)
    this.pendingTiles = next
    void next.init().then(() => {
      if (this.pendingTiles !== next || this.destroyed) return
      this.pendingTiles = null
      this.tiles.destroy()
      this.tiles = next
      this.markDirty()
    })
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    this.advanceTween()
    const dungeon = useDungeonStore.getState().dungeon
    const travel = dungeon.travel
    if (travel?.phase === 'playing') {
      this.dirty = true
      if (travelPose(travel, Date.now()).done) this.concludeTravel(travel)
    } else {
      this.travelFinishing = false
    }
    // Other people's walks: keep animating, and let finished ones go once the DM's move lands.
    const remote = useTravelStore.getState().remote
    const now = Date.now()
    if (remoteTravelAnimating(remote, now)) this.dirty = true
    if (Object.values(remote).some((item) => item.endedAt !== null)) {
      useTravelStore.getState().settle(dungeon.players ?? [], now)
    }
    if (!this.dirty || !this.tiles.isReady()) return
    this.dirty = false
    const editor = useEditorStore.getState()
    const floor = getActiveFloor()
    this.syncPortraits(dungeon.players ?? [])
    const players = this.visiblePlayers(dungeon.players ?? [], floor.id)
    drawMap(this.ctx, {
      width: this.width,
      height: this.height,
      camera: editor.camera,
      rooms: floor.rooms,
      selectedRoomId: editor.selectedRoomId,
      hoverRoomId: editor.hoverRoomId,
      resizeRoomId: editor.resizeRoomId,
      linkRoomId: editor.linkRoomId,
      draft: this.draft,
      feature: this.dragFeature ?? this.hoverFeature,
      rampDraft: this.dragRamp ?? this.hoverRamp,
      ramps: floor.ramps ?? [],
      players,
      selectedPlayerId: editor.selectedPlayerId,
      hoverPlayerId: editor.hoverPlayerId,
      portraits: this.portraits,
      movePaths: this.liveMovePaths(players),
      ghosts: this.ghostTokens(players),
      tokenPoses: this.liveTokenPoses(dungeon.travel, players),
      turnPlayerId: dungeon.combat?.turnPlayerId ?? null,
      badges: this.badges(),
      hoverLink: this.hoverLink,
      viewMode: editor.viewMode,
      tileCache: this.tiles,
    })
  }

  private badges(): LinkBadge[] {
    if (useEditorStore.getState().viewMode === 'player') return []
    const floor = getActiveFloor()
    return linkBadges(this.viewRooms(), floor.links, useEditorStore.getState().camera)
  }

  private startFocus(focus: FocusRequest): void {
    const dungeon = useDungeonStore.getState().dungeon
    const { camera } = useEditorStore.getState()
    if (focus.playerId) {
      const player = (dungeon.players ?? []).find((item) => item.id === focus.playerId)
      if (!player) return
      if (player.floorId !== getActiveFloor().id) {
        useEditorStore.getState().setActiveFloor(player.floorId)
      }
      const floor = dungeon.floors.find((item) => item.id === player.floorId)
      const mid = playerCenter(player.x, player.y, playerSize(player))
      const world = cellToWorld(mid.x + 0.5, mid.y + 0.5, camera.yaw)
      const elevation = floor
        ? cellElevation(floor.rooms, floor.ramps ?? [], player.x, player.y) + playerHover(player)
        : 0
      const target = cameraFocused(
        world.x,
        world.y - elevation * LEVEL_HEIGHT,
        (focus.leftInset + this.width) / 2,
        this.height / 2,
        camera.zoom,
        camera.yaw,
      )
      this.tweenTo(camera, target)
      return
    }
    const room = getActiveFloor().rooms.find((item) => item.id === focus.roomId)
    if (!room) return
    const world = cellToWorld(
      (room.rect.minX + room.rect.maxX + 1) / 2,
      (room.rect.minY + room.rect.maxY + 1) / 2,
      camera.yaw,
    )
    const target = cameraFocused(
      world.x,
      world.y - (room.elevation ?? 0) * LEVEL_HEIGHT,
      (focus.leftInset + this.width) / 2,
      this.height / 2,
      camera.zoom,
      camera.yaw,
    )
    this.tweenTo(camera, target)
  }

  private tweenTo(camera: { x: number; y: number; zoom: number }, target: { x: number; y: number }): void {
    this.tween = {
      fromX: camera.x,
      fromY: camera.y,
      toX: target.x,
      toY: target.y,
      zoom: camera.zoom,
      start: performance.now(),
    }
  }

  private advanceTween(): void {
    const tween = this.tween
    if (!tween) return
    const progress = Math.min(1, (performance.now() - tween.start) / FOCUS_MS)
    const eased = 1 - (1 - progress) ** 3
    const store = useEditorStore.getState()
    store.setCamera({
      x: tween.fromX + (tween.toX - tween.fromX) * eased,
      y: tween.fromY + (tween.toY - tween.fromY) * eased,
      zoom: tween.zoom,
      yaw: store.camera.yaw,
    })
    if (progress >= 1) this.tween = null
    this.markDirty()
  }

  private markDirty(): void {
    this.dirty = true
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.floor(this.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(this.height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    useEditorStore.getState().setViewport(this.width, this.height)
    if (!this.centered && rect.width > 1 && rect.height > 1) {
      useEditorStore.getState().setCamera(centerOnWorld(this.width, this.height, 0, 0, 1.25))
      this.centered = true
    }
    this.markDirty()
  }

  private eventPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  private cellAt(sx: number, sy: number, room: Room | null = null) {
    const camera = useEditorStore.getState().camera
    return room ? cellOnRoom(sx, sy, room, camera) : screenToCell(sx, sy, camera)
  }

  private viewRooms(): Room[] {
    return shownRooms(getActiveFloor().rooms, useEditorStore.getState().viewMode)
  }

  private roomAt(sx: number, sy: number): Room | undefined {
    return hitRoom(this.viewRooms(), sx, sy, useEditorStore.getState().camera)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return

    // Right-click while dragging a token pins a turn without ending the drag.
    if (event.button === 2 && this.session?.mode === 'token') {
      this.pinTokenWaypoint()
      event.preventDefault()
      return
    }

    const editor = useEditorStore.getState()
    editor.closeMenu()
    this.tween = null

    const point = this.eventPoint(event)
    const rooms = getActiveFloor().rooms
    const hit = this.roomAt(point.x, point.y)
    const cell = this.cellAt(point.x, point.y, hit ?? null)
    const tool = editor.tool
    const playerView = editor.viewMode === 'player'
    const pan =
      playerView ||
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && (this.spaceDown || event.altKey))

    let mode: PointerMode = pan ? 'pan' : 'paint'
    let roomId: string | null = null
    let startRect: CellRect | null = null
    let edge: Edge | null = null

    // Tokens sit on the map; grabbing one wins over drawing tools.
    const badge = pan || playerView ? null : hitLinkBadge(this.badges(), point.x, point.y)
    const floor = getActiveFloor()
    const dungeon = useDungeonStore.getState().dungeon
    const travel = dungeon.travel
    const players = this.visiblePlayers(dungeon.players ?? [], floor.id)
    let token =
      event.button !== 0 || badge || this.spaceDown || event.altKey || travel?.phase === 'playing'
        ? undefined
        : hitToken(players, floor.id, rooms, floor.ramps ?? [], point.x, point.y, editor.camera)
    let fromGhost = false
    if (
      !token &&
      travel?.phase === 'preview' &&
      travel.floorId === floor.id &&
      event.button === 0 &&
      !badge &&
      !this.spaceDown &&
      !event.altKey
    ) {
      const ghostPlayer = players.find((item) => item.id === travel.playerId)
      if (
        ghostPlayer &&
        canControlPlayer(ghostPlayer.id) &&
        hitGhostToken(
          ghostPlayer,
          travel.ghostX,
          travel.ghostY,
          rooms,
          floor.ramps ?? [],
          point.x,
          point.y,
          editor.camera,
        )
      ) {
        token = ghostPlayer
        fromGhost = true
      }
    }
    if (badge) {
      mode = 'link'
    } else if (token && canControlPlayer(token.id)) {
      mode = 'token'
      const cells = fromGhost && travel?.playerId === token.id ? travel.cells : []
      this.tokenDrag = {
        id: token.id,
        floorId: fromGhost && travel ? travel.floorId : token.floorId,
        x: fromGhost && travel ? travel.ghostX : token.x,
        y: fromGhost && travel ? travel.ghostY : token.y,
        origin: { x: token.x, y: token.y },
        waypoints: cells.length >= 2 ? cells.slice(1, -1) : [],
      }
      editor.selectPlayer(token.id)
    } else if (!pan && tool === 'link') {
      mode = 'pick'
      roomId = hit?.id ?? null
    } else if (!pan && tool === 'ramp') {
      mode = hit ? 'ramp' : 'pan'
      roomId = hit?.id ?? null
      if (hit) {
        this.dragRamp = this.rampDraftFor(
          { x: cell.x, y: cell.y },
          { x: cell.x, y: cell.y },
          hit,
          hit,
        )
      }
    } else if (!pan && isFeatureTool(tool)) {
      // Feature tools only bite inside a room; elsewhere the drag pans instead.
      mode = hit ? 'feature' : 'pan'
      roomId = hit?.id ?? null
      if (hit) {
        this.dragFeature = this.draftFor(hit.id, tool, singleCell(cell.x, cell.y))
      }
    } else if (!pan && tool === 'select') {
      if (hit) {
        mode = 'move'
        roomId = hit.id
        startRect = hit.rect
        editor.selectRoom(hit.id)
      } else {
        mode = 'pan'
        editor.selectRoom(null)
        editor.selectPlayer(null)
      }
    } else if (!pan) {
      const resizing = rooms.find((room) => room.id === editor.resizeRoomId)
      const grabbed = resizing
        ? hitHandle(resizing.rect, editor.camera, point.x, point.y, resizing.elevation)
        : null
      if (resizing && grabbed) {
        mode = 'resize'
        roomId = resizing.id
        startRect = resizing.rect
        edge = grabbed
      } else {
        if (resizing && hit?.id !== resizing.id) editor.endResize()
        if (hit) {
          mode = 'move'
          roomId = hit.id
          startRect = hit.rect
          editor.selectRoom(hit.id)
        }
      }
    }

    this.session = {
      id: event.pointerId,
      mode,
      link: badge?.link ?? null,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      startCellX: cell.x,
      startCellY: cell.y,
      roomId,
      startRect,
      edge,
      moved: false,
    }
    try {
      this.canvas.setPointerCapture(event.pointerId)
    } catch {
      // untrusted / already captured
    }
    if (mode === 'link' || mode === 'pick') this.applyCursor('pointer')
    else this.applyCursor(mode === 'pan' || mode === 'move' || mode === 'token' ? 'grabbing' : null)
    event.preventDefault()
  }

  private onPointerMove = (event: PointerEvent): void => {
    const point = this.eventPoint(event)
    const session = this.session
    if (!session || session.id !== event.pointerId) {
      this.updateHover(point.x, point.y)
      return
    }

    if (Math.hypot(point.x - session.startX, point.y - session.startY) > DRAG_THRESHOLD) {
      session.moved = true
    }

    if (session.mode === 'pan' && session.moved) {
      const store = useEditorStore.getState()
      store.setCamera(panBy(store.camera, point.x - session.lastX, point.y - session.lastY))
    }

    if (session.mode === 'pick' && session.moved) {
      const store = useEditorStore.getState()
      store.setCamera(panBy(store.camera, point.x - session.lastX, point.y - session.lastY))
    }

    if (session.mode === 'paint' && session.moved) {
      const cell = this.cellAt(point.x, point.y)
      this.draft = normalizeRect(session.startCellX, session.startCellY, cell.x, cell.y)
      this.markDirty()
    }

    if (session.mode === 'feature' && this.dragFeature) {
      const room = this.lookupRoom(session.roomId)
      const cell = this.cellAt(point.x, point.y, room)
      const rect = normalizeRect(session.startCellX, session.startCellY, cell.x, cell.y)
      this.dragFeature = { ...this.dragFeature, rect }
      this.markDirty()
    }

    if (session.mode === 'ramp' && session.roomId) {
      const startRoom = this.lookupRoom(session.roomId)
      const hit = this.roomAt(point.x, point.y)
      const cell = this.cellAt(point.x, point.y, hit ?? null)
      this.dragRamp = this.rampDraftFor(
        { x: session.startCellX, y: session.startCellY },
        cell,
        startRoom,
        hit ?? null,
      )
      this.markDirty()
    }

    if (session.mode === 'token' && session.moved && this.tokenDrag) {
      const floor = getActiveFloor()
      const players = useDungeonStore.getState().dungeon.players ?? []
      const moving = players.find((player) => player.id === this.tokenDrag?.id)
      const size = moving ? playerSize(moving) : 1
      const dest = pickTokenAnchor(
        this.viewRooms(),
        floor.ramps ?? [],
        point.x,
        point.y,
        useEditorStore.getState().camera,
        size,
      )
      if (
        dest &&
        canPlacePlayer(
          this.viewRooms(),
          players,
          floor.id,
          dest.x,
          dest.y,
          size,
          floor.ramps ?? [],
          this.tokenDrag.id,
        ) &&
        (dest.x !== this.tokenDrag.x || dest.y !== this.tokenDrag.y || floor.id !== this.tokenDrag.floorId)
      ) {
        this.tokenDrag = { ...this.tokenDrag, floorId: floor.id, x: dest.x, y: dest.y }
        this.publishDragTravel()
        this.markDirty()
      }
    }

    if (session.mode === 'move' && session.moved && session.roomId && session.startRect) {
      const room = this.lookupRoom(session.roomId)
      const cell = this.cellAt(point.x, point.y, room)
      const moved = translateRect(
        session.startRect,
        cell.x - session.startCellX,
        cell.y - session.startCellY,
      )
      useDungeonStore.getState().moveRoom(getActiveFloor().id, session.roomId, moved)
    }

    if (session.mode === 'resize' && session.roomId && session.startRect && session.edge) {
      const room = this.lookupRoom(session.roomId)
      const cell = this.cellAt(point.x, point.y, room)
      const resized = resizeRect(session.startRect, session.edge, cell.x, cell.y)
      useDungeonStore.getState().resizeRoom(getActiveFloor().id, session.roomId, resized)
    }

    session.lastX = point.x
    session.lastY = point.y
  }

  private onPointerUp = (event: PointerEvent): void => {
    const session = this.session
    if (!session || session.id !== event.pointerId) return
    if (session.mode === 'token' && event.button === 2) {
      event.preventDefault()
      return
    }
    this.session = null
    try {
      this.canvas.releasePointerCapture(event.pointerId)
    } catch {
      // capture already released
    }

    if (session.mode === 'paint') this.finishPaint(session)
    if (session.mode === 'feature') this.commitFeature()
    if (session.mode === 'ramp') this.commitRamp()
    if (session.mode === 'token') this.commitToken(session.moved)
    if (session.mode === 'link' && session.link && !session.moved) {
      useDungeonStore.getState().unlinkRooms(getActiveFloor().id, session.link)
      useEditorStore.getState().setLinkRoom(null)
    }
    if (session.mode === 'pick' && !session.moved) this.finishLinkPick(session)
    if (session.mode === 'pan' && !session.moved && event.button === 0) {
      if (!this.tryPlayTravelAt(session.startX, session.startY)) {
        this.toggleOpeningAt(session.startX, session.startY)
      }
    }
    if (session.mode === 'pan' && !session.moved && event.button === 2) {
      this.openContextMenu(session, event)
    }
    if (event.button === 2) event.preventDefault()

    this.draft = null
    this.updateHover(session.lastX, session.lastY)
    this.markDirty()
  }

  private onPointerLeave = (): void => {
    if (this.session) return
    this.hoverCell = null
    this.hoverFeature = null
    this.hoverRamp = null
    this.hoverLink = null
    useEditorStore.getState().setHoverRoom(null)
    useEditorStore.getState().setHoverPlayer(null)
    this.markDirty()
  }

  /** A draft carries what the run would write, so hover and drag agree. */
  private draftFor(roomId: string, tool: FeatureTool, rect: CellRect): FeatureDraft | null {
    const rooms = getActiveFloor().rooms
    const room = rooms.find((item) => item.id === roomId)
    if (!room) return null
    const editor = useEditorStore.getState()
    const wanted = pendingFeature(tool, editor.doorStyle, editor.stairsDir)
    // Starting on a tile that already has exactly this feature erases the run.
    const erase = featureAt(rooms, room, rect.minX, rect.minY, tool) === wanted
    return { roomId, rect, tool, erase }
  }

  private commitFeature(): void {
    const draft = this.dragFeature
    this.dragFeature = null
    if (!draft) return
    const floor = getActiveFloor()
    const room = floor.rooms.find((item) => item.id === draft.roomId)
    if (!room) return

    const editor = useEditorStore.getState()
    const dungeon = useDungeonStore.getState()

    if (draft.tool === 'stairs') {
      const region = stairsRegion(room, draft.rect)
      if (!region) return
      const orphans = dungeon.setStairs(
        floor.id,
        room.id,
        region,
        draft.erase ? null : editor.stairsDir,
      )
      if (orphans.length > 0) editor.promptStairLandings(orphans)
      return
    }

    if (draft.tool === 'walls') {
      const cells = wallPaintCells(floor.rooms, room, draft.rect, draft.erase)
      dungeon.paintWalls(floor.id, room.id, cells, !draft.erase)
      return
    }

    const cells = wallCells(floor.rooms, room, draft.rect)
    if (cells.length === 0) return
    const opening = draft.tool === 'windows' ? 'window' : editor.doorStyle
    dungeon.setOpenings(floor.id, room.id, cells, draft.erase ? null : opening)
  }

  private rampDraftFor(
    start: { x: number; y: number },
    end: { x: number; y: number },
    startRoom: Room | null,
    endRoom: Room | null,
  ): RampDraft | null {
    if (!startRoom) return null
    const floor = getActiveFloor()
    const ramps = floor.ramps ?? []
    const existing = rampAt(ramps, start.x, start.y)
    const rect = normalizeRect(start.x, start.y, end.x, end.y)
    if (existing) {
      return { erase: true, rect, ramp: existing }
    }
    const dest = endRoom ?? topmostRoomAt(floor.rooms, end.x, end.y)
    if (!dest) return null
    const ramp = rampFromDrag(start, end, startRoom.elevation ?? 0, dest.elevation ?? 0)
    if (!ramp) return null
    return { erase: false, rect, ramp }
  }

  private commitRamp(): void {
    const draft = this.dragRamp
    this.dragRamp = null
    if (!draft) return
    const floor = getActiveFloor()
    const dungeon = useDungeonStore.getState()
    if (draft.erase) {
      dungeon.eraseRamps(floor.id, draft.rect)
      return
    }
    if (draft.ramp) dungeon.addRamp(floor.id, draft.ramp)
  }

  private commitToken(moved: boolean): void {
    const drag = this.tokenDrag
    this.tokenDrag = null
    if (!drag) return
    if (moved) {
      this.publishDragTravel(drag)
      return
    }
    const travel = useDungeonStore.getState().dungeon.travel
    if (travel?.phase === 'preview' && travel.playerId === drag.id) this.playCurrentTravel()
  }

  private pinTokenWaypoint(): void {
    const drag = this.tokenDrag
    if (!drag) return
    const last = drag.waypoints[drag.waypoints.length - 1] ?? drag.origin
    if (last.x === drag.x && last.y === drag.y) return
    this.tokenDrag = {
      ...drag,
      waypoints: [...drag.waypoints, { x: drag.x, y: drag.y }],
    }
    this.publishDragTravel()
    this.markDirty()
  }

  private publishDragTravel(drag = this.tokenDrag): void {
    if (!drag) return
    const cells = tokenTrail(drag.origin, drag.waypoints, { x: drag.x, y: drag.y })
    if (cells.length < 2) return
    const travel: TokenTravel = {
      playerId: drag.id,
      floorId: drag.floorId,
      cells,
      ghostX: drag.x,
      ghostY: drag.y,
      feet: pathFeet(cells),
      phase: 'preview',
      playAt: null,
      seq: 0,
    }
    useDungeonStore.getState().setTravel(travel)
    useSessionStore.getState().reportTravel(useDungeonStore.getState().dungeon.travel)
  }

  private playCurrentTravel(): void {
    useDungeonStore.getState().playTravel()
    useSessionStore.getState().reportTravel(useDungeonStore.getState().dungeon.travel)
  }

  private tryPlayTravelAt(sx: number, sy: number): boolean {
    const travel = useDungeonStore.getState().dungeon.travel
    if (!travel || travel.phase !== 'preview' || travel.cells.length < 2) return false
    const editor = useEditorStore.getState()
    if (editor.viewMode === 'player') {
      const opening = hitOpening(this.viewRooms(), sx, sy, editor.camera)
      if (opening) return false
    }
    this.playCurrentTravel()
    return true
  }

  private concludeTravel(travel: TokenTravel): void {
    if (this.travelFinishing) return
    this.travelFinishing = true
    if (!canControlPlayer(travel.playerId)) return
    useDungeonStore.getState().finishTravel()
    useSessionStore.getState().reportMove(travel.playerId, travel.floorId, travel.ghostX, travel.ghostY)
    useSessionStore.getState().reportTravel(null)
    this.offerStairs(travel)
  }

  private offerStairs(travel: TokenTravel): void {
    const dungeon = useDungeonStore.getState().dungeon
    const floor = dungeon.floors.find((item) => item.id === travel.floorId)
    const player = (dungeon.players ?? []).find((item) => item.id === travel.playerId)
    if (!floor || !player) return
    const hit = stairsEnteredOnPath(floor.rooms, travel.cells, playerSize(player))
    if (!hit) return
    const exits = stairExits(dungeon.floors, floor, hit.room, hit.x, hit.y)
    if (exits.length === 0) return
    useEditorStore.getState().promptStairUse({
      playerId: travel.playerId,
      x: hit.x,
      y: hit.y,
      exits,
    })
  }

  private liveMovePath(): MovePath | null {
    const drag = this.tokenDrag
    if (drag) {
      const cells = tokenTrail(drag.origin, drag.waypoints, { x: drag.x, y: drag.y })
      if (cells.length >= 2) {
        return { playerId: drag.id, cells, feet: pathFeet(cells) }
      }
    }
    const travel = useDungeonStore.getState().dungeon.travel
    if (!travel || travel.cells.length < 2) return null
    if (travel.floorId !== getActiveFloor().id) return null
    return { playerId: travel.playerId, cells: travel.cells, feet: travel.feet }
  }

  private ghostToken(players: readonly Player[]): { player: Player; x: number; y: number } | null {
    const drag = this.tokenDrag
    if (drag) {
      const player = players.find((item) => item.id === drag.id)
      if (player && (drag.x !== player.x || drag.y !== player.y || drag.floorId !== player.floorId)) {
        return { player, x: drag.x, y: drag.y }
      }
    }
    const travel = useDungeonStore.getState().dungeon.travel
    if (!travel || travel.phase !== 'preview') return null
    if (travel.floorId !== getActiveFloor().id) return null
    const player = players.find((item) => item.id === travel.playerId)
    if (!player) return null
    if (travel.ghostX === player.x && travel.ghostY === player.y) return null
    return { player, x: travel.ghostX, y: travel.ghostY }
  }

  /**
   * Other people's paths on this floor, for tokens this viewer can see and isn't
   * moving itself (its own drag or walk wins).
   */
  private remoteTravels(players: readonly Player[]): RemoteTravel[] {
    const own = new Set([this.tokenDrag?.id, useDungeonStore.getState().dungeon.travel?.playerId])
    const floorId = getActiveFloor().id
    return Object.values(useTravelStore.getState().remote).filter(
      (travel) =>
        travel.floorId === floorId && !own.has(travel.playerId) && players.some((item) => item.id === travel.playerId),
    )
  }

  /**
   * Paths for every token being moved. `players` is what this view may show (in
   * player view, no hidden tokens), so a hidden monster's path never draws there,
   * whoever is moving it.
   */
  private liveMovePaths(players: readonly Player[]): MovePath[] {
    const paths: MovePath[] = []
    const own = this.liveMovePath()
    if (own && players.some((item) => item.id === own.playerId)) paths.push(own)
    for (const travel of this.remoteTravels(players)) {
      if (travel.endedAt === null && travel.cells.length >= 2) {
        paths.push({ playerId: travel.playerId, cells: travel.cells, feet: travel.feet })
      }
    }
    return paths
  }

  private ghostTokens(players: readonly Player[]): Ghost[] {
    const ghosts: Ghost[] = []
    const own = this.ghostToken(players)
    if (own) ghosts.push(own)
    for (const travel of this.remoteTravels(players)) {
      if (travel.phase !== 'preview') continue
      const player = players.find((item) => item.id === travel.playerId)
      if (!player || (travel.ghostX === player.x && travel.ghostY === player.y)) continue
      ghosts.push({ player, x: travel.ghostX, y: travel.ghostY })
    }
    return ghosts
  }

  private liveTokenPoses(travel: TokenTravel | null, players: readonly Player[]): Pose[] {
    const poses: Pose[] = []
    const own = this.liveTokenPose(travel)
    if (own && players.some((item) => item.id === own.playerId)) poses.push(own)
    const now = Date.now()
    for (const item of this.remoteTravels(players)) {
      if (item.phase !== 'playing') continue
      // Finished walks hold their destination until the DM's snapshot moves the token there.
      const pose = travelPose(item, now)
      poses.push({ playerId: item.playerId, x: pose.x, y: pose.y, tilt: pose.tilt })
    }
    return poses
  }

  private liveTokenPose(
    travel: TokenTravel | null,
  ): { playerId: string; x: number; y: number; tilt: number } | null {
    if (!travel || travel.phase !== 'playing') return null
    if (travel.floorId !== getActiveFloor().id) return null
    const pose = travelPose(travel, Date.now())
    return { playerId: travel.playerId, x: pose.x, y: pose.y, tilt: pose.tilt }
  }

  private visiblePlayers(players: readonly Player[], floorId: string): Player[] {
    const mode = useEditorStore.getState().viewMode
    const rooms = getActiveFloor().rooms
    return players.filter((player) => {
      if (player.floorId !== floorId) return false
      if (mode !== 'player') return true
      if (!player.visible) return false
      const room = occupantRoom(rooms, player.x, player.y)
      return !room || room.visible
    })
  }

  private syncPortraits(players: readonly Player[]): void {
    for (const player of players) {
      if (!player.portrait || this.portraits.has(player.portrait)) continue
      const img = new Image()
      if (/^https?:/i.test(player.portrait)) img.crossOrigin = 'anonymous'
      img.onload = () => this.markDirty()
      img.src = player.portrait
      this.portraits.set(player.portrait, img)
    }
  }

  private finishLinkPick(session: PointerSession): void {
    const editor = useEditorStore.getState()
    const picked = session.roomId
    if (!picked) {
      editor.setLinkRoom(null)
      return
    }
    if (!editor.linkRoomId || editor.linkRoomId === picked) {
      editor.setLinkRoom(editor.linkRoomId === picked ? null : picked)
      editor.selectRoom(picked)
      return
    }
    useDungeonStore.getState().toggleLink(getActiveFloor().id, editor.linkRoomId, picked)
    editor.setLinkRoom(null)
    editor.selectRoom(picked)
  }

  private lookupRoom(roomId: string | null): Room | null {
    if (!roomId) return null
    return getActiveFloor().rooms.find((item) => item.id === roomId) ?? null
  }

  private finishPaint(session: PointerSession): void {
    const cell = this.cellAt(session.lastX, session.lastY)
    const rect = normalizeRect(session.startCellX, session.startCellY, cell.x, cell.y)
    const id = useDungeonStore.getState().addRoom(getActiveFloor().id, rect)
    useEditorStore.getState().selectRoom(id)
  }

  private openContextMenu(session: PointerSession, event: PointerEvent): void {
    const editor = useEditorStore.getState()
    const floor = getActiveFloor()
    const token = hitToken(
      this.visiblePlayers(useDungeonStore.getState().dungeon.players ?? [], floor.id),
      floor.id,
      this.viewRooms(),
      floor.ramps ?? [],
      session.startX,
      session.startY,
      editor.camera,
    )
    if (token && canControlPlayer(token.id)) {
      editor.openMenu({ kind: 'player', playerId: token.id, x: event.clientX, y: event.clientY })
      return
    }
    if (editor.viewMode === 'player') return
    const opening = hitOpening(
      this.viewRooms(),
      session.startX,
      session.startY,
      useEditorStore.getState().camera,
    )
    if (opening) {
      useEditorStore.getState().openMenu({
        kind: 'opening',
        roomId: opening.roomId,
        cellX: opening.x,
        cellY: opening.y,
        x: event.clientX,
        y: event.clientY,
      })
      return
    }
    const room = this.roomAt(session.startX, session.startY)
    if (!room) return
    useEditorStore
      .getState()
      .openMenu({ kind: 'room', roomId: room.id, x: event.clientX, y: event.clientY })
  }

  private toggleOpeningAt(sx: number, sy: number): void {
    if (useEditorStore.getState().viewMode !== 'player') return
    const opening = hitOpening(this.viewRooms(), sx, sy, useEditorStore.getState().camera)
    if (!opening) return
    useSessionStore
      .getState()
      .reportOpening(getActiveFloor().id, opening.roomId, opening.x, opening.y)
  }

  private updateHover(sx: number, sy: number): void {
    // A drag owns its preview; a stray pointer must not rewrite what it commits.
    if (this.session?.mode === 'feature' || this.session?.mode === 'ramp' || this.session?.mode === 'token') return
    const editor = useEditorStore.getState()
    const rooms = getActiveFloor().rooms
    const room = this.roomAt(sx, sy)
    const cell = this.cellAt(sx, sy, room ?? null)
    if (cell.x !== this.hoverCell?.x || cell.y !== this.hoverCell?.y) {
      this.hoverCell = cell
      this.markDirty()
    }

    const badge = hitLinkBadge(this.badges(), sx, sy)
    this.setHoverLink(badge?.link ?? null)
    if (badge) {
      this.hoverFeature = null
      this.hoverRamp = null
      if (editor.hoverPlayerId) editor.setHoverPlayer(null)
      if (editor.hoverRoomId) editor.setHoverRoom(null)
      this.applyCursor('pointer')
      this.markDirty()
      return
    }

    const floor = getActiveFloor()
    const token = hitToken(
      this.visiblePlayers(useDungeonStore.getState().dungeon.players ?? [], floor.id),
      floor.id,
      rooms,
      floor.ramps ?? [],
      sx,
      sy,
      editor.camera,
    )
    if (token) {
      this.hoverFeature = null
      this.hoverRamp = null
      if (editor.hoverPlayerId !== token.id) editor.setHoverPlayer(token.id)
      if (editor.hoverRoomId) editor.setHoverRoom(null)
      this.applyCursor('grab')
      this.markDirty()
      return
    }
    if (editor.hoverPlayerId) editor.setHoverPlayer(null)

    const opening = hitOpening(this.viewRooms(), sx, sy, editor.camera)
    if (opening && editor.viewMode === 'player') {
      this.hoverFeature = null
      this.hoverRamp = null
      if (editor.hoverRoomId) editor.setHoverRoom(null)
      this.applyCursor('pointer')
      this.markDirty()
      return
    }

    if (editor.viewMode === 'player') {
      this.hoverFeature = null
      this.hoverRamp = null
      if (editor.hoverRoomId) editor.setHoverRoom(null)
      this.applyCursor(null)
      this.markDirty()
      return
    }

    const nextId = room?.id ?? null
    if (nextId !== editor.hoverRoomId) editor.setHoverRoom(nextId)

    // With a feature tool the cursor cell previews the single-tile version of a run.
    if (isFeatureTool(editor.tool)) {
      this.hoverFeature = room ? this.draftFor(room.id, editor.tool, singleCell(cell.x, cell.y)) : null
      this.hoverRamp = null
      this.applyCursor(null)
      this.markDirty()
      return
    }

    if (editor.tool === 'ramp') {
      this.hoverFeature = null
      const existing = rampAt(getActiveFloor().ramps ?? [], cell.x, cell.y)
      this.hoverRamp = existing
        ? { erase: true, rect: existing.rect, ramp: existing }
        : room
          ? this.rampDraftFor(cell, cell, room, room)
          : null
      this.applyCursor(null)
      this.markDirty()
      return
    }

    this.hoverFeature = null
    this.hoverRamp = null
    if (editor.tool === 'link') {
      this.applyCursor(room ? 'pointer' : null)
      return
    }

    const resizing = rooms.find((item) => item.id === editor.resizeRoomId)
    const grabbed = resizing
      ? hitHandle(resizing.rect, editor.camera, sx, sy, resizing.elevation)
      : null
    this.applyCursor(
      resizing && grabbed
        ? edgeCursor(resizing.rect, editor.camera, grabbed, resizing.elevation)
        : room || editor.tool === 'select'
          ? 'grab'
          : null,
    )
  }

  private setHoverLink(link: Link | null): void {
    const same = link && this.hoverLink ? sameLink(link, this.hoverLink) : link === this.hoverLink
    if (same) return
    this.hoverLink = link
    this.markDirty()
  }

  private applyCursor(cursor: string | null): void {
    if (cursor) {
      this.canvas.style.cursor = cursor
      return
    }
    if (this.spaceDown) {
      this.canvas.style.cursor = 'grab'
      return
    }
    const editor = useEditorStore.getState()
    this.canvas.style.cursor =
      editor.viewMode === 'player' || editor.tool === 'select' ? 'grab' : 'crosshair'
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    if (this.session?.mode === 'token') this.pinTokenWaypoint()
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.tween = null
    const rect = this.canvas.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    const store = useEditorStore.getState()
    store.setCamera(zoomAt(store.camera, sx, sy, factor))
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const blocked = useEditorStore.getState()
    if ((blocked.stairsPrompt || blocked.stairUse) && event.code !== 'Escape') return
    if (event.code === 'Space') {
      if (isTyping(event.target)) return
      this.spaceDown = true
      if (!this.session) this.applyCursor(null)
      event.preventDefault()
    }
    if (event.code === 'Escape') {
      this.draft = null
      this.dragFeature = null
      this.hoverFeature = null
      this.dragRamp = null
      this.hoverRamp = null
      this.tokenDrag = null
      this.session = null
      const travel = useDungeonStore.getState().dungeon.travel
      if (travel) {
        useDungeonStore.getState().setTravel(null)
        useSessionStore.getState().reportTravel(null)
      }
      const editor = useEditorStore.getState()
      editor.closeMenu()
      editor.endResize()
      editor.setLinkRoom(null)
      editor.closeStairsPrompt()
      editor.closeStairUse()
      if (editor.viewMode !== 'player') editor.setTool('select')
      this.markDirty()
    }
    const tool = TOOL_KEYS[event.code]
    if (
      tool &&
      useEditorStore.getState().viewMode !== 'player' &&
      !isTyping(event.target) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      useEditorStore.getState().setTool(tool)
      event.preventDefault()
    }
    if (
      event.code === 'KeyV' &&
      useSessionStore.getState().role !== 'guest' &&
      !isTyping(event.target) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const editor = useEditorStore.getState()
      editor.setViewMode(editor.viewMode === 'dm' ? 'player' : 'dm')
      event.preventDefault()
    }
    if (
      (event.code === 'KeyQ' || event.code === 'KeyE') &&
      !isTyping(event.target) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      this.tween = null
      useEditorStore.getState().rotateView(event.code === 'KeyE' ? 1 : -1)
      event.preventDefault()
    }
    if (
      (event.code === 'Equal' || event.code === 'Minus' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') &&
      !isTyping(event.target) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const editor = useEditorStore.getState()
      if (editor.viewMode !== 'player' && editor.selectedRoomId) {
        const delta = event.code === 'Minus' || event.code === 'NumpadSubtract' ? -1 : 1
        useDungeonStore.getState().nudgeRoomElevation(getActiveFloor().id, editor.selectedRoomId, delta)
        event.preventDefault()
      }
    }
    if (event.code === 'PageUp' || event.code === 'PageDown') {
      const floors = useDungeonStore.getState().dungeon.floors
      const step = event.code === 'PageUp' ? 1 : -1
      const next = nextShownFloor(
        floors,
        getActiveFloor().order,
        step,
        useEditorStore.getState().viewMode,
      )
      if (!next) return
      useEditorStore.getState().setActiveFloor(next.id)
      event.preventDefault()
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      if (isTyping(event.target)) return
      const editor = useEditorStore.getState()
      if (editor.viewMode === 'player') return
      if (editor.stairsPrompt || editor.stairUse) return
      if (editor.selectedPlayerId) {
        useDungeonStore.getState().deletePlayer(editor.selectedPlayerId)
        editor.selectPlayer(null)
        editor.setHoverPlayer(null)
        event.preventDefault()
        return
      }
      if (!editor.selectedRoomId) return
      const orphans = useDungeonStore.getState().deleteRoom(getActiveFloor().id, editor.selectedRoomId)
      editor.selectRoom(null)
      editor.setHoverRoom(null)
      if (orphans.length > 0) editor.promptStairLandings(orphans)
      event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return
    this.spaceDown = false
    if (!this.session) this.applyCursor(null)
  }
}
