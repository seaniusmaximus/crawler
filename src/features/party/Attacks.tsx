import { useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  attackAbilityMod,
  attackToHit,
  bonusBreakdown,
  damageFormula,
  MAX_ATTACK_BONUS,
  MAX_ATTACK_NAME,
  MAX_ATTACKS,
  newAttack,
  type Attack,
} from '../../model/attacks.ts'
import { DamageTypeField, DiePicker } from './DamageFields.tsx'
import { MAX_DIE_COUNT } from '../../model/dice.ts'
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  displayedAbilityMod,
  formatSigned,
  type AbilityKey,
  type CharacterStats,
} from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import { rollAttack, rollDamage } from './tokenRolls.ts'

/**
 * A stat block's attacks. Each rolls to hit and for damage into the shared dice
 * log; whoever may edit the block adds, changes and removes them.
 */
export function Attacks({ player, stats, editable }: { player: Player; stats: CharacterStats; editable: boolean }) {
  const attacks = player.attacks ?? []
  const [editingId, setEditingId] = useState<string | null>(null)
  /** An attack just added: cancelling its first edit takes it away again. */
  const [freshId, setFreshId] = useState<string | null>(null)

  if (!editable && attacks.length === 0) return null

  function save(next: Attack[]): void {
    useDungeonStore.getState().setPlayerAttacks(player.id, next)
  }

  function add(): void {
    const attack = newAttack()
    save([...attacks, attack])
    setEditingId(attack.id)
    setFreshId(attack.id)
  }

  function close(): void {
    setEditingId(null)
    setFreshId(null)
  }

  return (
    <div className="attacks">
      <span className="kicker">Attacks</span>
      {attacks.length === 0 ? <p className="attacks-empty">No attacks yet</p> : null}
      {attacks.map((attack) =>
        editable && editingId === attack.id ? (
          <AttackForm
            key={attack.id}
            attack={attack}
            stats={stats}
            onDone={(changed) => {
              save(attacks.map((item) => (item.id === attack.id ? changed : item)))
              close()
            }}
            onCancel={() => {
              if (freshId === attack.id) save(attacks.filter((item) => item.id !== attack.id))
              close()
            }}
            onRemove={() => {
              save(attacks.filter((item) => item.id !== attack.id))
              close()
            }}
          />
        ) : (
          <AttackRow
            key={attack.id}
            player={player}
            attack={attack}
            stats={stats}
            editable={editable}
            onEdit={() => {
              setEditingId(attack.id)
              setFreshId(null)
            }}
          />
        ),
      )}
      {editable && attacks.length < MAX_ATTACKS && !attacks.some((item) => item.id === editingId) ? (
        <button type="button" className="dashed-btn attacks-add" onClick={add}>
          <Icon id="plus" size={15} />
          Add attack
        </button>
      ) : null}
    </div>
  )
}

function AttackRow({
  player,
  attack,
  stats,
  editable,
  onEdit,
}: {
  player: Player
  attack: Attack
  stats: CharacterStats
  editable: boolean
  onEdit: () => void
}) {
  const toHit = attackToHit(attack, stats)
  const formula = damageFormula(attack, stats)
  const hitWhy = `d20 ${bonusBreakdown(attack, attack.hitBonus, stats)}`
  const damageWhy = `${attack.count}d${attack.faces} ${bonusBreakdown(attack, attack.damageBonus, stats)}`
  const sub = [attack.ability ? ABILITY_LABEL[attack.ability] : '', attack.type].filter(Boolean).join(' · ')

  return (
    <div className="attack-row">
      <span className="attack-copy">
        <span className="attack-name">{attack.name}</span>
        {sub ? <span className="attack-sub">{sub}</span> : null}
      </span>
      <button
        type="button"
        className="attack-roll"
        disabled={!editable}
        title={editable ? `Roll ${attack.name} to hit: ${hitWhy}` : hitWhy}
        onClick={() => rollAttack(player, attack)}
      >
        <Icon id="d20" size={13} />
        {formatSigned(toHit)}
      </button>
      <button
        type="button"
        className="attack-roll is-damage"
        disabled={!editable}
        title={editable ? `Roll ${attack.name} damage: ${damageWhy}` : damageWhy}
        onClick={() => rollDamage(player, attack)}
      >
        {formula}
      </button>
      {editable ? (
        <button type="button" className="icon-btn" aria-label={`Edit ${attack.name}`} title="Edit attack" onClick={onEdit}>
          <Icon id="pencil" size={14} />
        </button>
      ) : null}
    </div>
  )
}

