import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cellToScreen, isoDepth, lift, wrapYaw, type Point } from '../../canvas/camera.ts'
import { drawObjectPreview, fitObjectCamera } from '../../canvas/objects.ts'
import type { ObjectDef, ObjectPart } from '../../objects/catalog.ts'
import type { Camera } from '../../model/types.ts'
import { partBottom, partTop, planRect } from './geometry.ts'
import { HOVER, isAdditive, SELECT } from './views.ts'

/** The view always fits at least this much height, so it doesn't zoom about as a short part grows. */
const REACH = 40

/**
 * The object as the map will draw it, turning with the buttons. Clicking picks
 * the part drawn on top at that spot.
 */
export function IsoView({
  def,
  selected,
  hover,
  onSelect,
  onHover,
}: {
  def: ObjectDef
  selected: readonly number[]
  hover: number | null
  onSelect: (index: number | null, additive: boolean) => void
  onHover: (index: number | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 320, height: 260 })
  const [yaw, setYaw] = useState<Camera['yaw']>(0)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => setSize({ width: wrap.clientWidth, height: wrap.clientHeight }))
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const camera = useMemo(() => {
    let tallest = REACH
    for (const part of def.parts) tallest = Math.max(tallest, partTop(part))
    return fitObjectCamera(def, size.width, size.height, yaw, 28, 5, tallest)
  }, [def, size, yaw])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || size.width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    drawObjectPreview(ctx, camera, def, '#9a9da8')
    for (const index of selected) {
      const part = def.parts[index]
      if (part) outlinePart(ctx, camera, part, SELECT)
    }
    const hovered = hover === null ? undefined : def.parts[hover]
    if (hovered && !selected.includes(hover!)) outlinePart(ctx, camera, hovered, HOVER)
  }, [camera, def, selected, hover, size])

  function partAt(event: ReactPointerEvent): number | null {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return pickPart(def, camera, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  return (
    <div className="studio-iso">
      <div ref={wrapRef} className="studio-iso-canvas">
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height }}
          onPointerDown={(event) => {
            const index = partAt(event)
            if (index !== null || !isAdditive(event)) onSelect(index, isAdditive(event))
          }}
          onPointerMove={(event) => onHover(partAt(event))}
          onPointerLeave={() => onHover(null)}
          aria-label="3D view; click a part to select it"
        />
      </div>
      <div className="studio-iso-turn">
        <button type="button" className="studio-icon-btn" onClick={() => setYaw((value) => wrapYaw(value - 1))} title="Walk the view around one way">
          ⟲
        </button>
        <button type="button" className="studio-icon-btn" onClick={() => setYaw((value) => wrapYaw(value + 1))} title="Walk the view around the other way">
          ⟳
        </button>
      </div>
    </div>
  )
}

/** Screen points around a part's whole volume, enough to wrap it in a hull. */
function partPoints(part: ObjectPart, camera: Camera): Point[] {
  const bottom = partBottom(part)
  const top = partTop(part)
  const at = (x: number, y: number, z: number) => lift(cellToScreen(x, y, camera), camera, z)
  if (part.shape === 'round') {
    const points: Point[] = []
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      points.push(at(part.x + Math.cos(angle) * part.r, part.y + Math.sin(angle) * part.r, bottom))
      const r2 = part.r2 ?? part.r
      points.push(at(part.x + Math.cos(angle) * r2, part.y + Math.sin(angle) * r2, top))
    }
    return points
  }
  const rect = planRect(part)
  const corners = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y0],
    [rect.x1, rect.y1],
    [rect.x0, rect.y1],
  ] as const
  return corners.flatMap(([x, y]) => [at(x, y, bottom), at(x, y, top)])
}

/** The part painted last under a screen point: the highest-standing, then the nearest. */
function pickPart(def: ObjectDef, camera: Camera, point: Point): number | null {
  let best: { index: number; bottom: number; depth: number } | null = null
  for (const [index, part] of def.parts.entries()) {
    if (!insideHull(hull(partPoints(part, camera)), point)) continue
    const rect = planRect(part)
    const bottom = part.shape === 'flat' ? -1 : partBottom(part)
    const depth = isoDepth((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, camera.yaw)
    if (!best || bottom > best.bottom || (bottom === best.bottom && depth >= best.depth)) best = { index, bottom, depth }
  }
  return best?.index ?? null
}

/** Convex hull, counter-clockwise (monotone chain). */
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function insideHull(polygon: Point[], point: Point): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A wire box around one part, drawn over the whole so it shows even when hidden inside. */
function outlinePart(ctx: CanvasRenderingContext2D, camera: Camera, part: ObjectPart, color: string): void {
  const rect = planRect(part)
  const z0 = partBottom(part)
  const z1 = partTop(part)
  const grid = [
    { x: rect.x0, y: rect.y0 },
    { x: rect.x1, y: rect.y0 },
    { x: rect.x1, y: rect.y1 },
    { x: rect.x0, y: rect.y1 },
  ]
  const low = grid.map((p) => lift(cellToScreen(p.x, p.y, camera), camera, z0))
  const high = grid.map((p) => lift(cellToScreen(p.x, p.y, camera), camera, z1))
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  for (const ring of z1 > z0 ? [low, high] : [low]) {
    ring.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)))
    ctx.closePath()
  }
  if (z1 > z0) {
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(low[i]!.x, low[i]!.y)
      ctx.lineTo(high[i]!.x, high[i]!.y)
    }
  }
  ctx.stroke()
  ctx.restore()
}
