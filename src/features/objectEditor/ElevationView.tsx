import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { WALL_HEIGHT } from '../../canvas/camera.ts'
import type { ObjectPart } from '../../objects/catalog.ts'
import { MAX_CUSTOM_HEIGHT } from '../../objects/custom.ts'
import {
  axisSpan,
  CELL_Z,
  clampShift,
  dragElevationHandle,
  partBottom,
  partTop,
  snap,
  translate,
  type Axis,
  type ElevationHandle,
} from './geometry.ts'
import { followDrag, HOVER, isAdditive, SELECT, usePixel, type ViewProps } from './views.ts'

const PAD = 0.35
const HANDLE = 9
/** How high the view reaches, in cells: the tallest a part may stand, plus room for handles. */
const REACH = MAX_CUSTOM_HEIGHT / CELL_Z + 0.12

/** Height in pixels to the view's vertical units (cells, up being negative). */
const v = (z: number) => -z / CELL_Z

/**
 * The object seen from the front (`axis` x) or from its left side (`axis` y),
 * with the front to the right. Drag a part to slide it along and up or down;
 * drag its handles to set its width, its bottom and top, or a round's radii.
 */
export function ElevationView({ draft, selected, hover, snapStep, onSelect, onHover, axis }: ViewProps & { axis: Axis }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const def = draft.draft
  const length = axis === 'x' ? def.w : def.d
  const viewBox = `${-PAD} ${-REACH} ${length + PAD * 2} ${REACH + PAD}`
  const px = usePixel(svgRef, viewBox)
  const depth = axis === 'x' ? 'y' : 'x'
  const primary = selected.at(-1)
  const primaryPart = primary === undefined ? undefined : def.parts[primary]
  // Farthest first: from the front, larger y is nearer; from the left side, smaller x is.
  const nearness = (part: ObjectPart) => {
    const [lo, hi] = axisSpan(part, depth)
    return axis === 'x' ? (lo + hi) / 2 : -(lo + hi) / 2
  }
  const order = def.parts.map((_, i) => i).sort((a, b) => nearness(def.parts[a]!) - nearness(def.parts[b]!) || a - b)

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
    const anchor = start.parts[index]!
    const [anchorLo] = axisSpan(anchor, axis)
    const anchorZ = partBottom(anchor)
    draft.begin()
    const from = followDrag(
      event,
      svg,
      (point, e) => {
        const step = e.altKey ? 0 : snapStep
        const wanted = snap(anchorLo + point.x - from.x, step) - anchorLo
        const shift = clampShift(group.map((i) => start.parts[i]!), axis === 'x' ? wanted : 0, axis === 'y' ? wanted : 0, start)
        const along = axis === 'x' ? shift.dx : shift.dy
        const dz = anchor.shape === 'flat' ? 0 : Math.max(0, Math.round(anchorZ - (point.y - from.y) * CELL_Z)) - anchorZ
        draft.set({
          ...start,
          parts: start.parts.map((part, i) =>
            group.includes(i) ? translate(part, axis === 'x' ? along : 0, axis === 'y' ? along : 0, dz) : part,
          ),
        })
      },
      (moved) => {
        draft.end()
        if (!moved && group.length > 1) onSelect(index, false)
      },
    )
  }

  function startHandle(event: ReactPointerEvent, handle: ElevationHandle): void {
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
          parts: start.parts.map((part, i) =>
            i === primary ? dragElevationHandle(part, axis, handle, point.x, -point.y * CELL_Z, step, start) : part,
          ),
        })
      },
      () => draft.end(),
    )
  }

  const size = HANDLE * px
  return (
    <svg
      ref={svgRef}
      className="studio-svg"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMax meet"
      onPointerDown={(event) => {
        if (!isAdditive(event)) onSelect(null, false)
      }}
    >
      <g pointerEvents="none">
        {Array.from({ length: Math.floor(MAX_CUSTOM_HEIGHT / 5) + 1 }, (_, i) => i * 5).map((z) => (
          <line
            key={z}
            x1={0}
            x2={length}
            y1={v(z)}
            y2={v(z)}
            className={z % WALL_HEIGHT === 0 ? 'studio-grid is-major' : 'studio-grid'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {Array.from({ length: length * 4 + 1 }, (_, i) => i / 4).map((u) => (
          <line
            key={`u${u}`}
            x1={u}
            x2={u}
            y1={0}
            y2={v(MAX_CUSTOM_HEIGHT)}
            className={Number.isInteger(u) ? 'studio-grid is-major' : 'studio-grid'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line x1={-PAD} x2={length + PAD} y1={0} y2={0} className="studio-ground" vectorEffect="non-scaling-stroke" />
        <line x1={-PAD} x2={length + PAD} y1={v(WALL_HEIGHT)} y2={v(WALL_HEIGHT)} className="studio-wall-line" vectorEffect="non-scaling-stroke" />
        <text x={-PAD * 0.92} y={v(WALL_HEIGHT) - 4 * px} className="studio-axis-label" fontSize={10 * px}>
          WALL
        </text>
        <text x={0} y={PAD * 0.75} className="studio-axis-label" fontSize={10 * px}>
          {axis === 'x' ? 'LEFT' : 'BACK'}
        </text>
        <text x={length} y={PAD * 0.75} className="studio-axis-label" fontSize={10 * px} textAnchor="end">
          {axis === 'x' ? 'RIGHT' : 'FRONT'}
        </text>
      </g>

      {order.map((index) => {
        const part = def.parts[index]!
        const isSelected = selected.includes(index)
        const stroke = isSelected ? SELECT : index === hover ? HOVER : 'rgba(0, 0, 0, 0.55)'
        return (
          <g
            key={index}
            className="studio-part"
            onPointerDown={(event) => startMove(event, index)}
            onPointerEnter={() => onHover(index)}
            onPointerLeave={() => onHover(null)}
          >
            <SideShape part={part} axis={axis} px={px} stroke={stroke} strokeWidth={isSelected ? 2 : 1} />
          </g>
        )
      })}

      {primaryPart && <Handles part={primaryPart} axis={axis} size={size} onStart={startHandle} />}
    </svg>
  )
}

function SideShape({ part, axis, px, stroke, strokeWidth }: { part: ObjectPart; axis: Axis; px: number; stroke: string; strokeWidth: number }) {
  const common = { stroke, strokeWidth, vectorEffect: 'non-scaling-stroke' as const }
  if (part.shape === 'round') {
    const centre = axis === 'x' ? part.x : part.y
    const r2 = part.r2 ?? part.r
    const bottom = v(part.z)
    const top = v(part.z + part.h)
    const points = [
      [centre - part.r, bottom],
      [centre + part.r, bottom],
      [centre + r2, top],
      [centre - r2, top],
    ]
    return <polygon points={points.map((p) => p.join(',')).join(' ')} fill={part.color} {...common} />
  }
  const [lo, hi] = axisSpan(part, axis)
  if (part.shape === 'flat') {
    // A rug has no height; drawn a few pixels thick so it can be grabbed.
    return <rect x={lo} y={-4 * px} width={hi - lo} height={4 * px} fill={part.color} {...common} />
  }
  return <rect x={lo} y={v(partTop(part))} width={hi - lo} height={part.h / CELL_Z} fill={part.color} {...common} />
}

function Handles({
  part,
  axis,
  size,
  onStart,
}: {
  part: ObjectPart
  axis: Axis
  size: number
  onStart: (event: ReactPointerEvent, handle: ElevationHandle) => void
}) {
  const [lo, hi] = axisSpan(part, axis)
  const bottom = v(partBottom(part))
  const top = v(partTop(part))
  const middle = (bottom + top) / 2
  const handles: { handle: ElevationHandle; x: number; y: number; cursor: string; round?: boolean }[] = []
  if (part.shape === 'round') {
    const centre = axis === 'x' ? part.x : part.y
    const r2 = part.r2 ?? part.r
    handles.push(
      { handle: 'lo', x: centre - part.r, y: bottom, cursor: 'ew-resize', round: true },
      { handle: 'hi', x: centre + part.r, y: bottom, cursor: 'ew-resize', round: true },
      { handle: 'topRadius', x: centre + r2, y: top, cursor: 'ew-resize', round: true },
      { handle: 'top', x: centre, y: top, cursor: 'ns-resize' },
      { handle: 'bottom', x: centre, y: bottom, cursor: 'ns-resize' },
    )
  } else {
    const at = part.shape === 'flat' ? -2 * (size / 9) : middle
    handles.push({ handle: 'lo', x: lo, y: at, cursor: 'ew-resize' }, { handle: 'hi', x: hi, y: at, cursor: 'ew-resize' })
    if (part.shape === 'box') {
      handles.push(
        { handle: 'top', x: (lo + hi) / 2, y: top, cursor: 'ns-resize' },
        { handle: 'bottom', x: (lo + hi) / 2, y: bottom, cursor: 'ns-resize' },
      )
    }
  }
  return (
    <>
      {handles.map((item) => (
        <rect
          key={item.handle}
          x={item.x - size / 2}
          y={item.y - size / 2}
          width={size}
          height={size}
          rx={item.round ? size / 2 : 1.5 * (size / 9)}
          className="studio-handle"
          style={{ cursor: item.cursor }}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(event) => onStart(event, item.handle)}
        />
      ))}
    </>
  )
}
