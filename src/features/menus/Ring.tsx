import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../../ui/Icon.tsx'
import { RING_CONTROL, type Spot } from './ringLayout.ts'

/** A control centred on its seat, measured from the middle of the ring's box. */
function place(spot: Spot): CSSProperties {
  return {
    left: `calc(50% + ${spot.x - RING_CONTROL / 2}px)`,
    top: `calc(50% + ${spot.y - RING_CONTROL / 2}px)`,
    width: RING_CONTROL,
    height: RING_CONTROL,
  }
}

/** The dashed guide circle the controls sit on, at the ring's radius. */
export function Ring({ radius, children }: { radius: number; children: ReactNode }) {
  return (
    <>
      <span className="ring-guide" aria-hidden style={{ width: radius * 2, height: radius * 2 }} />
      {children}
    </>
  )
}

export function RingButton({
  spot,
  icon,
  label,
  title,
  onClick,
  active = false,
  danger = false,
}: {
  spot: Spot
  icon: string
  label: string
  title?: string
  onClick: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={`ring-btn${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`}
      style={place(spot)}
      aria-pressed={active || undefined}
      title={title ?? label}
      onClick={onClick}
    >
      <Icon id={icon} size={18} />
      <span>{label}</span>
    </button>
  )
}

/** A round seat split into ▲ / value / ▼, for values nudged in steps. */
export function RingStepper({
  spot,
  label,
  value,
  caption,
  decLabel,
  incLabel,
  onDec,
  onInc,
  decDisabled = false,
  incDisabled = false,
}: {
  spot: Spot
  label: string
  value: string
  caption: string
  decLabel: string
  incLabel: string
  onDec: () => void
  onInc: () => void
  decDisabled?: boolean
  incDisabled?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="ring-stepper" style={place(spot)}>
      <button type="button" className="is-up" aria-label={incLabel} title={incLabel} onClick={onInc} disabled={incDisabled}>
        <Icon id="chevronUp" size={14} strokeWidth={2.2} />
      </button>
      <span className="ring-stepper-value">
        <span>{value}</span>
        <small>{caption}</small>
      </span>
      <button type="button" className="is-down" aria-label={decLabel} title={decLabel} onClick={onDec} disabled={decDisabled}>
        <Icon id="chevronDown" size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}

/** The token or label at the middle of the ring. */
export function RingCore({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ring-core${className ? ` ${className}` : ''}`}>{children}</div>
}
