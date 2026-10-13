import { useState } from 'react'
import { DAMAGE_FACES, MAX_DAMAGE_TYPE } from '../../model/attacks.ts'
import { capitalize, DAMAGE_TYPES } from '../../model/damage.ts'
import { Icon } from '../../ui/Icon.tsx'

/** The damage die, picked from icons as on the dice tray. */
export function DiePicker({ faces, onPick, dim = false }: { faces: number; onPick: (faces: number) => void; dim?: boolean }) {
  return (
    <div className={`attack-dice${dim ? ' is-dim' : ''}`} role="group" aria-label="Damage die">
      {DAMAGE_FACES.map((face) => (
        <button
          key={face}
          type="button"
          className={`die-pick${face === faces ? ' is-active' : ''}`}
          aria-pressed={face === faces}
          onClick={() => onPick(face)}
        >
          <Icon id={`d${face}`} size={20} strokeWidth={1.4} />
          <span>d{face}</span>
        </button>
      ))}
    </div>
  )
}

/** The select's own value for "write my own". */
const CUSTOM_TYPE = '__custom'

/**
 * The damage type: the usual ones from a dropdown (plus any `extra`, such as
 * Healing for spells), None, or a type the DM writes in.
 */
export function DamageTypeField({
  value,
  onChange,
  extra = [],
}: {
  value: string
  onChange: (type: string) => void
  extra?: readonly string[]
}) {
  const known = [...DAMAGE_TYPES, ...extra]
  const [custom, setCustom] = useState(value !== '' && !known.includes(value.toLowerCase()))

  return (
    <div className="attack-line">
      <label className="attack-select">
        <span className="kicker">Type</span>
        <select
          className="tileset-select"
          value={custom ? CUSTOM_TYPE : value.toLowerCase()}
          onChange={(event) => {
            const next = event.target.value
            setCustom(next === CUSTOM_TYPE)
            onChange(next === CUSTOM_TYPE ? '' : next)
          }}
        >
          {known.map((type) => (
            <option key={type} value={type}>
              {capitalize(type)}
            </option>
          ))}
          <option value="">None</option>
          <option value={CUSTOM_TYPE}>Write in…</option>
        </select>
      </label>
      {custom ? (
        <input
          className="stat-input attack-custom-type"
          value={value}
          maxLength={MAX_DAMAGE_TYPE}
          autoFocus
          aria-label="Damage type"
          placeholder="e.g. silvered"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  )
}
