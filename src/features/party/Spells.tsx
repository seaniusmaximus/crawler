import { useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { MAX_DIE_COUNT } from '../../model/dice.ts'
import {
  castingMod,
  hasDamage,
  levelLabel,
  MAX_PER_DAY,
  MAX_SPELL_NAME,
  MAX_SPELL_NOTES,
  MAX_SPELLS,
  newSpell,
  normalizeSpellcasting,
  resolveLabel,
  saveDc,
  SPELL_RESOLVE_LABEL,
  spellAttackBonus,
  spellDamageFormula,
  type Spell,
  type Spellcasting,
  type SpellResolve,
} from '../../model/spells.ts'
import { ABILITY_KEYS, ABILITY_LABEL, displayedAbilityMod, formatSigned, type AbilityKey, type CharacterStats } from '../../model/stats.ts'
import { STATUS_EFFECTS, isStatusId, statusEffect, type StatusId } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import { DamageTypeField, DiePicker } from './DamageFields.tsx'
import { rollSpellAttack, rollSpellDamage } from './tokenRolls.ts'

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const RESOLVES: readonly SpellResolve[] = ['save', 'attack', 'auto']

/**
 * A stat block's spells, under its Spellcasting line (ability, save DC, spell
 * attack bonus). Save spells show the DC to call out; attack spells roll to
 * hit; either rolls damage or healing, and limited ones track uses per day.
 */
export function Spells({ player, stats, editable }: { player: Player; stats: CharacterStats; editable: boolean }) {
  const spells = player.spells ?? []
  const casting = normalizeSpellcasting(player.spellcasting)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** A spell just added: cancelling its first edit takes it away again. */
  const [freshId, setFreshId] = useState<string | null>(null)
  const [castingOpen, setCastingOpen] = useState(false)

  if (!editable && spells.length === 0) return null

  function save(next: Spell[]): void {
    useDungeonStore.getState().setPlayerSpells(player.id, next)
  }

  function add(): void {
    const spell = newSpell()
    save([...spells, spell])
    setEditingId(spell.id)
    setFreshId(spell.id)
  }

  function close(): void {
    setEditingId(null)
    setFreshId(null)
  }

  return (
    <div className="attacks spells">
      <span className="kicker">Spells</span>
      {spells.length > 0 || castingOpen ? (
        <CastingLine
          player={player}
          casting={casting}
          stats={stats}
          editable={editable}
          open={castingOpen}
          onToggle={() => setCastingOpen((open) => !open)}
        />
      ) : null}
      {spells.length === 0 ? <p className="attacks-empty">No spells yet</p> : null}
      {spells.map((spell) =>
        editable && editingId === spell.id ? (
          <SpellForm
            key={spell.id}
            spell={spell}
            casting={casting}
            stats={stats}
            onDone={(changed) => {
              save(spells.map((item) => (item.id === spell.id ? changed : item)))
              close()
            }}
            onCancel={() => {
              if (freshId === spell.id) save(spells.filter((item) => item.id !== spell.id))
              close()
            }}
            onRemove={() => {
              save(spells.filter((item) => item.id !== spell.id))
              close()
            }}
          />
        ) : (
          <SpellRow
            key={spell.id}
            player={player}
            spell={spell}
            casting={casting}
            stats={stats}
            editable={editable}
            onUse={(used) => save(spells.map((item) => (item.id === spell.id ? { ...item, used } : item)))}
            onEdit={() => {
              setEditingId(spell.id)
              setFreshId(null)
            }}
          />
        ),
      )}
      {editable && spells.length < MAX_SPELLS && !spells.some((item) => item.id === editingId) ? (
        <button type="button" className="dashed-btn attacks-add" onClick={add}>
          <Icon id="plus" size={15} />
          Add spell
        </button>
      ) : null}
    </div>
  )
}

/** "Spellcasting INT +3 · save DC 13 · +5 to hit", which opens its editor when clicked. */
function CastingLine({
  player,
  casting,
  stats,
  editable,
  open,
  onToggle,
}: {
  player: Player
  casting: Spellcasting
  stats: CharacterStats
  editable: boolean
  open: boolean
  onToggle: () => void
}) {
  const mod = displayedAbilityMod(stats, casting.ability)
  const text = (
    <>
      <span className="block-label">Spellcasting</span> {ABILITY_LABEL[casting.ability]}
      {mod == null ? ' (not set)' : ''} · save DC {saveDc(casting, stats)} · {formatSigned(spellAttackBonus(casting, stats))} to hit
    </>
  )
  const update = (fields: Partial<Spellcasting>) =>
    useDungeonStore.getState().setPlayerSpellcasting(player.id, { ...casting, ...fields })

  if (!editable) return <div className="casting-line">{text}</div>
  return (
    <>
      <button type="button" className={`trait-line casting-line${open ? ' is-open' : ''}`} aria-expanded={open} onClick={onToggle}>
        <span>{text}</span>
        <Icon id={open ? 'chevronUp' : 'pencil'} size={13} />
      </button>
      {open ? (
        <div className="trait-editor">
          <div className="attack-line">
            <label className="attack-select">
              <span className="kicker">Casts with</span>
              <AbilitySelect value={casting.ability} stats={stats} onChange={(ability) => update({ ability })} />
            </label>
            <Stepper
              className="is-compact"
              label="Proficiency"
              value={formatSigned(casting.bonus)}
              onDown={() => update({ bonus: casting.bonus - 1 })}
              onUp={() => update({ bonus: casting.bonus + 1 })}
            />
          </div>
          <p className="casting-hint">
            Save DC = 8 + {ABILITY_LABEL[casting.ability]} ({formatSigned(castingMod(casting, stats))}) + proficiency (
            {formatSigned(casting.bonus)}). Spell attacks add the same, without the 8.
          </p>
        </div>
      ) : null}
    </>
  )
}

function SpellRow({
  player,
  spell,
  casting,
  stats,
  editable,
  onUse,
  onEdit,
}: {
  player: Player
  spell: Spell
  casting: Spellcasting
  stats: CharacterStats
  editable: boolean
  onUse: (used: number) => void
  onEdit: () => void
}) {
  const against = resolveLabel(spell, casting, stats)
  const healing = spell.type.toLowerCase() === 'healing'
  const sub = [
    levelLabel(spell.level),
    spell.perDay == null ? 'at will' : `${spell.perDay}/day`,
    spell.resolve === 'save' && hasDamage(spell) ? (spell.onSave === 'half' ? 'half on save' : 'none on save') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const spent = spell.perDay != null && spell.used >= spell.perDay
  const condition = spell.condition ? statusEffect(spell.condition) : null

  return (
    <div className={`spell-row${spent ? ' is-spent' : ''}`}>
      <div className="attack-row">
        <span className="attack-copy">
          <span className="attack-name">{spell.name}</span>
          <span className="attack-sub">{sub}</span>
        </span>
        {spell.resolve === 'attack' ? (
          <button
            type="button"
            className="attack-roll"
            disabled={!editable}
            title={editable ? `Roll ${spell.name} spell attack` : 'Spell attack'}
            onClick={() => rollSpellAttack(player, spell)}
          >
            <Icon id="d20" size={13} />
            {formatSigned(spellAttackBonus(casting, stats))}
          </button>
        ) : against ? (
          <span className="spell-dc" title={`Targets make a ${ABILITY_LABEL[spell.save]} saving throw against DC ${saveDc(casting, stats)}`}>
            {against}
          </span>
        ) : null}
        {hasDamage(spell) ? (
          <button
            type="button"
            className={`attack-roll ${healing ? 'is-healing' : 'is-damage'}`}
            disabled={!editable}
            title={editable ? `Roll ${spell.name} ${healing ? 'healing' : 'damage'}${spell.type ? ` (${spell.type})` : ''}` : spell.type}
            onClick={() => rollSpellDamage(player, spell)}
          >
            {spellDamageFormula(spell)}
          </button>
        ) : null}
        {editable ? (
          <button type="button" className="icon-btn" aria-label={`Edit ${spell.name}`} title="Edit spell" onClick={onEdit}>
            <Icon id="pencil" size={14} />
          </button>
        ) : null}
      </div>
      {spell.perDay != null || condition || spell.notes || spell.type ? (
        <div className="spell-extra">
          {spell.perDay != null ? <UsePips spell={spell} editable={editable} onUse={onUse} /> : null}
          {spell.type && hasDamage(spell) ? <span className="spell-type">{spell.type}</span> : null}
          {condition ? (
            <span className="status-chip" style={{ color: condition.color } as CSSProperties}>
              {spell.resolve === 'save' ? `Fail: ${condition.label}` : condition.label}
            </span>
          ) : null}
          {spell.notes ? <span className="spell-notes">{spell.notes}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One pip per cast a day: filled while still available. Clicking an available
 * pip spends up to it; clicking a spent one gets it (and those after it) back.
 */
function UsePips({ spell, editable, onUse }: { spell: Spell; editable: boolean; onUse: (used: number) => void }) {
  const perDay = spell.perDay ?? 0
  const left = perDay - spell.used
  return (
    <span className="use-pips" aria-label={`${left} of ${perDay} casts left today`}>
      {Array.from({ length: perDay }, (_, index) => {
        // Pips spend from the right, so the filled ones are always the first `left`.
        const available = index < left
        return (
          <button
            key={index}
            type="button"
            className={`use-pip${available ? ' is-on' : ''}`}
            disabled={!editable}
            title={available ? 'Mark a cast used' : 'Get this cast back'}
            onClick={() => onUse(available ? perDay - index : perDay - index - 1)}
          />
        )
      })}
      <span className="use-count">
        {left}/{perDay}
      </span>
    </span>
  )
}

function SpellForm({
  spell,
  casting,
  stats,
  onDone,
  onCancel,
  onRemove,
}: {
  spell: Spell
  casting: Spellcasting
  stats: CharacterStats
  onDone: (spell: Spell) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(spell)
  const change = (fields: Partial<Spell>) => setDraft((now) => ({ ...now, ...fields }))
  const damage = hasDamage(draft)
  const against = resolveLabel(draft, casting, stats)

  function submit(event: FormEvent): void {
    event.preventDefault()
    onDone({
      ...draft,
      name: draft.name.trim() || spell.name,
      type: draft.type.trim(),
      notes: draft.notes.trim(),
      used: draft.perDay == null ? 0 : Math.min(draft.used, draft.perDay),
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
        maxLength={MAX_SPELL_NAME}
        autoFocus
        aria-label="Spell name"
        placeholder="Fireball"
        onFocus={(event) => event.target.select()}
        onChange={(event) => change({ name: event.target.value })}
      />

      <div className="attack-line">
        <label className="attack-select">
          <span className="kicker">Level</span>
          <select className="tileset-select" value={draft.level} onChange={(event) => change({ level: Number(event.target.value) })}>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {levelLabel(level)}
              </option>
            ))}
          </select>
        </label>
        <label className="attack-select">
          <span className="kicker">Uses</span>
          <select
            className="tileset-select"
            value={draft.perDay ?? ''}
            onChange={(event) => change({ perDay: event.target.value ? Number(event.target.value) : null })}
          >
            <option value="">At will</option>
            {Array.from({ length: MAX_PER_DAY }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}/day
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="segmented" role="radiogroup" aria-label="How it lands">
        {RESOLVES.map((resolve) => (
          <button
            key={resolve}
            type="button"
            role="radio"
            aria-checked={draft.resolve === resolve}
            className={`segment${draft.resolve === resolve ? ' is-on' : ''}`}
            onClick={() => change({ resolve })}
          >
            {SPELL_RESOLVE_LABEL[resolve]}
          </button>
        ))}
      </div>

      {draft.resolve === 'save' ? (
        <div className="attack-line">
          <label className="attack-select">
            <span className="kicker">Target saves with</span>
            <select className="tileset-select" value={draft.save} onChange={(event) => change({ save: event.target.value as AbilityKey })}>
              {ABILITY_KEYS.map((key) => (
                <option key={key} value={key}>
                  {ABILITY_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="attack-select">
            <span className="kicker">On a success</span>
            <select
              className="tileset-select"
              value={draft.onSave}
              disabled={!damage}
              onChange={(event) => change({ onSave: event.target.value === 'none' ? 'none' : 'half' })}
            >
              <option value="half">Half damage</option>
              <option value="none">No damage</option>
            </select>
          </label>
        </div>
      ) : null}

      <DiePicker faces={draft.faces} onPick={(faces) => change({ faces, count: Math.max(1, draft.count) })} dim={!damage} />

      <div className="attack-line">
        <Stepper
          className="is-compact"
          label="Dice"
          value={damage ? `${draft.count}` : 'None'}
          onDown={() => change({ count: draft.count - 1 })}
          onUp={() => change({ count: draft.count + 1 })}
          downDisabled={draft.count <= 0}
          upDisabled={draft.count >= MAX_DIE_COUNT}
        />
        <Stepper
          className="is-compact"
          label="Extra"
          value={formatSigned(draft.damageBonus)}
          onDown={() => change({ damageBonus: draft.damageBonus - 1 })}
          onUp={() => change({ damageBonus: draft.damageBonus + 1 })}
          downDisabled={!damage}
          upDisabled={!damage}
        />
      </div>

      {damage ? <DamageTypeField value={draft.type} extra={['healing']} onChange={(type) => change({ type })} /> : null}

      <div className="attack-line">
        <label className="attack-select">
          <span className="kicker">{draft.resolve === 'save' ? 'On a failed save' : 'Condition'}</span>
          <select
            className="tileset-select"
            value={draft.condition ?? ''}
            onChange={(event) => change({ condition: isStatusId(event.target.value) ? (event.target.value as StatusId) : null })}
          >
            <option value="">No condition</option>
            {STATUS_EFFECTS.map((effect) => (
              <option key={effect.id} value={effect.id}>
                {effect.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        className="stat-input"
        value={draft.notes}
        maxLength={MAX_SPELL_NOTES}
        aria-label="Notes"
        placeholder="Notes: 20-ft radius, concentration, 1 minute"
        onChange={(event) => change({ notes: event.target.value })}
      />

      <p className="attack-preview">
        <span>{against ?? 'No roll'}</span>
        <span>{damage ? `${spellDamageFormula(draft)} ${draft.type}` : draft.condition ? statusEffect(draft.condition).label : '—'}</span>
      </p>

      <div className="attack-form-actions">
        <button type="button" className="icon-btn is-danger" aria-label={`Remove ${spell.name}`} title="Remove spell" onClick={onRemove}>
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

function AbilitySelect({
  value,
  stats,
  onChange,
}: {
  value: AbilityKey
  stats: CharacterStats
  onChange: (ability: AbilityKey) => void
}) {
  return (
    <select className="tileset-select" value={value} onChange={(event) => onChange(event.target.value as AbilityKey)}>
      {ABILITY_KEYS.map((key) => {
        const mod = displayedAbilityMod(stats, key)
        return (
          <option key={key} value={key}>
            {ABILITY_LABEL[key]} {mod == null ? '(not set)' : formatSigned(mod)}
          </option>
        )
      })}
    </select>
  )
}
