import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ObjectPart } from '../../objects/catalog.ts'
import {
  clampShift,
  dragPlanHandle,
  partTop,
  planRect,
  rectsTouch,
  snap,
  topColor,
  translate,
  widestRadius,
  type PlanHandle,
  type Rect,
} from './geometry.ts'
import { followDrag, HOVER, isAdditive, OUTSIDE, SELECT, usePixel, type ViewProps } from './views.ts'

const PAD = 0.3
const HANDLE = 9

const BOX_HANDLES: ReadonlyArray<{ handle: Exclude<PlanHandle, 'radius'>; cursor: string }> = [
  { handle: { x: 'lo', y: 'lo' }, cursor: 'nwse-resize' },
  { handle: { y: 'lo' }, cursor: 'ns-resize' },
  { handle: { x: 'hi', y: 'lo' }, cursor: 'nesw-resize' },
  { handle: { x: 'hi' }, cursor: 'ew-resize' },
  { handle: { x: 'hi', y: 'hi' }, cursor: 'nwse-resize' },
  { handle: { y: 'hi' }, cursor: 'ns-resize' },
  { handle: { x: 'lo', y: 'hi' }, cursor: 'nesw-resize' },
  { handle: { x: 'lo' }, cursor: 'ew-resize' },
]

/**
 * The object seen from straight above, front at the bottom. Drag a part to
 * move it, its handles to size it, or empty floor to box-select.
 */
