import { Fragment, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
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
  spellAffects,
  spellArea,
  spellAreaEffects,
  spellAreaLabel,
  spellTrigger,
  spellAttackBonus,
  spellDamageFormula,
  type Spell,
  type SpellArea,
  type Spellcasting,
  type SpellResolve,
} from '../../model/spells.ts'
import {
  AREA_MAX_FEET,
  AREA_MIN_FEET,
  AREA_SHAPES,
  LINE_MAX_WIDTH,
  type AreaAffects,
  type AreaMark,
  type AreaShape,
  type AreaTrigger,
} from '../../model/marks.ts'
import { readSpellNotes, type NotesFields } from '../../model/spellNotes.ts'
import { playerSize } from '../../model/players.ts'
import { FEET_PER_TILE } from '../../model/scale.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  classCastingAbility,
  displayedAbilityMod,
  formatSigned,
  normalizeStats,
  proficiencyBonus,
  type AbilityKey,
  type CharacterStats,
} from '../../model/stats.ts'
import { CONDITION_EFFECTS, isStatusId, statusEffect, type StatusId } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import { INSTANT_AREA_MS, rollCast, type CastRoll } from '../areas/castRolls.ts'
import { DamageTypeField, DiePicker } from './DamageFields.tsx'
import { NotesToggle, RowNotes } from './RowNotes.tsx'
import { tokenShown } from './tokenInfo.ts'
import { rollSpellAttack, rollSpellDamage } from './tokenRolls.ts'

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * Lay a spell's area on the map. An emanation lands on the caster at once;
 * anything else takes up the area tool at the spell's shape and size, coming
 * out of the caster (a circle goes wherever it is clicked).
 */
function placeSpellArea(player: Player, spell: Spell, area: SpellArea): void {
  const editor = useEditorStore.getState()
  const effects = spellAreaEffects(spell, player.id, normalizeSpellcasting(player.spellcasting), normalizeStats(player.stats))
  const onCast = castRollFor(player, spell)
  // Over once it has gone off: no lingering damage, and nothing to last.
  const instant = spellTrigger(spell) == null && !effects.duration
  // The caster's floor, so the area lands where they are.
  if (editor.activeFloorId !== player.floorId) editor.setActiveFloor(player.floorId)
  if (area.shape === 'emanation') {
    const placed: AreaMark = {
      kind: 'area',
      id: crypto.randomUUID(),
      floorId: player.floorId,
      shape: 'emanation',
      feet: area.feet,
      width: area.width,
      origin: { x: player.x, y: player.y },
      angle: 0,
      playerId: player.id,
      tokenSize: playerSize(player),
      includeSelf: editor.aoeIncludeSelf,
      color: editor.aoeColor,
      side: player.kind === 'monster' ? 'foes' : 'party',
      ...effects,
    }
    useSessionStore.getState().placeArea(placed)
    if (onCast) rollCast(placed, onCast, shownOn(player.floorId))
    if (instant && placed.id) {
      const id = placed.id
      window.setTimeout(() => useSessionStore.getState().removeAreas([id]), INSTANT_AREA_MS)
    }
    return
  }
  editor.castArea({ playerId: player.id, name: spell.name, effects, onCast, instant, fromCaster: area.fromCaster === true }, area)
}

/**
 * What a spell does to the creatures in its area as it is cast: their saves and
 * its damage or healing. None for a spell that hurts only as creatures enter or
 * start their turn in it (that is the area's own doing), or one with nothing to roll.
 */
function castRollFor(player: Player, spell: Spell): CastRoll | undefined {
  if (spellTrigger(spell) != null) return undefined
  const stats = normalizeStats(player.stats)
  const casting = normalizeSpellcasting(player.spellcasting)
  const save = spell.resolve === 'save' ? { ability: spell.save, dc: saveDc(casting, stats), onSave: spell.onSave } : null
  const dice = hasDamage(spell)
    ? { count: spell.count, faces: spell.faces, bonus: spell.damageBonus, type: spell.type }
    : null
  if (!save && !dice) return undefined
  return { spell: spell.name, casterId: player.id, affects: spellAffects(spell), save, dice, condition: spell.condition }
}

