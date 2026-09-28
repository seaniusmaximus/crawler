import type { TileSprite } from '../model/types.ts'

export const TILE_SRC_SIZE = 64

const WALL_BASE = '#42454e'

/** Placeholder colors until real spritesheet slices land; variant count is per sprite. */
const PALETTE: Record<TileSprite, readonly string[]> = {
  floor: ['#8b7a64', '#82735e', '#94856d', '#7a6d59'],
  wall: ['#4a4d56', '#42454e', '#545762', '#3b3e46'],
  'door-h': ['#8a5a2b'],
  'door-v': ['#8a5a2b'],
  'window-h': ['#5f8fb0'],
  'window-v': ['#5f8fb0'],
  stairs: ['#9a8e79'],
}

export function tileVariant(x: number, y: number, sprite: TileSprite): number {
  let n = (x * 374761393 + y * 668265263) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n >>> 0) % PALETTE[sprite].length
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

function paintFloor(ctx: Ctx, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, TILE_SRC_SIZE, TILE_SRC_SIZE)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.fillRect(0, 0, TILE_SRC_SIZE, 3)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
  ctx.fillRect(0, TILE_SRC_SIZE - 4, TILE_SRC_SIZE, 4)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
  ctx.fillRect(18, 22, 8, 8)
  ctx.fillRect(40, 36, 10, 6)
}

function paintWall(ctx: Ctx, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, TILE_SRC_SIZE, TILE_SRC_SIZE)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.38)'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, TILE_SRC_SIZE - 6, TILE_SRC_SIZE - 6)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.fillRect(10, 10, TILE_SRC_SIZE - 20, 8)
}

/** Bands run along the wall, so `h` fills the tile width and `v` fills its height. */
function bandRect(axis: 'h' | 'v', thickness: number): [number, number, number, number] {
  const offset = (TILE_SRC_SIZE - thickness) / 2
  return axis === 'h'
    ? [0, offset, TILE_SRC_SIZE, thickness]
    : [offset, 0, thickness, TILE_SRC_SIZE]
}

function paintDoor(ctx: Ctx, color: string, axis: 'h' | 'v'): void {
  paintWall(ctx, WALL_BASE)
  const [x, y, w, h] = bandRect(axis, 40)
  ctx.fillStyle = 'rgba(12, 12, 16, 0.55)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x + (axis === 'v' ? 4 : 0), y + (axis === 'h' ? 4 : 0), axis === 'v' ? w - 8 : w, axis === 'h' ? h - 8 : h)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(
    axis === 'h' ? TILE_SRC_SIZE / 2 - 1 : x + 6,
    axis === 'h' ? y + 6 : TILE_SRC_SIZE / 2 - 1,
    axis === 'h' ? 2 : w - 12,
    axis === 'h' ? h - 12 : 2,
  )
  ctx.fillStyle = '#f0d9a8'
  const knob = 5
  ctx.fillRect(
    axis === 'h' ? TILE_SRC_SIZE / 2 + 8 : x + w / 2 - knob / 2,
    axis === 'h' ? y + h / 2 - knob / 2 : TILE_SRC_SIZE / 2 + 8,
    knob,
    knob,
  )
}

function paintWindow(ctx: Ctx, color: string, axis: 'h' | 'v'): void {
  paintWall(ctx, WALL_BASE)
  const [x, y, w, h] = bandRect(axis, 26)
  ctx.fillStyle = 'rgba(12, 12, 16, 0.5)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x + (axis === 'v' ? 3 : 8), y + (axis === 'h' ? 3 : 8), axis === 'v' ? w - 6 : w - 16, axis === 'h' ? h - 6 : h - 16)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.fillRect(
    axis === 'h' ? TILE_SRC_SIZE / 2 - 1 : x + 3,
    axis === 'h' ? y + 3 : TILE_SRC_SIZE / 2 - 1,
    axis === 'h' ? 2 : w - 6,
    axis === 'h' ? h - 6 : 2,
  )
}

/**
 * Treads only. A staircase spans a whole block, so this art gets stretched to
 * fit and the direction arrow is drawn separately at a fixed proportion.
 */
function paintStairs(ctx: Ctx, color: string): void {
  ctx.fillStyle = '#6f6455'
  ctx.fillRect(0, 0, TILE_SRC_SIZE, TILE_SRC_SIZE)

  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? color : 'rgba(0, 0, 0, 0.18)'
    ctx.fillRect(5, 8 + i * 13, TILE_SRC_SIZE - 10, 10)
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.lineWidth = 3
  ctx.strokeRect(4, 4, TILE_SRC_SIZE - 8, TILE_SRC_SIZE - 8)
}

function paintSprite(ctx: Ctx, sprite: TileSprite, color: string): void {
  switch (sprite) {
    case 'floor':
      paintFloor(ctx, color)
      return
    case 'wall':
      paintWall(ctx, color)
      return
    case 'door-h':
      paintDoor(ctx, color, 'h')
      return
    case 'door-v':
      paintDoor(ctx, color, 'v')
      return
    case 'window-h':
      paintWindow(ctx, color, 'h')
      return
    case 'window-v':
      paintWindow(ctx, color, 'v')
      return
    case 'stairs':
      paintStairs(ctx, color)
      return
  }
}

/**
 * Bakes every sprite variant into an ImageBitmap so the renderer only ever
 * `drawImage`s. Swap `PALETTE` and `paintSprite` for spritesheet slices later
 * without touching callers.
 */
export class TileCache {
  private readonly images = new Map<string, ImageBitmap>()
  private ready = false
  private closed = false

  isReady(): boolean {
    return this.ready
  }

  get(sprite: TileSprite, variant: number): ImageBitmap | undefined {
    return this.images.get(`${sprite}:${variant}`)
  }

  async init(): Promise<void> {
    if (this.ready || this.closed) return
    const jobs: Promise<void>[] = []
    for (const sprite of Object.keys(PALETTE) as TileSprite[]) {
      PALETTE[sprite].forEach((color, variant) => {
        jobs.push(this.bake(sprite, variant, color))
      })
    }
    await Promise.all(jobs)
    if (this.closed) {
      this.destroy()
      return
    }
    this.ready = true
  }

  destroy(): void {
    this.closed = true
    this.ready = false
    for (const bitmap of this.images.values()) bitmap.close()
    this.images.clear()
  }

  private async bake(sprite: TileSprite, variant: number, color: string): Promise<void> {
    const canvas = new OffscreenCanvas(TILE_SRC_SIZE, TILE_SRC_SIZE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create tile cache')
    ctx.imageSmoothingEnabled = false
    paintSprite(ctx, sprite, color)
    const bitmap = await createImageBitmap(canvas)
    if (this.closed) {
      bitmap.close()
      return
    }
    this.images.set(`${sprite}:${variant}`, bitmap)
  }
}
