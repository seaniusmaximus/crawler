import { useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  attackAbilityMod,
  attackToHit,
  bonusBreakdown,
  damageFormula,
  MAX_ATTACK_BONUS,
  MAX_ATTACK_NAME,
  MAX_ATTACKS,
  MAX_EXTRA_DAMAGE,
  MAX_SAVE_DC,
  MAX_SAVE_NOTES,
  MIN_SAVE_DC,
  newAttack,
  newAttackSave,
  newDamagePart,
  partFormula,
  saveLabel,
  type Attack,
  type AttackSave,
  type DamagePart,
} from '../../model/attacks.ts'
import { DamageTypeField, DiePicker } from './DamageFields.tsx'
import { NotesToggle, RowNotes } from './RowNotes.tsx'
import { MAX_DIE_COUNT } from '../../model/dice.ts'
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  displayedAbilityMod,
  formatSigned,
  proficiencyBonus,
  type AbilityKey,
  type CharacterStats,
} from '../../model/stats.ts'
import { CONDITION_EFFECTS, isStatusId, statusEffect, type StatusId } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import { rollAttack, rollDamage, rollSaveDamage } from './tokenRolls.ts'

/**
 * A token's attacks, on a character sheet or stat block. Each rolls to hit and for damage into the shared dice
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
    // A character's attacks start proficient at their level; a creature's start at +0 over the ability.
    const attack = player.kind === 'player' ? { ...newAttack(), hitBonus: proficiencyBonus(stats.level) } : newAttack()
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

/** Every damage the hit deals, as written and as it reads in a tooltip: "1d8+3 piercing, 2d6 poison". */
function damageSummary(attack: Attack, stats: CharacterStats): { label: string; detail: string } {
  const parts = [
    { formula: damageFormula(attack, stats), type: attack.type },
    ...attack.extra.map((part) => ({ formula: partFormula(part), type: part.type })),
  ]
  return {
    label: parts.map((part) => part.formula).join(' + '),
    detail: parts.map((part) => [part.formula, part.type].filter(Boolean).join(' ')).join(', '),
  }
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
  const damage = damageSummary(attack, stats)
  const hitWhy = `d20 ${bonusBreakdown(attack, attack.hitBonus, stats)}`
  const damageWhy = [
    `${attack.count}d${attack.faces} ${bonusBreakdown(attack, attack.damageBonus, stats)}${attack.type ? ` ${attack.type}` : ''}`,
    ...attack.extra.map((part) => `${partFormula(part)}${part.type ? ` ${part.type}` : ''}`),
  ].join(', ')
  const types = [attack.type, ...attack.extra.map((part) => part.type)].filter(Boolean).join(' + ')
  const sub = [attack.ability ? ABILITY_LABEL[attack.ability] : '', types].filter(Boolean).join(' · ')
  const notes = attack.save?.notes ?? ''
  const [notesOpen, setNotesOpen] = useState(false)

  const row = (
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
        {damage.label}
      </button>
      {notes ? <NotesToggle open={notesOpen} name={attack.name} onToggle={() => setNotesOpen((open) => !open)} /> : null}
      {editable ? (
        <button type="button" className="icon-btn" aria-label={`Edit ${attack.name}`} title="Edit attack" onClick={onEdit}>
          <Icon id="pencil" size={14} />
        </button>
      ) : null}
    </div>
  )

  if (!attack.save) return row
  return (
    <div className="spell-row">
      {row}
      <SaveLine player={player} attack={attack} save={attack.save} editable={editable} />
      {notes && notesOpen ? <RowNotes text={notes} /> : null}
    </div>
  )
}