/** The tokens on a floor this viewer can see: a spell cast here goes off only on those. */
function shownOn(floorId: string): Player[] {
  const dungeon = useDungeonStore.getState().dungeon
  const viewMode = useEditorStore.getState().viewMode
  const tokens = dungeon.players ?? []
  return tokens.filter((token) => token.floorId === floorId && tokenShown(token, dungeon.floors, tokens, viewMode))
}
const RESOLVES: readonly SpellResolve[] = ['save', 'attack', 'auto']

/**
 * A token's spells (character sheet or stat block), under its Spellcasting line (ability, save DC, spell
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
    // A character's first spell sets them casting as their class does, proficient at their level.
    if (player.kind === 'player' && spells.length === 0) {
      useDungeonStore.getState().setPlayerSpellcasting(player.id, {
        ability: classCastingAbility(stats.klass) ?? casting.ability,
        bonus: proficiencyBonus(stats.level),
      })
    }
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
  const spent = spell.perDay != null && spell.used >= spell.perDay
  const condition = spell.condition ? statusEffect(spell.condition) : null
  const area = spellArea(spell)
  const [notesOpen, setNotesOpen] = useState(false)
  // Everything about the spell but its notes fits on the one line under its name.
  const sub: ReactNode[] = [
    levelLabel(spell.level),
    spell.type && hasDamage(spell) ? <span key="type" className="spell-type">{spell.type}</span> : null,
    spell.perDay == null ? 'at will' : <UsePips key="uses" spell={spell} editable={editable} onUse={onUse} />,
    spell.resolve === 'save' && hasDamage(spell) ? (spell.onSave === 'half' ? 'half on save' : 'none on save') : null,
    area ? spellAreaLabel(area) : null,
    area && spellAffects(spell) !== 'all' ? `${spellAffects(spell)} only` : null,
    condition ? (
      <span key="condition" className="status-chip" style={{ color: condition.color } as CSSProperties}>
        {spell.resolve === 'save' ? `Fail: ${condition.label}` : condition.label}
      </span>
    ) : null,
  ].filter((part) => part != null)

  return (
    <div className={`spell-row${spent ? ' is-spent' : ''}`}>
      <div className="attack-row">
        <span className="attack-copy">
          <span className="attack-name">{spell.name}</span>
          <span className="attack-sub spell-sub">
            {sub.map((part, index) => (
              <Fragment key={index}>
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                {part}
              </Fragment>
            ))}
          </span>
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
        {area && editable ? (
          <button
            type="button"
            className="attack-roll spell-place"
            title={
              area.shape === 'emanation'
                ? `Place ${spell.name}'s ${spellAreaLabel(area)} around ${player.characterName || player.name}`
                : `Place ${spell.name}'s ${spellAreaLabel(area)} on the map: aim it, then click`
            }
            aria-label={`Place ${spell.name} on the map`}
            onClick={() => placeSpellArea(player, spell, area)}
          >
            <Icon id="aoe" size={14} />
          </button>
        ) : null}
        {spell.notes ? <NotesToggle open={notesOpen} name={spell.name} onToggle={() => setNotesOpen((open) => !open)} /> : null}
        {editable ? (
          <button type="button" className="icon-btn" aria-label={`Edit ${spell.name}`} title="Edit spell" onClick={onEdit}>
            <Icon id="pencil" size={14} />
          </button>
        ) : null}
      </div>
      {spell.notes && notesOpen ? <RowNotes text={spell.notes} /> : null}
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
  const [draft, setDraft] = useState<Spell>(() => ({
    ...spell,
    area: spellArea(spell),
    trigger: spellTrigger(spell),
    affects: spellAffects(spell),
  }))
  /** Fields set by hand: the notes leave them alone from then on. */
  const touched = useRef(new Set<string>())
  /** What the notes last filled in, so newer notes can change those fields again. */
  const filled = useRef<NotesFields>(readSpellNotes(spell.notes))
  /** The fields the notes filled in on their latest change, to say so under them. */
  const [fromNotes, setFromNotes] = useState<string[]>([])
  const change = (fields: Partial<Spell>) => {
    for (const key of Object.keys(fields)) touched.current.add(key)
    setDraft((now) => ({ ...now, ...fields }))
  }
  const damage = hasDamage(draft)
  const against = resolveLabel(draft, casting, stats)

  /**
   * New notes fill in whatever they now say, for every field not set by hand
   * that still holds a default or what earlier notes put there; a field earlier
   * notes filled that these no longer mention goes back to its default.
   */
  function changeNotes(notes: string): void {
    const read = readSpellNotes(notes)
    const before = filled.current
    const next: Spell = { ...draft, notes }
    const applied: string[] = []
    const keys = new Set([...Object.keys(read), ...Object.keys(before)]) as Set<keyof NotesFields>
    for (const key of keys) {
      if (touched.current.has(key)) continue
      const current = draft[key]
      const free = sameValue(current, before[key]) || sameValue(current, BLANK[key])
      if (!free) continue
      const value = key in read ? read[key] : BLANK[key]
      if (sameValue(current, value)) continue
      ;(next as unknown as Record<string, unknown>)[key] = value
      if (key in read) applied.push(NOTES_LABEL[key])
    }
    filled.current = read
    setFromNotes([...new Set(applied)])
    setDraft(next)
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    const notes = draft.notes.trim()
    onDone({
      ...draft,
      // Set for good now, so the spell does what the form showed.
      area: draft.area ?? null,
      trigger: draft.trigger ?? null,
      affects: draft.affects ?? 'all',
      name: draft.name.trim() || spell.name,
      type: draft.type.trim(),
      notes,
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

      <div className="segment-grid" role="radiogroup" aria-label="How it lands">
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
          {damage ? (
            <label className="attack-select">
              <span className="kicker">On a success</span>
              <select
                className="tileset-select"
                value={draft.onSave}
                onChange={(event) => change({ onSave: event.target.value === 'none' ? 'none' : 'half' })}
              >
                <option value="half">Half damage</option>
                <option value="none">No damage</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {damage ? <DiePicker faces={draft.faces} onPick={(faces) => change({ faces })} /> : null}

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
        {damage ? (
          <Stepper
            className="is-compact"
            label="Extra"
            value={formatSigned(draft.damageBonus)}
            onDown={() => change({ damageBonus: draft.damageBonus - 1 })}
            onUp={() => change({ damageBonus: draft.damageBonus + 1 })}
          />
        ) : null}
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
            {CONDITION_EFFECTS.map((effect) => (
              <option key={effect.id} value={effect.id}>
                {effect.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <AreaFields
        area={draft.area ?? null}
        trigger={draft.trigger ?? null}
        affects={draft.affects ?? 'all'}
        lingers={damage && draft.type.toLowerCase() !== 'healing'}
        onChange={change}
      />

      <textarea
        className="stat-input trait-text-input"
        value={draft.notes}
        maxLength={MAX_SPELL_NOTES}
        rows={3}
        aria-label="Notes"
        placeholder="Type or paste the spell's description: its save, damage, area and the rest fill in from it"
        onChange={(event) => changeNotes(event.target.value)}
      />
      {fromNotes.length ? <p className="notes-filled">Filled in from the notes: {fromNotes.join(', ')}</p> : null}

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

/** A spell's form, blank: what a field goes back to when notes that filled it stop saying so. */
const BLANK: NotesFields = { ...newSpell(), area: null, trigger: null, affects: 'all' }

/** How the line under the notes names each field they filled. */
const NOTES_LABEL: Record<keyof NotesFields, string> = {
  level: 'level',
  perDay: 'uses',
  resolve: 'how it lands',
  save: 'save',
  onSave: 'on a success',
  count: 'damage',
  faces: 'damage',
  damageBonus: 'damage',
  type: 'damage type',
  condition: 'condition',
  area: 'area',
  trigger: 'when its area hurts',
  affects: 'who it affects',
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

const AFFECTS_CHOICES: ReadonlyArray<{ id: AreaAffects; label: string; title: string }> = [
  { id: 'all', label: 'All creatures', title: 'Every creature in it, friend or foe' },
  { id: 'enemies', label: 'Enemies only', title: "Only the caster's enemies in it" },
  { id: 'allies', label: 'Allies only', title: "Only the caster's allies in it (healing, blessings)" },
]

const TRIGGER_CHOICES: ReadonlyArray<{ id: AreaTrigger | null; label: string; title: string }> = [
  { id: null, label: 'When cast', title: 'Only hurts when it is cast (Fireball)' },
  { id: 'enter', label: 'Entering', title: 'Also hurts a creature that enters it (once a turn)' },
  { id: 'start', label: 'Turn start', title: 'Also hurts a creature that starts its turn in it' },
  { id: 'both', label: 'Both', title: 'Hurts a creature entering it or starting its turn there' },
]

/**
 * The spell's area for the map: a shape (or none) and its size (a line its
 * width too); and, for a damaging spell, whether the area keeps hurting once
 * down, and whether it spares the caster's allies.
 */
function AreaFields({
  area,
  trigger,
  affects,
  lingers,
  onChange,
}: {
  area: SpellArea | null
  trigger: AreaTrigger | null
  affects: AreaAffects
  lingers: boolean
  onChange: (fields: Partial<Spell>) => void
}) {
  const update = (fields: Partial<SpellArea>) => area && onChange({ area: { ...area, ...fields } })
  return (
    <>
      <div className="attack-line">
        <label className="attack-select">
          <span className="kicker">Area</span>
          <select
            className="tileset-select"
            value={area?.shape ?? ''}
            onChange={(event) => {
              const shape = AREA_SHAPES.find((item) => item.id === event.target.value)?.id as AreaShape | undefined
              onChange({ area: shape ? { shape, feet: area?.feet ?? 20, width: area?.width ?? 5, ...(shape === 'square' && area?.fromCaster ? { fromCaster: true } : {}) } : null })
            }}
          >
            <option value="">No area</option>
            {AREA_SHAPES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {area ? (
          <Stepper
            className="is-compact"
            label={area.shape === 'circle' || area.shape === 'emanation' ? 'Radius' : area.shape === 'square' ? 'Side' : 'Length'}
            value={`${area.feet} ft`}
            onDown={() => update({ feet: Math.max(AREA_MIN_FEET, area.feet - FEET_PER_TILE) })}
            onUp={() => update({ feet: Math.min(AREA_MAX_FEET, area.feet + FEET_PER_TILE) })}
            downDisabled={area.feet <= AREA_MIN_FEET}
            upDisabled={area.feet >= AREA_MAX_FEET}
          />
        ) : null}
        {area?.shape === 'line' ? (
          <Stepper
            className="is-compact"
            label="Width"
            value={`${area.width} ft`}
            onDown={() => update({ width: Math.max(AREA_MIN_FEET, area.width - 2 * FEET_PER_TILE) })}
            onUp={() => update({ width: Math.min(LINE_MAX_WIDTH, area.width + 2 * FEET_PER_TILE) })}
            downDisabled={area.width <= AREA_MIN_FEET}
            upDisabled={area.width >= LINE_MAX_WIDTH}
          />
        ) : null}
      </div>
      {area?.shape === 'square' ? (
        <div className="segment-grid is-two" role="radiogroup" aria-label="Where the cube goes">
          {([false, true] as const).map((fromCaster) => (
            <button
              key={String(fromCaster)}
              type="button"
              role="radio"
              aria-checked={(area.fromCaster === true) === fromCaster}
              className={`segment${(area.fromCaster === true) === fromCaster ? ' is-on' : ''}`}
              title={fromCaster ? 'It comes out of the caster, on the side it is aimed (Thunderwave)' : 'It lands anywhere in range (Cloud of Daggers)'}
              onClick={() => onChange({ area: { ...area, fromCaster: fromCaster || undefined } })}
            >
              {fromCaster ? 'From caster' : 'At range'}
            </button>
          ))}
        </div>
      ) : null}
      {area && lingers ? (
        <div className="segment-grid is-four" role="radiogroup" aria-label="When its area hurts">
          {TRIGGER_CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={trigger === choice.id}
              className={`segment${trigger === choice.id ? ' is-on' : ''}`}
              title={choice.title}
              onClick={() => onChange({ trigger: choice.id })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
      {/* Who it takes in, whenever it has an area: a blast as cast, a zone after, or healing for friends. */}
      {area ? (
        <div className="segment-grid" role="radiogroup" aria-label="Who its area affects">
          {AFFECTS_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={affects === choice.id}
              className={`segment${affects === choice.id ? ' is-on' : ''}`}
              title={choice.title}
              onClick={() => onChange({ affects: choice.id })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
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
