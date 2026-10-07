import type { Camera, Room } from '../model/types.ts'
import { GROUND, drawScene, prepareScene, type DrawView, type ScenePrep } from './draw.ts'
import { changedRegions, sameRampPreview, type RampPreview, type WorldRect } from './sceneDiff.ts'

/** A tile's side in device pixels. Tiles start on whole device pixels, so ones painted apart meet without a seam. */
const TILE = 512
/** Rings of tiles kept painted around the screen, so a pan finds them ready. */
const RING = 1
/** How long each frame may spend painting tiles that can wait, in milliseconds. */
const BUDGET_MS = 6
/** How long the zoom must rest before the map is painted again sharp at it. */
const SETTLE_MS = 160
/** Spare tile canvases kept for reuse rather than made anew. */
const POOL = 24

/** What the scene shows besides the camera (see `drawScene`). */
export interface SceneKey {
  /** The floor's rooms: a change to some of them repaints just where they paint. */
  rooms: readonly Room[]
  /** The ramp being drawn, previewed in the scene; a change repaints just where it stands. */
  ramp: RampPreview | null
  /** Everything else, compared item by item by identity: any change repaints it all. */
  rest: readonly unknown[]
}

/** What the last frame spent on the scene, for the development readout. */
export interface SceneStats {
  tiles: number
  ms: number
}

interface Tile {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** The scene generation it was painted for; anything else means it's out of date but still shown. */
  gen: number
  /** Out of date where something was just edited: painted again straight away, whatever the budget. */
  urgent: boolean
}

interface Range {
  i0: number
  i1: number
  j0: number
  j1: number
}

/**
 * The map painted at one zoom and turn, as tiles of TILE device pixels. Tile
 * (i, j) covers the map laid out at that zoom (world times zoom, in CSS pixels)
 * from i·side across and j·side down.
 */
class Level {
  readonly tiles = new Map<number, Tile>()
  readonly zoom: number
  readonly yaw: Camera['yaw']
  readonly dpr: number

  constructor(zoom: number, yaw: Camera['yaw'], dpr: number) {
    this.zoom = zoom
    this.yaw = yaw
    this.dpr = dpr
  }

  /** A tile's side in CSS pixels at this level's zoom. */
  get side(): number {
    return TILE / this.dpr
  }

  /** The tiles covering a `width` by `height` screen under `camera`, and `pad` rings more. */
  range(camera: Camera, width: number, height: number, pad = 0): Range {
    const scale = this.zoom / this.side
    return {
      i0: Math.floor(camera.x * scale) - pad,
      i1: Math.floor((camera.x + width / camera.zoom) * scale) + pad,
      j0: Math.floor(camera.y * scale) - pad,
      j1: Math.floor((camera.y + height / camera.zoom) * scale) + pad,
    }
  }

  /** The tiles a world box falls on. */
  rangeOf(rect: WorldRect): Range {
    const scale = this.zoom / this.side
    return {
      i0: Math.floor(rect.x0 * scale),
      i1: Math.floor(rect.x1 * scale),
      j0: Math.floor(rect.y0 * scale),
      j1: Math.floor(rect.y1 * scale),
    }
  }

  /** The camera that paints tile (i, j) onto its own canvas. */
  tileCamera(i: number, j: number): Camera {
    return { x: (i * this.side) / this.zoom, y: (j * this.side) / this.zoom, zoom: this.zoom, yaw: this.yaw }
  }

  covers(range: Range): boolean {
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) if (!this.tiles.has(tileKey(i, j))) return false
    }
    return true
  }
}

/**
 * The map under its overlays (see `drawScene`), painted in tiles and kept.
 * Hovering, selecting, tokens walking and paths being drawn only paint over
 * it. A pan shows tiles already painted around the screen and paints the next
 * ring a few at a time. A zoom stretches the tiles it has until the zoom
 * rests, then paints sharp ones over them, nearest the middle first, a few
 * each frame. An edit repaints only the tiles where it shows.
 */
export class SceneCache {
  private current: Level | null = null
  /** The level shown under the current one while that one is still being painted. */
  private previous: Level | null = null
  private generation = 0
  private key: SceneKey | null = null
  private prep: ScenePrep | null = null
  private prepYaw: Camera['yaw'] = 0
  /** The zoom last asked for, and when it last changed. */
  private zoom = 0
  private zoomedAt = 0
  private readonly pool: HTMLCanvasElement[] = []
  stats: SceneStats = { tiles: 0, ms: 0 }