function AttackForm({
  attack,
  stats,
  onDone,
  onCancel,
  onRemove,
}: {
  attack: Attack
  stats: CharacterStats
  onDone: (attack: Attack) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(attack)
  const change = (fields: Partial<Attack>) => setDraft((now) => ({ ...now, ...fields }))
  const mod = attackAbilityMod(draft, stats)

  function submit(event: FormEvent): void {
    event.preventDefault()
    onDone({ ...draft, name: draft.name.trim() || attack.name, type: draft.type.trim() })
  }

  // The map's shortcuts stay out of the way while typing.
  function keys(event: KeyboardEvent<HTMLElement>): void {
    event.stopPropagation()
    if (event.key === 'Escape') onCancel()
  }

  return (
    <form className="attack-form" onSubmit={submit} onKeyDown={keys}>
      <input
        className="stat-input attack-name-input"
        value={draft.name}
        maxLength={MAX_ATTACK_NAME}
        autoFocus
        aria-label="Attack name"
        placeholder="Claw"
        onFocus={(event) => event.target.select()}
        onChange={(event) => change({ name: event.target.value })}
      />

      <div className="attack-line">
        <label className="attack-select">
          <span className="kicker">Bonus from</span>
          <select
            className="tileset-select"
            value={draft.ability ?? ''}
            onChange={(event) => change({ ability: (event.target.value || null) as AbilityKey | null })}
          >
            {ABILITY_KEYS.map((key) => {
              const value = displayedAbilityMod(stats, key)
              return (
                <option key={key} value={key}>
                  {ABILITY_LABEL[key]} {value == null ? '(not set)' : formatSigned(value)}
                </option>
              )
            })}
            <option value="">None</option>
          </select>
        </label>
        <Stepper
          className="is-compact"
          label="Extra hit"
          value={formatSigned(draft.hitBonus)}
          onDown={() => change({ hitBonus: draft.hitBonus - 1 })}
          onUp={() => change({ hitBonus: draft.hitBonus + 1 })}
          downDisabled={draft.hitBonus <= -MAX_ATTACK_BONUS}
          upDisabled={draft.hitBonus >= MAX_ATTACK_BONUS}
        />
      </div>

      <DiePicker faces={draft.faces} onPick={(faces) => change({ faces })} />

      <div className="attack-line">
        <Stepper
          className="is-compact"
          label="Dice"
          value={`${draft.count}`}
          onDown={() => change({ count: draft.count - 1 })}
          onUp={() => change({ count: draft.count + 1 })}
          downDisabled={draft.count <= 1}
          upDisabled={draft.count >= MAX_DIE_COUNT}
        />
        <Stepper
          className="is-compact"
          label="Extra dmg"
          value={formatSigned(draft.damageBonus)}
          onDown={() => change({ damageBonus: draft.damageBonus - 1 })}
          onUp={() => change({ damageBonus: draft.damageBonus + 1 })}
          downDisabled={draft.damageBonus <= -MAX_ATTACK_BONUS}
          upDisabled={draft.damageBonus >= MAX_ATTACK_BONUS}
        />
      </div>

      <DamageTypeField value={draft.type} onChange={(type) => change({ type })} />

      <p className="attack-preview">
        <span>
          <Icon id="d20" size={12} /> {formatSigned(mod + draft.hitBonus)} to hit
        </span>
        <span>
          {damageFormula(draft, stats)} {draft.type}
        </span>
      </p>

      <div className="attack-form-actions">
        <button type="button" className="icon-btn is-danger" aria-label={`Remove ${attack.name}`} title="Remove attack" onClick={onRemove}>
          <Icon id="trash" size={15} />
        </button>
        <button type="button" className="chip-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="chip-btn is-primary">
          Done
        </button>
      </div>
    </form>
  )
}
