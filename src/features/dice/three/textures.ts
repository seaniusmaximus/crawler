import { CanvasTexture, SRGBColorSpace } from 'three'
import { faceLayout, shapeOf } from './shapes.ts'

/** Face textures: the die's colour with its number (a d4's face has three, one by each corner). */

const SIZE = 128
const cache = new Map<string, CanvasTexture>()

/** Dark ink on light dice, light ink on dark ones. */
export function inkFor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return '#fffaf0'
  const n = parseInt(match[1], 16)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  return luminance > 0.36 ? '#1a1609' : '#fffaf0'
}

function canvas(color: string): { element: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement('canvas')
  element.width = element.height = SIZE
  const ctx = element.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, SIZE, SIZE)
  return { element, ctx }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, angle: number, ink: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = ink
  ctx.font = `700 ${size}px "Geist Mono", ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 0, 0)
  // 6 and 9 look alike upside down: underline them, as real dice do.
  if (text === '6' || text === '9') ctx.fillRect(-size * 0.28, size * 0.42, size * 0.56, Math.max(2, size * 0.07))
  ctx.restore()
}

function finish(element: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(element)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** A face showing one number in its middle. */
export function faceTexture(color: string, text: string, sides: number): CanvasTexture {
  const key = `${color}|${text}|${sides}`
  let texture = cache.get(key)
  if (!texture) {
    const { element, ctx } = canvas(color)
    // Smaller on triangles (less room) and for two-digit labels.
    const base = sides === 3 ? 50 : sides === 4 ? 56 : 52
    label(ctx, text, SIZE / 2, SIZE / 2 + (sides === 3 ? 8 : 0), text.length > 1 ? base * 0.78 : base, 0, inkFor(color))
    texture = finish(element)
    cache.set(key, texture)
  }
  return texture
}

/** A d4 face: the number of each corner written near it, reading outward, so the top corner reads the same on every side. */
export function d4FaceTexture(color: string, face: number, cornerLabels: string[]): CanvasTexture {
  const key = `${color}|d4|${face}|${cornerLabels.join(',')}`
  let texture = cache.get(key)
  if (!texture) {
    const { element, ctx } = canvas(color)
    const layout = faceLayout(shapeOf('d4'), face)
    const center = layout.reduce((sum, p) => ({ u: sum.u + p.u / 3, v: sum.v + p.v / 3 }), { u: 0, v: 0 })
    const ink = inkFor(color)
    layout.forEach((corner, i) => {
      const x = (center.u + (corner.u - center.u) * 0.55) * SIZE
      const y = (1 - (center.v + (corner.v - center.v) * 0.55)) * SIZE
      const dx = (corner.u - center.u) * SIZE
      const dy = -(corner.v - center.v) * SIZE
      label(ctx, cornerLabels[i], x, y, 30, Math.atan2(dx, -dy), ink)
    })
    texture = finish(element)
    cache.set(key, texture)
  }
  return texture
}
