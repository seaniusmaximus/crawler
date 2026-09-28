import { polar, wedgePath } from './radialGeometry.ts'
import { SliceIcon } from './radialIcons.tsx'

export interface WheelSlice {
  id: string
  label: string
  icon?: string
  start: number
  sweep: number
  r0: number
  r1: number
  danger?: boolean
  active?: boolean
}

/** Four equal 90° sectors. Inner and outer stacked rings are the same thickness. */
export const WHEEL_SIZE = 336
export const WHEEL_INNER = 46
export const WHEEL_OUTER = 160
export const WHEEL_MID = (WHEEL_INNER + WHEEL_OUTER) / 2
export const WHEEL_GUTTER = 7

const STACKED_BAND = (WHEEL_OUTER - WHEEL_INNER) / 2 + 4
const ICON_GAP = 5

function textWidth(label: string, fontSize: number): number {
  return label.length * fontSize * 0.62
}

export function RadialWheel({
  slices,
  onChoose,
}: {
  slices: readonly WheelSlice[]
  onChoose: (id: string) => void
}) {
  const cx = WHEEL_SIZE / 2
  const cy = WHEEL_SIZE / 2

  return (
    <svg
      className="radial-wheel"
      width={WHEEL_SIZE}
      height={WHEEL_SIZE}
      viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
    >
      <circle className="radial-disc" cx={cx} cy={cy} r={WHEEL_OUTER} />
      {slices.map((slice) => {
        const stacked = slice.r1 - slice.r0 < STACKED_BAND
        const innerRing = stacked && slice.r1 <= WHEEL_MID
        const path = wedgePath(cx, cy, slice.r0, slice.r1, slice.start, slice.sweep, WHEEL_GUTTER)
        const iconId = slice.icon ?? slice.id
        const fontSize = stacked ? 11 : 12
        const iconSize = stacked ? 15 : 17
        const captionW = iconSize + ICON_GAP + textWidth(slice.label, fontSize)
        const at = polar(cx, cy, (slice.r0 + slice.r1) / 2, slice.start + slice.sweep / 2)
        const className = [
          'radial-wedge',
          innerRing ? 'is-inner' : '',
          slice.danger ? 'is-danger' : '',
          slice.active ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <g
            key={slice.id}
            className={className}
            role="button"
            tabIndex={0}
            aria-label={slice.label}
            aria-pressed={slice.active || undefined}
            onClick={() => onChoose(slice.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onChoose(slice.id)
              }
            }}
          >
            <path className="radial-slice" d={path} />
            <g
              className="radial-caption"
              transform={`translate(${at.x - captionW / 2} ${at.y})`}
            >
              <g transform={`translate(0 ${-iconSize / 2}) scale(${iconSize / 24})`}>
                <SliceIcon id={iconId} />
              </g>
              <text className="radial-label" x={iconSize + ICON_GAP} y={0} fontSize={fontSize}>
                {slice.label}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}
