import type { Camera } from '../model/types.ts'
import { drawScene, type DrawView } from './draw.ts'

/** How far past the screen the scene is painted, in CSS pixels, so a pan can slide it a while before painting it again. */
const MARGIN = 192

/** How long the zoom must rest before the stretched scene is painted again sharp. */
const SETTLE_MS = 160

/** Everything besides the camera's position and zoom that the scene depends on, compared item by item by identity. */
export type SceneKey = readonly unknown[]

/** Where the kept scene lands on screen, in CSS pixels, and how much it's stretched. */
interface Placement {
  x: number
  y: number
  scale: number
}

/**
 * The map under its overlays (see `drawScene`), painted to a canvas of its own
 * with a margin around the screen. Hovering, selecting, tokens walking and paths
 * being drawn only paint over it. A pan slides it until the screen passes its
 * margin; a zoom stretches it until the zoom rests, then it's painted sharp.
 */
export class SceneCache {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private key: SceneKey | null = null
  /** The camera the screen had when the scene was painted. */
  private camera: Camera | null = null
  /** The zoom last asked for, and when it last changed. */
  private zoom = 0
  private zoomedAt = 0

  constructor() {
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Could not create 2D context')
    this.ctx = ctx
  }

  /** Lets go of the canvas's memory. */
  release(): void {
    this.canvas.width = 0
    this.canvas.height = 0
    this.key = null
  }

  /**
   * Paints the scene onto `ctx`, a screen `view.width` by `view.height` CSS
   * pixels at `dpr`, from the kept one when it still holds. True while it shows
   * a stretched scene: the caller should draw again so it's painted sharp once
   * the zoom rests.
   */
  draw(ctx: CanvasRenderingContext2D, view: DrawView, dpr: number, key: SceneKey): boolean {
    const now = performance.now()
    if (view.camera.zoom !== this.zoom) {
      this.zoom = view.camera.zoom
      this.zoomedAt = now
    }
    let placed = this.placement(view, dpr, key)
    if (placed && placed.scale !== 1 && now - this.zoomedAt >= SETTLE_MS) placed = null
    if (!placed) {
      this.paint(view, dpr)
      this.key = key
      this.camera = view.camera
      placed = { x: -MARGIN, y: -MARGIN, scale: 1 }
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (placed.scale === 1) {
      // Whole device pixels, so the kept tiles stay crisp; overlays may sit up to half a pixel off them.
      ctx.drawImage(this.canvas, Math.round(placed.x * dpr), Math.round(placed.y * dpr))
    } else {
      ctx.imageSmoothingEnabled = true
      const { width, height } = this.canvas
      ctx.drawImage(this.canvas, placed.x * dpr, placed.y * dpr, width * placed.scale, height * placed.scale)
    }
    ctx.restore()
    return placed.scale !== 1
  }

  /** Where the kept scene sits under the camera now, or null when it must be painted again. */
  private placement(view: DrawView, dpr: number, key: SceneKey): Placement | null {
    const kept = this.camera
    const { camera } = view
    if (!kept || !this.key || !sameKey(this.key, key) || kept.yaw !== camera.yaw) return null
    // The kept canvas starts a margin up and left of the screen it was painted for.
    const scale = camera.zoom / kept.zoom
    const x = (kept.x - MARGIN / kept.zoom - camera.x) * camera.zoom
    const y = (kept.y - MARGIN / kept.zoom - camera.y) * camera.zoom
    const width = (this.canvas.width / dpr) * scale
    const height = (this.canvas.height / dpr) * scale
    // A pixel to spare at each edge: sizes and offsets are rounded to whole device pixels.
    if (x > -1 || y > -1 || x + width < view.width + 1 || y + height < view.height + 1) return null
    return { x, y, scale }
  }

  private paint(view: DrawView, dpr: number): void {
    const width = view.width + MARGIN * 2
    const height = view.height + MARGIN * 2
    const pixelsWide = Math.floor(width * dpr)
    const pixelsHigh = Math.floor(height * dpr)
    // Resizing clears the canvas and its state, so only when the size changes.
    if (this.canvas.width !== pixelsWide || this.canvas.height !== pixelsHigh) {
      this.canvas.width = pixelsWide
      this.canvas.height = pixelsHigh
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const camera = { ...view.camera, x: view.camera.x - MARGIN / view.camera.zoom, y: view.camera.y - MARGIN / view.camera.zoom }
    drawScene(this.ctx, { ...view, width, height, camera })
  }
}

function sameKey(a: SceneKey, b: SceneKey): boolean {
  return a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
}
