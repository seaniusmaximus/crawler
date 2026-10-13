import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  capitalize,
  DAMAGE_TYPES,
  DEFENSE_CYCLE,
  DEFENSE_LABEL,
  DEFENSE_MARK,
  nextDefense,
  typesWith,
  type Defenses,
} from '../../model/damage.ts'
import { cleanRange, formatSenses, SENSE_HINT, SENSE_LABEL, SENSE_PRESETS, SENSES, type Senses } from '../../model/senses.ts'
import type { CharacterStats } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'

type Open = 'senses' | 'defenses' | null

/**
 * A stat block's senses and damage defenses, written out as a stat block does
 * ("Damage Resistances fire, cold"). Clicking a line opens its quick editor.
 */
export function CreatureTraits({ player, stats, editable }: { player: Player; stats: CharacterStats; editable: boolean }) {
  const [open, setOpen] = useState<Open>(null)
  const senses = player.senses ?? {}
  const defenses = player.defenses ?? {}
  const sensesText = [formatSenses(senses), stats.passivePerception != null ? `passive Perception ${stats.passivePerception}` : '']
    .filter(Boolean)
    .join(', ')
  const defenseLines = DEFENSE_CYCLE.map((defense) => ({ defense, types: typesWith(defenses, defense) })).filter(
    (line) => line.types.length > 0,
  )

  if (!editable && !sensesText && defenseLines.length === 0) return null
  const toggle = (which: Exclude<Open, null>) => setOpen((now) => (now === which ? null : which))

  return (
    <div className="block-lines traits">
      <TraitLine label="Senses" editable={editable} open={open === 'senses'} onToggle={() => toggle('senses')}>
        {sensesText || <span className="trait-none">{editable ? 'Add darkvision, tremorsense…' : '—'}</span>}
      </TraitLine>
      {open === 'senses' ? <SensesEditor player={player} senses={senses} stats={stats} /> : null}

      {defenseLines.length === 0 ? (
        editable ? (
          <TraitLine label="Defenses" editable open={open === 'defenses'} onToggle={() => toggle('defenses')}>
            <span className="trait-none">Add resistances, immunities…</span>
          </TraitLine>
        ) : null
      ) : (
        defenseLines.map((line, index) => (
          <TraitLine
            key={line.defense}
            label={`Damage ${DEFENSE_LABEL[line.defense]}`}
            editable={editable}
            // One editor covers every line; only the first line shows the toggle's state.
            open={index === 0 && open === 'defenses'}
            onToggle={() => toggle('defenses')}
          >
            {line.types.join(', ')}
          </TraitLine>
        ))
      )}
      {open === 'defenses' ? <DefensesEditor player={player} defenses={defenses} /> : null}
    </div>
  )
}

function TraitLine({
  label,
  editable,
  open,
  onToggle,
  children,
}: {
  label: string
  editable: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  if (!editable) {
    return (
      <div>
        <span className="block-label">{label}</span> {children}
      </div>
    )
  }
  return (
    <button type="button" className={`trait-line${open ? ' is-open' : ''}`} aria-expanded={open} onClick={onToggle}>
      <span>
        <span className="block-label">{label}</span> {children}
      </span>
      <Icon id={open ? 'chevronUp' : 'pencil'} size={13} />
    </button>
  )
}

function SensesEditor({ player, senses, stats }: { player: Player; senses: Senses; stats: CharacterStats }) {
  const store = useDungeonStore.getState()
  const setRange = (sense: (typeof SENSES)[number], range: number | undefined) =>
    store.setPlayerSenses(player.id, { ...senses, [sense]: range })

  return (
    <div className="trait-editor">
      {SENSES.map((sense) => {
        const range = senses[sense]
        return (
          <div key={sense} className="sense-row" title={SENSE_HINT[sense]}>
            <span className="sense-name">{SENSE_LABEL[sense]}</span>
            <span className="sense-presets">
              {SENSE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`sense-chip${range === preset ? ' is-on' : ''}`}
                  aria-pressed={range === preset}
                  // Clicking the range it already has takes the sense away.
                  onClick={() => setRange(sense, range === preset ? undefined : preset)}
                >
                  {preset}
                </button>
              ))}
            </span>
            <FeetInput
              // Remounted when a chip changes it, so the box shows the new range.
              key={range ?? 'none'}
              label={`${SENSE_LABEL[sense]} range`}
              value={range}
              onCommit={(value) => setRange(sense, value)}
            />
          </div>
        )
      })}
      <div className="sense-row">
        <span className="sense-name">Passive Perception</span>
        <FeetInput
          key={stats.passivePerception ?? 'none'}
          label="Passive Perception"
          value={stats.passivePerception ?? undefined}
          unit=""
          onCommit={(value) => store.setPlayerStat(player.id, 'passivePerception', value ?? null)}
        />
      </div>
    </div>
  )
}

function FeetInput({
  label,
  value,
  unit = 'ft',
  onCommit,
}: {
  label: string
  value: number | undefined
  unit?: string
  onCommit: (value: number | undefined) => void
}) {
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') event.currentTarget.blur()
  }
  return (
    <label className="feet-input">
      <input
        className="stat-input"
        inputMode="numeric"
        defaultValue={value ?? ''}
        placeholder="—"
        aria-label={label}
        onBlur={(event) => {
          const next = cleanRange(event.target.value)
          if (next !== value) onCommit(next)
        }}
        onKeyDown={keys}
      />
      {unit ? <span>{unit}</span> : null}
    </label>
  )
}

function DefensesEditor({ player, defenses }: { player: Player; defenses: Defenses }) {
  const store = useDungeonStore.getState()
  return (
    <div className="trait-editor">
      <p className="defense-legend">
        Click a type to step through
        {DEFENSE_CYCLE.map((defense) => (
          <span key={defense} className={`defense-key is-${defense}`}>
            {DEFENSE_MARK[defense]} {defense}
          </span>
        ))}
      </p>
      <div className="defense-grid">
        {DAMAGE_TYPES.map((type) => {
          const defense = defenses[type]
          return (
            <button
              key={type}
              type="button"
              className={`defense-chip${defense ? ` is-${defense}` : ''}`}
              title={defense ? `${capitalize(type)}: ${defense}` : `${capitalize(type)}: takes normal damage`}
              onClick={() => store.setPlayerDefenses(player.id, { ...defenses, [type]: nextDefense(defense) })}
            >
              {capitalize(type)}
              {defense ? <span className="defense-mark">{DEFENSE_MARK[defense]}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
