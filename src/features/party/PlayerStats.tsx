import { useState } from 'react'
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  ABILITY_MOD_KEY,
  PASSIVE_KEYS,
  PASSIVE_LABEL,
  displayedAbilityMod,
  formatAbility,
  formatSigned,
  hpBarColor,
  hpRatio,
  normalizeStats,
  type AbilityKey,
  type StatKey,
} from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'

export function PlayerStats({ player }: { player: Player }) {
  const stats = normalizeStats(player.stats)
  const role = useSessionStore((state) => state.role)
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  const editable = role !== 'guest' || myPlayerId === player.id
  const [editing, setEditing] = useState<StatKey | null>(null)

  function setStat(key: StatKey, value: string): void {
    useDungeonStore.getState().setPlayerStat(player.id, key, value === '' ? null : value)
  }

  const line = `${stats.klass ?? ''}${stats.klass && stats.level != null ? ' ' : ''}${
    stats.level != null ? `Lv ${stats.level}` : ''
  }`.trim()

  return (
    <div className="player-stats">
      <div className="player-stats-hero">
        <HpStat
          playerId={player.id}
          hp={stats.hp}
          hpMax={stats.hpMax}
          hpTemp={stats.hpTemp}
          editing={editing === 'hp'}
          editable={editable}
          onEdit={() => setEditing('hp')}
          onDone={() => setEditing(null)}
        />
        <HeroStat
          label="AC"
          value={stats.ac}
          editing={editing === 'ac'}
          editable={editable}
          onEdit={() => setEditing('ac')}
          onCommit={(value) => {
            setStat('ac', value)
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
        <HeroStat
          label="Init"
          value={player.initiativeRoll}
          title={
            player.initiativeRoll != null
              ? `Initiative roll ${player.initiativeRoll}${
                  stats.initiative != null ? ` (${formatSigned(stats.initiative)})` : ''
                }`
              : 'Initiative roll — shown after they roll'
          }
          display={
            player.initiativeRoll != null
              ? `${player.initiativeRoll}`
              : stats.initiative == null
                ? '–'
                : formatSigned(stats.initiative)
          }
          editing={editing === 'initiative'}
          editable={editable}
          onEdit={() => setEditing('initiative')}
          onCommit={(value) => {
            useDungeonStore
              .getState()
              .setInitiativeRoll(player.id, value === '' ? null : Number(value))
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      </div>

      {(PASSIVE_KEYS.some((key) => stats[key] != null) || editable) && (
        <div className="player-stats-passives">
          {PASSIVE_KEYS.map((key) => (
            <HeroStat
              key={key}
              label={PASSIVE_LABEL[key]}
              value={stats[key]}
              compact
              editing={editing === key}
              editable={editable}
              onEdit={() => setEditing(key)}
              onCommit={(value) => {
                setStat(key, value)
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          ))}
        </div>
      )}

      <div className="player-stats-sub">
        {line || editing === 'klass' || editing === 'level' ? (
          <p className="player-stats-line">
            {editable && editing === 'klass' ? (
              <input
                className="player-stat-input is-wide"
                defaultValue={stats.klass ?? ''}
                autoFocus
                aria-label="Class"
                placeholder="Class"
                onBlur={(event) => {
                  setStat('klass', event.target.value)
                  setEditing(null)
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                  if (event.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <button
                type="button"
                className="player-stat is-mini"
                disabled={!editable}
                onClick={() => editable && setEditing('klass')}
                title="Class"
              >
                {stats.klass || (editable ? 'Class' : '')}
              </button>
            )}
            {editable && editing === 'level' ? (
              <StatInput
                label="Level"
                value={stats.level}
                onCommit={(value) => {
                  setStat('level', value)
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <button
                type="button"
                className="player-stat is-mini"
                disabled={!editable}
                onClick={() => editable && setEditing('level')}
                title="Level"
              >
                {stats.level != null ? `Lv ${stats.level}` : editable ? 'Lv' : ''}
              </button>
            )}
          </p>
        ) : editable ? (
          <p className="player-stats-line">
            <button type="button" className="player-stat is-mini is-empty" onClick={() => setEditing('klass')}>
              Add class
            </button>
          </p>
        ) : null}

        {(ABILITY_KEYS.some((key) => displayedAbilityMod(stats, key) != null) || editable) && (
          <p className="player-stats-line">
            {ABILITY_KEYS.map((key) => (
              <AbilityStat
                key={key}
                ability={key}
                stats={stats}
                editing={editing === ABILITY_MOD_KEY[key]}
                editable={editable}
                onEdit={() => setEditing(ABILITY_MOD_KEY[key])}
                onCommit={(value) => {
                  setStat(ABILITY_MOD_KEY[key], value)
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            ))}
          </p>
        )}

        <p className="player-stats-line">
          <MiniStat
            label="Spd"
            value={stats.speed}
            display={stats.speed != null ? `${stats.speed} ft` : '–'}
            editing={editing === 'speed'}
            editable={editable}
            onEdit={() => setEditing('speed')}
            onCommit={(value) => {
              setStat('speed', value)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        </p>
      </div>
    </div>
  )
}

function HeroStat({
  label,
  value,
  display,
  title,
  compact,
  editing,
  editable,
  onEdit,
  onCommit,
  onCancel,
}: {
  label: string
  value: number | null
  display?: string
  title?: string
  compact?: boolean
  editing: boolean
  editable: boolean
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
      className={`player-stat is-hero${compact ? ' is-compact' : ''}${value == null ? ' is-empty' : ''}`}
      disabled={!editable}
      onClick={() => editable && onEdit()}
      title={title ?? (editable ? `Edit ${label}` : label)}
    >
      <span className="player-stat-kicker">{label}</span>
      <span className="player-stat-value">{display ?? (value ?? '–')}</span>
    </button>
  )
}

function MiniStat({
  label,
  value,
  display,
  editing,
  editable,
  onEdit,
  onCommit,
  onCancel,
}: {
  label: string
  value: number | null
  display?: string
  editing: boolean
  editable: boolean
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
      className={`player-stat is-mini${value == null ? ' is-empty' : ''}`}
      disabled={!editable}
      onClick={() => editable && onEdit()}
      title={editable ? `Edit ${label}` : label}
    >
      {label} {display ?? (value == null ? '–' : value)}
    </button>
  )
}

function AbilityStat({
  ability,
  stats,
  editing,
  editable,
  onEdit,
  onCommit,
  onCancel,
}: {
  ability: AbilityKey
  stats: ReturnType<typeof normalizeStats>
  editing: boolean
  editable: boolean
  onEdit: () => void
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const label = ABILITY_LABEL[ability]
  const score = stats[ability]
  const mod = displayedAbilityMod(stats, ability)
  if (editable && editing) {
    return <StatInput label={label} value={mod} onCommit={onCommit} onCancel={onCancel} />
  }
  return (
    <button
      type="button"
      className={`player-stat is-mini${mod == null ? ' is-empty' : ''}`}
      disabled={!editable}
      onClick={() => editable && onEdit()}
      title={score == null ? label : formatAbility(score)}
    >
      {label} {mod == null ? '–' : formatSigned(mod)}
    </button>
  )
}

function HpStat({
  playerId,
  hp,
  hpMax,
  hpTemp,
  editing,
  editable,
  onEdit,
  onDone,
}: {
  playerId: string
  hp: number | null
  hpMax: number | null
  hpTemp: number | null
  editing: boolean
  editable: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const ratio = hpRatio(hp, hpMax)
  const fill = ratio == null ? 0 : ratio
  const color = ratio == null ? '#5c5f6b' : hpBarColor(ratio)
  const temp = hpTemp != null && hpTemp > 0 ? hpTemp : 0

  if (editable && editing) {
    return (
      <span className="player-hp is-editing">
        <StatInput
          label="HP"
          value={hp}
          onCommit={(value) => useDungeonStore.getState().setPlayerStat(playerId, 'hp', value)}
          onCancel={onDone}
        />
        <span aria-hidden="true">/</span>
        <StatInput
          label="Max HP"
          value={hpMax}
          onCommit={(value) => {
            useDungeonStore.getState().setPlayerStat(playerId, 'hpMax', value)
            onDone()
          }}
          onCancel={onDone}
        />
      </span>
    )
  }

  return (
    <button
      type="button"
      className={`player-hp${hp == null && hpMax == null ? ' is-empty' : ''}`}
      disabled={!editable}
      onClick={() => editable && onEdit()}
      title={editable ? 'Edit hit points' : 'Hit points'}
    >
      <span className="player-hp-bar" aria-hidden="true">
        <span className="player-hp-fill" style={{ width: `${fill * 100}%`, background: color }} />
      </span>
      <span className="player-hp-readout">
        <span className="player-stat-kicker">HP</span>
        <span className="player-stat-value">
          {hp ?? '–'}
          <small>/{hpMax ?? '–'}</small>
          {temp > 0 ? <small className="player-hp-temp"> +{temp}</small> : null}
        </span>
      </span>
    </button>
  )
}

function StatInput({
  label,
  value,
  onCommit,
  onCancel,
}: {
  label: string
  value: number | null
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <input
      className="player-stat-input"
      type="number"
      defaultValue={value ?? ''}
      autoFocus
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
