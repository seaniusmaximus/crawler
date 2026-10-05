import type { TileSprite } from '../model/types.ts'
import { variantAt, type FaceKind, type SheetRect, type Tileset, type Variant } from './tileset.ts'

/** Flat colours to fall back on if a sheet cannot be loaded, so the map still reads. */
const FALLBACK_TOP: Record<TileSprite, string> = {
  floor: '#8b7a64',
  wall: '#4a4d56',
  'door-h': '#8a5a2b',
  'door-v': '#8a5a2b',
  'window-h': '#5f8fb0',
  'window-v': '#5f8fb0',
  stairs: '#9a8e79',
}

const FALLBACK_FACE: Record<FaceKind, string> = {
  wall: '#4e525c',
  door: '#7a4e24',
  window: '#547a96',
  'window-open': '#2e3036',
  foundation: '#2f3138',
  tread: '#a39782',
  riser: '#6e6658',
  shaft: '#24252b',
}

type Slot = `top:${TileSprite}` | `face:${FaceKind}`

/**
 * Cuts a tileset's spritesheet into one ImageBitmap per variant, so the
 * renderer only ever `drawImage`s. Switching tilesets means a new cache.
 */
export class TileCache {
  private readonly images = new Map<Slot, ImageBitmap[]>()
  private ready = false
  private closed = false

  readonly tileset: Tileset

  constructor(tileset: Tileset) {
    this.tileset = tileset
  }

  isReady(): boolean {
    return this.ready
  }

  /** The top of a tile; which variant depends on its cell and its room's seed. */
  top(sprite: TileSprite, variant: Variant): ImageBitmap | undefined {
    const list = this.images.get(`top:${sprite}`)
    return list?.[variantAt(variant, list.length)]
  }

  /** One upright face of a cube; `side` keeps a cube's two faces from matching. */
  face(kind: FaceKind, variant: Variant, side = 0): ImageBitmap | undefined {
    const list = this.images.get(`face:${kind}`)
    return list?.[variantAt(variant, list.length, side + 1)]
  }

  async init(): Promise<void> {
    if (this.ready || this.closed) return
    try {
      await this.slice()
    } catch (error) {
      console.warn(`Tileset "${this.tileset.id}" failed to load; using flat colours.`, error)
      this.clear()
      await this.flat()
    }
    if (this.closed) {
      this.destroy()
      return
    }
    this.ready = true
  }

  destroy(): void {
    this.closed = true
    this.ready = false
    this.clear()
  }

  private clear(): void {
    for (const list of this.images.values()) for (const bitmap of list) bitmap.close()
    this.images.clear()
  }

  private async slice(): Promise<void> {
    const response = await fetch(this.tileset.sheet)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const sheet = await createImageBitmap(await response.blob())
    const cut = (rects: readonly SheetRect[]) =>
      Promise.all(rects.map((r) => createImageBitmap(sheet, r.x, r.y, r.w, r.h)))
    try {
      const jobs: Promise<void>[] = []
      for (const [sprite, rects] of Object.entries(this.tileset.tops) as [TileSprite, SheetRect[]][]) {
        jobs.push(cut(rects).then((list) => void this.images.set(`top:${sprite}`, list)))
      }
      for (const [kind, rects] of Object.entries(this.tileset.faces) as [FaceKind, SheetRect[]][]) {
        jobs.push(cut(rects).then((list) => void this.images.set(`face:${kind}`, list)))
      }
      await Promise.all(jobs)
    } finally {
      sheet.close()
    }
  }

  private async flat(): Promise<void> {
    const swatch = async (color: string) => {
      const canvas = new OffscreenCanvas(8, 8)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not create tile cache')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 8, 8)
      return createImageBitmap(canvas)
    }
    for (const [sprite, color] of Object.entries(FALLBACK_TOP) as [TileSprite, string][]) {
      this.images.set(`top:${sprite}`, [await swatch(color)])
    }
    for (const [kind, color] of Object.entries(FALLBACK_FACE) as [FaceKind, string][]) {
      this.images.set(`face:${kind}`, [await swatch(color)])
    }
  }
}
