import { useState } from 'react'
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  ABILITY_MOD_KEY,
  PASSIVE_KEYS,
  displayedAbilityMod,
  formatSigned,
  hpRatio,
  type CharacterStats,
  type StatKey,
} from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { hpTone } from './tokenInfo.ts'
import { rollAbilityCheck } from './tokenRolls.ts'
import type { Editing } from './useStatEditing.ts'

const PASSIVE_NAME: Record<(typeof PASSIVE_KEYS)[number], string> = {
  passivePerception: 'Passive Perception',
  passiveInsight: 'Insight',
  passiveInvestigation: 'Investigation',
}

/** A value that turns into a number input when clicked, if the viewer may edit it. */
export function EditableValue({
  label,
  value,
  display,
  editing,
  editable,
  className,
  onEdit,
  onCommit,
  onCancel,
}: {
  label: string
  value: number | null
  display?: string
  editing: boolean
  editable: boolean
  className?: string
  onEdit: () => void
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  if (editable && editing) {
    return <StatInput label={label} value={value} onCommit={onCommit} onCancel={onCancel} />
  }
  return (
    <button
      type="button"
      className={`stat-value${className ? ` ${className}` : ''}${value == null ? ' is-empty' : ''}`}
      disabled={!editable}
      onClick={() => editable && onEdit()}
      title={editable ? `Edit ${label}` : label}
    >
      {display ?? (value ?? '–')}
    </button>
  )
}

/** Damage and healing for tokens Crawler owns outright, such as monsters. */
export function HpAdjust({ player, stats }: { player: Player; stats: CharacterStats }) {
  const [amount, setAmount] = useState('')
  const temp = stats.hpTemp != null && stats.hpTemp > 0 ? stats.hpTemp : 0
  if (stats.hp == null) return null
  const hp = stats.hp

  function apply(sign: 1 | -1): void {
    const value = Math.abs(Math.round(Number(amount)))
    if (!value) return
    const store = useDungeonStore.getState()
    if (sign < 0) {
      const absorbed = Math.min(temp, value)
      if (absorbed > 0) store.setPlayerStat(player.id, 'hpTemp', temp - absorbed)
      store.setPlayerStat(player.id, 'hp', Math.max(0, hp - (value - absorbed)))
    } else {
      const healed = hp + value
      store.setPlayerStat(player.id, 'hp', stats.hpMax != null ? Math.min(stats.hpMax, healed) : healed)
    }
    setAmount('')
  }

  return (
    <form
      className="hp-adjust"
      onSubmit={(event) => {
        event.preventDefault()
        apply(-1)
      }}
    >
      <button type="button" className="soft-btn is-damage" onClick={() => apply(-1)}>
        Damage
      </button>
      <label className="hp-amount">
        <span className="sr-only">Amount</span>
        <input
          inputMode="numeric"
          value={amount}
          placeholder="0"
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </label>
      <button type="button" className="soft-btn is-heal" onClick={() => apply(1)}>
        Heal
      </button>
    </form>
  )
}

/**
 * Current and max hit points as two inputs, for characters and monsters alike.
 * Current saves without closing, so Tab moves on to max; max closes the editor.
 */
export function HpEdit({ player, stats, setEditing }: { player: Player; stats: CharacterStats; setEditing: (key: Editing) => void }) {
  return (
    <span className="hp-edit">
      <StatInput
        label="HP"
        value={stats.hp}
        onCommit={(value) => useDungeonStore.getState().setPlayerStat(player.id, 'hp', value)}
        onCancel={() => setEditing(null)}
      />
      <span aria-hidden="true">/</span>
      <StatInput
        label="Max HP"
        value={stats.hpMax}
        autoFocus={false}
        onCommit={(value) => {
          useDungeonStore.getState().setPlayerStat(player.id, 'hpMax', value)
          setEditing(null)
        }}
        onCancel={() => setEditing(null)}
      />
    </span>
  )
}

/** Hit points as a readout and bar; the numbers themselves are click-to-edit. */
export function HpBlock({
  player,
  stats,
  editable,
  editing,
  setEditing,
}: {
  player: Player
  stats: CharacterStats
  editable: boolean
  editing: Editing
  setEditing: (key: Editing) => void
}) {
  const ratio = hpRatio(stats.hp, stats.hpMax)
  const tone = hpTone(stats.hp, stats.hpMax)
  const temp = stats.hpTemp != null && stats.hpTemp > 0 ? stats.hpTemp : 0

  return (
    <div className="hp-block">
      <div className="hp-block-head">
        <span className="kicker">
          <Icon id="heart" size={14} className="is-hp" />
          Hit points
        </span>
        {editable && editing === 'hp' ? (
          <HpEdit player={player} stats={stats} setEditing={setEditing} />
        ) : (
          <button
            type="button"
            className="hp-readout"
            disabled={!editable}
            onClick={() => editable && setEditing('hp')}
            title={editable ? 'Edit hit points' : 'Hit points'}
          >
            <span className={`hp-now is-${tone}`}>{stats.hp ?? '–'}</span>
            <span className="hp-max"> / {stats.hpMax ?? '–'}</span>
            {temp > 0 ? <span className="hp-temp"> +{temp}</span> : null}
          </button>
        )}
      </div>
      <span className="hp-bar is-thick">
        <span className={`hp-fill is-${tone}`} style={{ width: `${(ratio ?? 0) * 100}%` }} />
      </span>
    </div>
  )
}

export function AbilityGrid({
  player,
  stats,
  editable,
  editing,
  setEditing,
  commit,
}: {
  player: Player
  stats: CharacterStats
  editable: boolean
  editing: Editing
  setEditing: (key: Editing) => void
  commit: (key: StatKey, value: string) => void
}) {
  return (
    <div className="ability-grid">
      {ABILITY_KEYS.map((key) => {
        const mod = displayedAbilityMod(stats, key)
        const modKey = ABILITY_MOD_KEY[key]
        const label = ABILITY_LABEL[key]
        // Whoever may edit the sheet may roll from it; the roll lands in the shared dice log.
        const canRoll = editable && mod != null
        return (
          <div key={key} className="ability">
            <button
              type="button"
              className="ability-roll"
              disabled={!canRoll}
              onClick={() => mod != null && rollAbilityCheck(player, key, mod)}
              title={canRoll ? `Roll ${label} check (d20 ${mod < 0 ? '−' : '+'} ${Math.abs(mod)})` : label}
            >
              <span className="kicker">{label}</span>
              <span className="ability-mod">{mod == null ? '–' : formatSigned(mod)}</span>
            </button>
            {editable && editing === modKey ? (
              <StatInput
                label={`${label} modifier`}
                value={mod}
                onCommit={(value) => commit(modKey, value)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <button
                type="button"
                className="ability-score"
                disabled={!editable}
                onClick={() => setEditing(modKey)}
                title={editable ? `Edit ${label} modifier` : undefined}
              >
                {stats[key] ?? (editable ? 'edit' : '')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Passives({
  stats,
  editable,
  editing,
  setEditing,
  commit,
}: {
  stats: CharacterStats
  editable: boolean
  editing: Editing
  setEditing: (key: Editing) => void
  commit: (key: StatKey, value: string) => void
}) {
  if (!editable && !PASSIVE_KEYS.some((key) => stats[key] != null)) return null
  return (
    <div className="passives">
      {PASSIVE_KEYS.map((key) => (
        <span key={key} className="passive">
          {PASSIVE_NAME[key]}{' '}
          <EditableValue
            label={PASSIVE_NAME[key]}
            value={stats[key]}
            editing={editing === key}
            editable={editable}
            className="is-inline"
            onEdit={() => setEditing(key)}
            onCommit={(value) => commit(key, value)}
            onCancel={() => setEditing(null)}
          />
        </span>
      ))}
    </div>
  )
}

export function StatInput({
  label,
  value,
  autoFocus = true,
  onCommit,
  onCancel,
}: {
  label: string
  value: number | null
  autoFocus?: boolean
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <input
      className="stat-input"
      type="number"
      defaultValue={value ?? ''}
      autoFocus={autoFocus}
      aria-label={label}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        if (event.key === 'Escape') onCancel()
      }}
    />
  )
}
