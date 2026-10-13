import { Icon } from './Icon.tsx'

/** A labelled value with − and + either side, as on the dice tray. */
export function Stepper({
  label,
  value,
  onDown,
  onUp,
  downDisabled,
  upDisabled,
  className,
}: {
  label: string
  value: string
  onDown: () => void
  onUp: () => void
  downDisabled?: boolean
  upDisabled?: boolean
  className?: string
}) {
  return (
    <div className={`stepper${className ? ` ${className}` : ''}`}>
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" aria-label={`Decrease ${label}`} onClick={onDown} disabled={downDisabled}>
          <Icon id="minus" size={13} />
        </button>
        <span className="stepper-value">{value}</span>
        <button type="button" aria-label={`Increase ${label}`} onClick={onUp} disabled={upDisabled}>
          <Icon id="plus" size={13} />
        </button>
      </div>
    </div>
  )
}