/** Under an attack: the save its hit forces, with that save's damage to roll and what failing it does. */
function SaveLine({ player, attack, save, editable }: { player: Player; attack: Attack; save: AttackSave; editable: boolean }) {
  const condition = save.condition ? statusEffect(save.condition) : null
  const damage = save.count > 0
  const damageText = `${partFormula(save)}${save.type ? ` ${save.type}` : ''}`

  return (
    <div className="spell-extra attack-save-line">
      <span className="kicker">On hit</span>
      <span className="spell-dc" title={`The target makes a ${ABILITY_LABEL[save.ability]} saving throw against DC ${save.dc}`}>
        {saveLabel(save)}
      </span>
      {damage ? (
        <button
          type="button"
          className="attack-roll is-damage"
          disabled={!editable}
          title={editable ? `Roll ${attack.name} save damage: ${damageText}` : damageText}
          onClick={() => rollSaveDamage(player, attack)}
        >
          {partFormula(save)}
        </button>
      ) : null}
      {damage && save.type ? <span className="spell-type">{save.type}</span> : null}
      {damage ? <span>{save.onSave === 'half' ? 'half on save' : 'none on save'}</span> : null}
      {condition ? (
        <span className="status-chip" style={{ color: condition.color } as CSSProperties}>
          Fail: {condition.label}
        </span>
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
  const changePart = (id: string, fields: Partial<DamagePart>) =>
    setDraft((now) => ({ ...now, extra: now.extra.map((part) => (part.id === id ? { ...part, ...fields } : part)) }))
  const changeSave = (fields: Partial<AttackSave>) =>
    setDraft((now) => (now.save ? { ...now, save: { ...now.save, ...fields } } : now))
  const mod = attackAbilityMod(draft, stats)
  const saveDamage = draft.save != null && draft.save.count > 0

  function submit(event: FormEvent): void {
    event.preventDefault()
    onDone({
      ...draft,
      name: draft.name.trim() || attack.name,
      type: draft.type.trim(),
      extra: draft.extra.map((part) => ({ ...part, type: part.type.trim() })),
      save: draft.save ? { ...draft.save, type: draft.save.type.trim(), notes: draft.save.notes.trim() } : null,
    })
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

      <DiceFields
        count={draft.count}
        faces={draft.faces}
        bonus={draft.damageBonus}
        onChange={({ bonus, ...fields }) => change(bonus == null ? fields : { ...fields, damageBonus: bonus })}
      />

      <DamageTypeField value={draft.type} onChange={(type) => change({ type })} />

      {draft.extra.map((part) => (
        <FormSection
          key={part.id}
          title="Plus damage"
          removeLabel="Remove this damage"
          onRemove={() => change({ extra: draft.extra.filter((item) => item.id !== part.id) })}
        >
          <DiceFields
            count={part.count}
            faces={part.faces}
            bonus={part.bonus}
            onChange={(fields) => changePart(part.id, fields)}
          />
          <DamageTypeField value={part.type} onChange={(type) => changePart(part.id, { type })} />
        </FormSection>
      ))}

      {draft.save ? (
        <FormSection title="Saving throw on hit" removeLabel="Remove saving throw" onRemove={() => change({ save: null })}>
          <div className="attack-line">
            <label className="attack-select">
              <span className="kicker">Target saves with</span>
              <select
                className="tileset-select"
                value={draft.save.ability}
                onChange={(event) => changeSave({ ability: event.target.value as AbilityKey })}
              >
                {ABILITY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {ABILITY_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
            <Stepper
              className="is-compact"
              label="DC"
              value={`${draft.save.dc}`}
              onDown={() => changeSave({ dc: draft.save!.dc - 1 })}
              onUp={() => changeSave({ dc: draft.save!.dc + 1 })}
              downDisabled={draft.save.dc <= MIN_SAVE_DC}
              upDisabled={draft.save.dc >= MAX_SAVE_DC}
            />
          </div>

          <DiceFields
            count={draft.save.count}
            faces={draft.save.faces}
            bonus={draft.save.bonus}
            minCount={0}
            onChange={(fields) => changeSave(fields)}
          />

          {saveDamage ? <DamageTypeField value={draft.save.type} onChange={(type) => changeSave({ type })} /> : null}

          <div className="attack-line">
            {saveDamage ? (
              <label className="attack-select">
                <span className="kicker">On a success</span>
                <select
                  className="tileset-select"
                  value={draft.save.onSave}
                  onChange={(event) => changeSave({ onSave: event.target.value === 'none' ? 'none' : 'half' })}
                >
                  <option value="half">Half damage</option>
                  <option value="none">No damage</option>
                </select>
              </label>
            ) : null}
            <label className="attack-select">
              <span className="kicker">On a failure</span>
              <select
                className="tileset-select"
                value={draft.save.condition ?? ''}
                onChange={(event) =>
                  changeSave({ condition: isStatusId(event.target.value) ? (event.target.value as StatusId) : null })
                }
              >
                <option value="">No condition</option>
                {CONDITION_EFFECTS.map((effect) => (
                  <option key={effect.id} value={effect.id}>
                    {effect.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <textarea
            className="stat-input trait-text-input"
            value={draft.save.notes}
            maxLength={MAX_SAVE_NOTES}
            rows={3}
            aria-label="Save effect notes"
            placeholder="Other effects: pushed 10 ft, can't regain HP"
            onChange={(event) => changeSave({ notes: event.target.value })}
          />
        </FormSection>
      ) : null}

      {draft.extra.length < MAX_EXTRA_DAMAGE || !draft.save ? (
        <div className="attack-line">
          {draft.extra.length < MAX_EXTRA_DAMAGE ? (
            <button
              type="button"
              className="dashed-btn attacks-add"
              onClick={() => change({ extra: [...draft.extra, newDamagePart()] })}
            >
              <Icon id="plus" size={15} />
              Damage type
            </button>
          ) : null}
          {!draft.save ? (
            <button type="button" className="dashed-btn attacks-add" onClick={() => change({ save: newAttackSave() })}>
              <Icon id="plus" size={15} />
              Saving throw
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="attack-preview">
        <span>
          <Icon id="d20" size={12} /> {formatSigned(mod + draft.hitBonus)} to hit
        </span>
        <span>{damageSummary(draft, stats).detail}</span>
      </p>
      {draft.save ? (
        <p className="attack-preview">
          <span>{saveLabel(draft.save)}</span>
          <span>
            {[
              saveDamage ? `${partFormula(draft.save)} ${draft.save.type}`.trim() : '',
              draft.save.condition ? statusEffect(draft.save.condition).label : '',
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </span>
        </p>
      ) : null}

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

/** A removable part of the attack form: an extra damage type, or the save. */
function FormSection({
  title,
  removeLabel,
  onRemove,
  children,
}: {
  title: string
  removeLabel: string
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div className="attack-part">
      <div className="attack-part-head">
        <span className="kicker">{title}</span>
        <button type="button" className="icon-btn is-danger" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          <Icon id="trash" size={14} />
        </button>
      </div>
      {children}
    </div>
  )
}

/** Damage dice: the die, how many, and what's added. A `minCount` of 0 lets the dice be None. */
function DiceFields({
  count,
  faces,
  bonus,
  minCount = 1,
  onChange,
}: {
  count: number
  faces: number
  bonus: number
  minCount?: number
  onChange: (fields: { count?: number; faces?: number; bonus?: number }) => void
}) {
  const none = count === 0
  return (
    <>
      {none ? null : <DiePicker faces={faces} onPick={(picked) => onChange({ faces: picked })} />}
      <div className="attack-line">
        <Stepper
          className="is-compact"
          label="Dice"
          value={none ? 'None' : `${count}`}
          onDown={() => onChange({ count: count - 1 })}
          onUp={() => onChange({ count: count + 1 })}
          downDisabled={count <= minCount}
          upDisabled={count >= MAX_DIE_COUNT}
        />
        {none ? null : (
          <Stepper
            className="is-compact"
            label="Extra dmg"
            value={formatSigned(bonus)}
            onDown={() => onChange({ bonus: bonus - 1 })}
            onUp={() => onChange({ bonus: bonus + 1 })}
            downDisabled={bonus <= -MAX_ATTACK_BONUS}
            upDisabled={bonus >= MAX_ATTACK_BONUS}
          />
        )}
      </div>
    </>
  )
}