export function PlanView({ draft, selected, hover, snapStep, onSelect, onSelectMany, onHover }: ViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const def = draft.draft
  const viewBox = `${-PAD} ${-PAD} ${def.w + PAD * 2} ${def.d + PAD * 2}`
  const px = usePixel(svgRef, viewBox)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const primary = selected.at(-1)
  const primaryPart = primary === undefined ? undefined : def.parts[primary]
  // Highest last, so what's on top in the 3D view is on top here too.
  const order = def.parts.map((_, i) => i).sort((a, b) => partTop(def.parts[a]!) - partTop(def.parts[b]!) || a - b)

  function startMove(event: ReactPointerEvent, index: number): void {
    const svg = svgRef.current
    if (!svg) return
    if (isAdditive(event)) {
      onSelect(index, true)
      return
    }
    const group = selected.includes(index) ? selected : [index]
    if (!selected.includes(index)) onSelect(index, false)
    const start = draft.get()
    const anchor = planRect(start.parts[index]!)
    draft.begin()
    const from = followDrag(
      event,
      svg,
      (point, e) => {
        const step = e.altKey ? 0 : snapStep
        const { dx, dy } = clampShift(
          group.map((i) => start.parts[i]!),
          snap(anchor.x0 + point.x - from.x, step) - anchor.x0,
          snap(anchor.y0 + point.y - from.y, step) - anchor.y0,
          start,
        )
        draft.set({ ...start, parts: start.parts.map((part, i) => (group.includes(i) ? translate(part, dx, dy) : part)) })
      },
      (moved) => {
        draft.end()
        // A click on one of several selected parts narrows the selection to it.
        if (!moved && group.length > 1) onSelect(index, false)
      },
    )
  }

  function startHandle(event: ReactPointerEvent, handle: PlanHandle): void {
    const svg = svgRef.current
    if (!svg || primary === undefined) return
    const start = draft.get()
    draft.begin()
    followDrag(
      event,
      svg,
      (point, e) => {
        const step = e.altKey ? 0 : snapStep
        draft.set({
          ...start,
          parts: start.parts.map((part, i) => (i === primary ? dragPlanHandle(part, handle, point.x, point.y, step, start) : part)),
        })
      },
      () => draft.end(),
    )
  }

  function startMarquee(event: ReactPointerEvent): void {
    const svg = svgRef.current
    if (!svg) return
    const additive = isAdditive(event)
    let box: Rect | null = null
    const from = followDrag(
      event,
      svg,
      (point) => {
        box = { x0: Math.min(from.x, point.x), y0: Math.min(from.y, point.y), x1: Math.max(from.x, point.x), y1: Math.max(from.y, point.y) }
        setMarquee(box)
      },
      (moved) => {
        setMarquee(null)
        const area = box
        if (!moved || !area) {
          if (!additive) onSelect(null, false)
          return
        }
        const hits = draft
          .get()
          .parts.map((part, i) => (rectsTouch(planRect(part), area) ? i : -1))
          .filter((i) => i >= 0)
        onSelectMany(hits, additive)
      },
    )
  }

  const handleSize = HANDLE * px
  return (
    <svg ref={svgRef} className="studio-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" onPointerDown={startMarquee}>
      <Grid w={def.w} d={def.d} />
      <rect x={0} y={0} width={def.w} height={def.d} className="studio-footprint" vectorEffect="non-scaling-stroke" />
      <text x={def.w / 2} y={def.d + PAD * 0.7} className="studio-axis-label" fontSize={11 * px} textAnchor="middle">
        FRONT
      </text>

      {order.map((index) => {
        const part = def.parts[index]!
        const isSelected = selected.includes(index)
        const rect = planRect(part)
        const outside = rect.x0 < -0.001 || rect.y0 < -0.001 || rect.x1 > def.w + 0.001 || rect.y1 > def.d + 0.001
        const stroke = isSelected ? SELECT : index === hover ? HOVER : outside ? OUTSIDE : 'rgba(0, 0, 0, 0.55)'
        return (
          <g
            key={index}
            className="studio-part"
            onPointerDown={(event) => startMove(event, index)}
            onPointerEnter={() => onHover(index)}
            onPointerLeave={() => onHover(null)}
          >
            <PartShape part={part} stroke={stroke} strokeWidth={isSelected ? 2 : 1} dashed={outside && !isSelected} />
          </g>
        )
      })}

      {primaryPart && <Handles part={primaryPart} size={handleSize} onStart={startHandle} />}

      {marquee && (
        <rect
          x={marquee.x0}
          y={marquee.y0}
          width={marquee.x1 - marquee.x0}
          height={marquee.y1 - marquee.y0}
          className="studio-marquee"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}

function PartShape({ part, stroke, strokeWidth, dashed }: { part: ObjectPart; stroke: string; strokeWidth: number; dashed: boolean }) {
  const common = {
    stroke,
    strokeWidth,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeDasharray: dashed ? '4 3' : undefined,
  }
  if (part.shape === 'round') {
    const r2 = part.r2 ?? part.r
    return (
      <>
        <circle cx={part.x} cy={part.y} r={widestRadius(part)} fill={part.color} {...common} />
        {r2 !== part.r && r2 > 0 && <circle cx={part.x} cy={part.y} r={r2} fill={topColor(part)} stroke="rgba(0,0,0,0.4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        {r2 === 0 && <circle cx={part.x} cy={part.y} r={Math.min(part.r, 0.03)} fill={topColor(part)} />}
      </>
    )
  }
  if (part.shape === 'flat') {
    return (
      <>
        <rect x={part.x} y={part.y} width={part.w} height={part.d} fill={part.border ?? part.color} {...common} />
        {part.border && part.w > 0.14 && part.d > 0.14 && (
          <rect x={part.x + 0.07} y={part.y + 0.07} width={part.w - 0.14} height={part.d - 0.14} fill={part.color} />
        )}
      </>
    )
  }
  return <rect x={part.x} y={part.y} width={part.w} height={part.d} fill={topColor(part)} {...common} />
}

function Handles({
  part,
  size,
  onStart,
}: {
  part: ObjectPart
  size: number
  onStart: (event: ReactPointerEvent, handle: PlanHandle) => void
}) {
  if (part.shape === 'round') {
    const r = part.r
    return (
      <rect
        x={part.x + r - size / 2}
        y={part.y - size / 2}
        width={size}
        height={size}
        rx={size / 2}
        className="studio-handle"
        style={{ cursor: 'ew-resize' }}
        vectorEffect="non-scaling-stroke"
        onPointerDown={(event) => onStart(event, 'radius')}
      />
    )
  }
  const rect = planRect(part)
  const at = (side: 'lo' | 'hi' | undefined, lo: number, hi: number) => (side === 'lo' ? lo : side === 'hi' ? hi : (lo + hi) / 2)
  return (
    <>
      {BOX_HANDLES.map(({ handle, cursor }) => (
        <rect
          key={`${handle.x ?? '-'}${handle.y ?? '-'}`}
          x={at(handle.x, rect.x0, rect.x1) - size / 2}
          y={at(handle.y, rect.y0, rect.y1) - size / 2}
          width={size}
          height={size}
          className="studio-handle"
          style={{ cursor }}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => onStart(event, handle)}
        />
      ))}
    </>
  )
}

/** Quarter-cell lines with whole cells stronger, inside the footprint. */
function Grid({ w, d }: { w: number; d: number }) {
  const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
  for (let i = 0; i <= w * 4; i++) lines.push({ x1: i / 4, y1: 0, x2: i / 4, y2: d, major: i % 4 === 0 })
  for (let i = 0; i <= d * 4; i++) lines.push({ x1: 0, y1: i / 4, x2: w, y2: i / 4, major: i % 4 === 0 })
  return (
    <g pointerEvents="none">
      {lines.map(({ major, ...line }, i) => (
        <line key={i} {...line} className={major ? 'studio-grid is-major' : 'studio-grid'} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  )
}
