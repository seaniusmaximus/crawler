import type { Camera } from '../model/types.ts'
import { cellToScreen, lift, orient, unorient, type Point } from './camera.ts'

/**
 * Rounds drawn as many-sided solids, so they can be cut at cell lines like
 * boxes are and painted cell by cell with the floors and walls around them.
 * Points are grid cells across (x, y) and world pixels up (z).
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Face {
  points: Vec3[]
  /** Faces up: painted in the part's top colour. */
  top: boolean
}

/** Sides a round is built with: enough to read as round at any zoom the map allows. */
const SIDES = 20
const SMALL_SIDES = 12
const EPSILON = 1e-7

/**
 * A round from (x, y) as faces wound outward: a cylinder, a cone (`r2` 0) or
 * one standing on its point (`r` 0). Its bottom is never seen and left out.
 */
export function frustum(x: number, y: number, r: number, r2: number, z: number, h: number): Face[] {
  const sides = Math.max(r, r2) < 0.06 ? SMALL_SIDES : SIDES
  const ring = (radius: number, height: number) =>
    Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2
      return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius, z: height }
    })
  const bottom = ring(r, z)
  const top = ring(r2, z + h)
  const faces: Face[] = []
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    const points = dedupe([bottom[i]!, bottom[j]!, top[j]!, top[i]!])
    if (points.length >= 3) faces.push({ points, top: false })
  }
  if (r2 > 0) faces.push({ points: top, top: true })
  return faces
}

/**
 * The solid cut down to one side of a vertical plane: `axis` = `value`,
 * keeping the `lo` (smaller) or `hi` side. The cut is closed with a new face.
 */
export function clipSolid(faces: readonly Face[], axis: 'x' | 'y', value: number, keep: 'lo' | 'hi'): Face[] {
  const side = (p: Vec3) => (keep === 'lo' ? p[axis] - value : value - p[axis])
  const out: Face[] = []
  const cut: Vec3[] = []
  for (const face of faces) {
    const points: Vec3[] = []
    const n = face.points.length
    for (let i = 0; i < n; i++) {
      const a = face.points[i]!
      const b = face.points[(i + 1) % n]!
      const da = side(a)
      const db = side(b)
      if (da <= EPSILON) points.push(a)
      if ((da < -EPSILON && db > EPSILON) || (da > EPSILON && db < -EPSILON)) {
        const t = da / (da - db)
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
        points.push(p)
        cut.push(p)
      } else if (Math.abs(da) <= EPSILON) {
        cut.push(a)
      }
    }
    const kept = dedupe(points)
    if (kept.length >= 3) out.push({ points: kept, top: face.top })
  }
  const cap = capFace(cut, axis, keep)
  if (cap) out.push({ points: cap, top: false })
  return out
}

/** The face closing a cut: the points on the plane, in order around their middle, wound outward. */
function capFace(points: Vec3[], axis: 'x' | 'y', keep: 'lo' | 'hi'): Vec3[] | null {
  const unique = dedupe(points)
  if (unique.length < 3) return null
  const across = axis === 'x' ? 'y' : 'x'
  const mid = unique.reduce((sum, p) => ({ u: sum.u + p[across], z: sum.z + p.z }), { u: 0, z: 0 })
  mid.u /= unique.length
  mid.z /= unique.length
  // Heights are pixels and widths cells; scale so angles around the middle sort sensibly.
  const sorted = [...unique].sort(
    (a, b) => Math.atan2((a.z - mid.z) / 45, a[across] - mid.u) - Math.atan2((b.z - mid.z) / 45, b[across] - mid.u),
  )
  const normal = newell(sorted)
  const outward = keep === 'lo' ? 1 : -1
  if (Math.sign(normal[axis]) !== outward) sorted.reverse()
  return sorted
}

function dedupe(points: Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (const p of points) {
    if (out.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6 && Math.abs(q.z - p.z) < 1e-4)) continue
    out.push(p)
  }
  return out
}

/** A polygon's normal by Newell's method; its direction follows the winding. */
export function newell(points: readonly Vec3[]): Vec3 {
  const n = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    n.x += (a.y - b.y) * (a.z + b.z)
    n.y += (a.z - b.z) * (a.x + b.x)
    n.z += (a.x - b.x) * (a.y + b.y)
  }
  return n
}

export interface SolidBounds {
  x0: number
  y0: number
  x1: number
  y1: number
  z0: number
  z1: number
}

export function solidBounds(faces: readonly Face[]): SolidBounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
  for (const face of faces) {
    for (const p of face.points) {
      b.x0 = Math.min(b.x0, p.x)
      b.y0 = Math.min(b.y0, p.y)
      b.x1 = Math.max(b.x1, p.x)
      b.y1 = Math.max(b.y1, p.y)
      b.z0 = Math.min(b.z0, p.z)
      b.z1 = Math.max(b.z1, p.z)
    }
  }
  return b
}

/**
 * Toward the camera, on the grid: moving a point this way leaves it where it
 * was on screen. One cell along the view's diagonal rises 32 pixels.
 */
function towardCamera(yaw: Camera['yaw']): Vec3 {
  const ground = unorient(1, 1, yaw)
  return { x: ground.x, y: ground.y, z: 32 }
}

/** How lit a face is: the box's left falloff through full light to its right falloff, as rounds always were. */
function faceLight(normal: Vec3, yaw: Camera['yaw'], left: number, right: number): number {
  const view = orient(normal.x, normal.y, yaw)
  const across = view.x - view.y
  const length = Math.hypot(view.x, view.y) * Math.SQRT2
  const t = length > 0 ? (across / length + 1) / 2 : 0.7
  return t < 0.7 ? left + ((1 - left) * t) / 0.7 : 1 + ((right - 1) * (t - 0.7)) / 0.3
}

/**
 * Paint a solid's faces that face the camera, `base` pixels up. A convex
 * solid's front faces never cover each other, so their order doesn't matter.
 */
export function drawSolid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  faces: readonly Face[],
  base: number,
  fill: (top: boolean, light: number) => string,
  left: number,
  right: number,
): void {
  const toward = towardCamera(camera.yaw)
  const at = (p: Vec3): Point => lift(cellToScreen(p.x, p.y, camera), camera, base + p.z)
  for (const face of faces) {
    const normal = newell(face.points)
    if (normal.x * toward.x + normal.y * toward.y + normal.z * toward.z <= 0) continue
    const color = fill(face.top, face.top ? 1 : faceLight(normal, camera.yaw, left, right))
    ctx.beginPath()
    face.points.forEach((p, i) => {
      const s = at(p)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    // A hairline of its own colour closes the seams antialiasing leaves between facets.
    ctx.strokeStyle = color
    ctx.lineWidth = 0.6
    ctx.stroke()
  }
}