  /** Lets go of every tile. */
  release(): void {
    this.drop(this.current)
    this.drop(this.previous)
    this.current = null
    this.previous = null
    this.pool.length = 0
    this.key = null
    this.prep = null
  }

  /**
   * Paints the scene onto `ctx`, a screen `view.width` by `view.height` CSS
   * pixels at `dpr`. True while there's more to do (tiles left to paint, or a
   * zoom still to settle): the caller should draw again next frame.
   */
  draw(ctx: CanvasRenderingContext2D, view: DrawView, dpr: number, key: SceneKey): boolean {
    const now = performance.now()
    const { camera } = view
    if (camera.zoom !== this.zoom) {
      this.zoom = camera.zoom
      this.zoomedAt = now
    }
    this.update(key, camera.yaw)
    if (!this.current || this.current.yaw !== camera.yaw || this.current.dpr !== dpr) {
      // A turn or a new screen: nothing kept lines up any more.
      this.drop(this.current)
      this.drop(this.previous)
      this.previous = null
      this.current = new Level(camera.zoom, camera.yaw, dpr)
    } else if (this.current.zoom !== camera.zoom && now - this.zoomedAt >= SETTLE_MS) {
      this.drop(this.previous)
      this.previous = this.current
      this.current = new Level(camera.zoom, camera.yaw, dpr)
    }
    const level = this.current
    const zooming = level.zoom !== camera.zoom
    const pending = this.paint(level, view, zooming, now)

    const visible = level.range(camera, view.width, view.height)
    const covered = level.covers(visible)
    if (covered && this.previous) {
      this.drop(this.previous)
      this.previous = null
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = GROUND
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    if (!covered && this.previous) this.blit(ctx, this.previous, view, dpr)
    this.blit(ctx, level, view, dpr)
    ctx.restore()
    return pending || zooming || !covered
  }

  /** Takes in a new key: repaints where the map changed, or all of it. */
  private update(key: SceneKey, yaw: Camera['yaw']): void {
    const old = this.key
    this.key = key
    if (this.prep && this.prepYaw !== yaw) this.prep = null
    if (!old) return
    const restSame = old.rest.length === key.rest.length && old.rest.every((item, i) => Object.is(item, key.rest[i]))
    if (restSame && old.rooms === key.rooms && sameRampPreview(old.ramp, key.ramp)) return
    this.prep = null
    const regions = restSame ? changedRegions(old, key, yaw) : null
    if (!regions) {
      this.generation++
      return
    }
    for (const level of [this.current, this.previous]) {
      if (!level || level.yaw !== yaw) continue
      for (const region of regions) {
        const range = level.rangeOf(region)
        for (let j = range.j0; j <= range.j1; j++) {
          for (let i = range.i0; i <= range.i1; i++) {
            const tile = level.tiles.get(tileKey(i, j))
            if (!tile) continue
            tile.gen = -1
            tile.urgent = true
          }
        }
      }
    }
  }

  /**
   * Paints the level's tiles that need it: on screen first, nearest the middle
   * first, then the ring around. Tiles just edited are painted at once, and so
   * are missing ones when nothing else could show there; the rest wait for the
   * frame's budget. True when some had to wait.
   */
  private paint(level: Level, view: DrawView, zooming: boolean, now: number): boolean {
    const deadline = now + BUDGET_MS
    const { camera } = view
    const visible = level.range(camera, view.width, view.height)
    // Without an older level to show under them, missing tiles on screen can't wait.
    const force = !this.previous && !zooming
    let pending = false
    let painted = 0
    const midI = (visible.i0 + visible.i1) / 2
    const midJ = (visible.j0 + visible.j1) / 2
    const due = (range: Range, skip?: Range) => {
      const list: { i: number; j: number; tile: Tile | undefined; far: number }[] = []
      for (let j = range.j0; j <= range.j1; j++) {
        for (let i = range.i0; i <= range.i1; i++) {
          if (skip && i >= skip.i0 && i <= skip.i1 && j >= skip.j0 && j <= skip.j1) continue
          const tile = level.tiles.get(tileKey(i, j))
          if (tile && tile.gen === this.generation) continue
          list.push({ i, j, tile, far: (i - midI) ** 2 + (j - midJ) ** 2 })
        }
      }
      return list.sort((a, b) => a.far - b.far)
    }
    for (const { i, j, tile } of due(visible)) {
      const urgent = tile ? tile.urgent : force
      if (!urgent && performance.now() > deadline) {
        pending = true
        continue
      }
      this.paintTile(level, i, j, view)
      painted++
    }
    // The ring is painted ahead of a pan; mid-zoom it would be at the wrong zoom by the time it's needed.
    const ring = level.range(camera, view.width, view.height, RING)
    if (!zooming) {
      for (const { i, j } of due(ring, visible)) {
        if (performance.now() > deadline) {
          pending = true
          break
        }
        this.paintTile(level, i, j, view)
        painted++
      }
    }
    this.evict(level, level.range(camera, view.width, view.height, RING + 1))
    this.stats = { tiles: painted, ms: performance.now() - now }
    return pending
  }

  private paintTile(level: Level, i: number, j: number, view: DrawView): void {
    if (!this.prep) {
      this.prep = prepareScene(view)
      this.prepYaw = view.camera.yaw
    }
    const key = tileKey(i, j)
    let tile = level.tiles.get(key)
    if (!tile) {
      const canvas = this.pool.pop() ?? newTileCanvas()
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return
      tile = { canvas, ctx, gen: -1, urgent: false }
      level.tiles.set(key, tile)
    }
    tile.ctx.setTransform(level.dpr, 0, 0, level.dpr, 0, 0)
    const side = level.side
    drawScene(tile.ctx, { ...view, camera: level.tileCamera(i, j), width: side, height: side }, this.prep)
    tile.gen = this.generation
    tile.urgent = false
  }

  /** Draws a level's painted tiles onto the screen: crisp at its own zoom, stretched at any other. */
  private blit(ctx: CanvasRenderingContext2D, level: Level, view: DrawView, dpr: number): void {
    const { camera } = view
    const range = level.range(camera, view.width, view.height)
    const exact = level.zoom === camera.zoom
    // Every tile shifted by the same whole device pixels, so they meet exactly; overlays may sit up to half a pixel off.
    const ox = Math.round(camera.x * camera.zoom * dpr)
    const oy = Math.round(camera.y * camera.zoom * dpr)
    const across = (i: number) => ((i * level.side) / level.zoom - camera.x) * camera.zoom * dpr
    const down = (j: number) => ((j * level.side) / level.zoom - camera.y) * camera.zoom * dpr
    ctx.imageSmoothingEnabled = !exact
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) {
        const tile = level.tiles.get(tileKey(i, j))
        if (!tile) continue
        if (exact) {
          ctx.drawImage(tile.canvas, i * TILE - ox, j * TILE - oy)
          continue
        }
        // Stretched tiles are widened to whole pixels so no hairline shows between them.
        const x = Math.floor(across(i))
        const y = Math.floor(down(j))
        ctx.drawImage(tile.canvas, x, y, Math.ceil(across(i + 1)) - x, Math.ceil(down(j + 1)) - y)
      }
    }
  }

  /** Lets go of tiles well off screen, keeping their canvases for reuse. */
  private evict(level: Level, keep: Range): void {
    for (const [key, tile] of level.tiles) {
      const { i, j } = tileAt(key)
      if (i >= keep.i0 && i <= keep.i1 && j >= keep.j0 && j <= keep.j1) continue
      level.tiles.delete(key)
      this.recycle(tile)
    }
  }

  private drop(level: Level | null): void {
    if (!level) return
    for (const tile of level.tiles.values()) this.recycle(tile)
    level.tiles.clear()
  }

  private recycle(tile: Tile): void {
    if (this.pool.length < POOL) this.pool.push(tile.canvas)
    else {
      tile.canvas.width = 0
      tile.canvas.height = 0
    }
  }
}

const TILE_OFFSET = 2 ** 20
const TILE_SPAN = 2 ** 21

function tileKey(i: number, j: number): number {
  return (j + TILE_OFFSET) * TILE_SPAN + (i + TILE_OFFSET)
}

function tileAt(key: number): { i: number; j: number } {
  return { i: (key % TILE_SPAN) - TILE_OFFSET, j: Math.floor(key / TILE_SPAN) - TILE_OFFSET }
}

function newTileCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  return canvas
}
