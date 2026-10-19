import { DAMAGE_FACES } from './attacks.ts'
import { MAX_DIE_COUNT, formatModifier, isDieFace } from './dice.ts'
import {
  ABILITY_KEYS,
  ABILITY_LABEL,
  classCastingAbility,
  displayedAbilityMod,
  proficiencyBonus,
  type AbilityKey,
  type CharacterStats,
} from './stats.ts'
import {
  AREA_SHAPES,
  clampAreaFeet,
  clampLineWidth,
  type AreaAffects,
  type AreaDamage,
  type AreaDuration,
  type AreaMark,
  type AreaShape,
  type AreaTrigger,
} from './marks.ts'
import { guessAffects, guessLasting, guessSpellArea, guessTrigger } from './spellNotes.ts'

export { guessSpellArea } from './spellNotes.ts'
import { isStatusId, type StatusId } from './status.ts'

/**
 * How a creature casts, shared by all its spells, as a stat block's
 * Spellcasting trait has it: one ability, plus a bonus (its proficiency, and
 * anything else). Save DC is 8 + modifier + bonus; spell attacks add modifier + bonus.
 */
export interface Spellcasting {
  ability: AbilityKey
  bonus: number
}

/**
 * How a spell lands: the target saves against the caster's DC, the caster
 * makes a spell attack, or it simply happens (Misty Step, Shield).
 */
export type SpellResolve = 'save' | 'attack' | 'auto'

/** What a successful save does to a save spell's damage. */
export type OnSave = 'half' | 'none'

export interface Spell {
  id: string
  name: string
  /** 0 is a cantrip. */
  level: number
  resolve: SpellResolve
  /** The ability the target saves with; only for save spells. */
  save: AbilityKey
  onSave: OnSave
  /** Damage dice; a count of 0 means the spell does no damage. */
  count: number
  faces: number
  /** Added to damage, as some spells add the caster's modifier. */
  damageBonus: number
  /** A damage type (see damage.ts), "healing", or the DM's own words; empty for none. */
  type: string
  /** A condition the spell imposes (on a failed save, for save spells); null for none. */
  condition: StatusId | null
  /** Anything else worth a glance: area, duration, concentration. */
  notes: string
  /** Casts a day; null is at will. */
  perDay: number | null
  /** Casts spent today, out of `perDay`. */
  used: number
  /**
   * The area it fills, for laying it on the map. Null means it has none; missing
   * means nobody said, so it is read from the notes (see `spellArea`).
   */
  area?: SpellArea | null
  /**
   * What its area does once down, between casts: hurts whoever enters it or
   * starts a turn there (or both). Null for a spell that only hurts when cast;
   * missing means nobody said, so it is read from the notes.
   */
  trigger?: AreaTrigger | null
  /** Who its area hurts on the map: everyone, or only enemies; missing is read from the notes. */
  affects?: AreaAffects
}

/** A spell's area of effect: the area tool's shape and size. */
export interface SpellArea {
  shape: AreaShape
  /** Radius of a circle or emanation, length of a cone or line, side of a cube. */
  feet: number
  /** How wide a line is. */
  width: number
  /**
   * A cube that comes out of the caster ("originating from you": Thunderwave)
   * rather than landing anywhere in range (Cloud of Daggers). Cones and lines
   * always come out of the caster.
   */
  fromCaster?: boolean
}

export const MAX_SPELLS = 20
export const MAX_SPELL_NAME = 40
export const MAX_SPELL_NOTES = 1000
export const MAX_SPELL_TYPE = 24
export const MAX_PER_DAY = 9
const MAX_BONUS = 50

export const SPELL_RESOLVE_LABEL: Record<SpellResolve, string> = {
  save: 'Saving throw',
  attack: 'Spell attack',
  auto: 'No roll',
}

/** Proficiency +2 on the creature's INT: a sensible start that the DM changes in two clicks. */
export function defaultSpellcasting(): Spellcasting {
  return { ability: 'int', bonus: 2 }
}

/** How a character casts once they take up their first spell: as their class does, proficient at their level. */
export function classSpellcasting(stats: CharacterStats, fallback: Spellcasting): Spellcasting {
  return { ability: classCastingAbility(stats.klass) ?? fallback.ability, bonus: proficiencyBonus(stats.level) }
}

/** A fresh spell: a 1st-level DEX save that halves its damage, the most common shape there is. */
export function newSpell(): Spell {
  return {
    id: crypto.randomUUID(),
    name: 'Spell',
    level: 1,
    resolve: 'save',
    save: 'dex',
    onSave: 'half',
    count: 2,
    faces: 6,
    damageBonus: 0,
    type: 'fire',
    condition: null,
    notes: '',
    perDay: null,
    used: 0,
  }
}

export function castingMod(casting: Spellcasting, stats: CharacterStats): number {
  return displayedAbilityMod(stats, casting.ability) ?? 0
}

/** 8 + the casting ability's modifier + the bonus. */
export function saveDc(casting: Spellcasting, stats: CharacterStats): number {
  return 8 + castingMod(casting, stats) + casting.bonus
}

/** What's added to a spell attack's d20. */
export function spellAttackBonus(casting: Spellcasting, stats: CharacterStats): number {
  return castingMod(casting, stats) + casting.bonus
}

export function hasDamage(spell: Spell): boolean {
  return spell.count > 0
}

export function spellDamageFormula(spell: Spell): string {
  return `${spell.count}d${spell.faces}${formatModifier(spell.damageBonus)}`
}

/** "Cantrip", "1st level", "3rd level". */
export function levelLabel(level: number): string {
  if (level === 0) return 'Cantrip'
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'
  return `${level}${suffix} level`
}

/** "DC 13 DEX", "+5 to hit", or null when there's nothing to roll against. */
export function resolveLabel(spell: Spell, casting: Spellcasting, stats: CharacterStats): string | null {
  if (spell.resolve === 'save') return `DC ${saveDc(casting, stats)} ${ABILITY_LABEL[spell.save]}`
  if (spell.resolve === 'attack') return `${formatModifier(spellAttackBonus(casting, stats)) || '+0'} to hit`
  return null
}

export function normalizeSpellcasting(value: unknown): Spellcasting {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const fallback = defaultSpellcasting()
  return {
    ability: ABILITY_KEYS.find((key) => key === raw.ability) ?? fallback.ability,
    bonus: clampInt(raw.bonus, -MAX_BONUS, MAX_BONUS, fallback.bonus),
  }
}

/** Spells read from somewhere untrusted (a save file, the network, storage), made safe. */
export function normalizeSpells(value: unknown): Spell[] {
  if (!Array.isArray(value)) return []
  const spells: Spell[] = []
  for (const item of value.slice(0, MAX_SPELLS)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const faces = Number(raw.faces)
    const perDay = raw.perDay == null ? null : clampInt(raw.perDay, 1, MAX_PER_DAY, 1)
    spells.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
      name: (typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_SPELL_NAME) : '') || 'Spell',
      level: clampInt(raw.level, 0, 9, 1),
      resolve: raw.resolve === 'attack' || raw.resolve === 'auto' ? raw.resolve : 'save',
      save: ABILITY_KEYS.find((key) => key === raw.save) ?? 'dex',
      onSave: raw.onSave === 'none' ? 'none' : 'half',
      count: clampInt(raw.count, 0, MAX_DIE_COUNT, 0),
      faces: isDieFace(faces) && (DAMAGE_FACES as readonly number[]).includes(faces) ? faces : 6,
      damageBonus: clampInt(raw.damageBonus, -MAX_BONUS, MAX_BONUS, 0),
      type: typeof raw.type === 'string' ? raw.type.trim().slice(0, MAX_SPELL_TYPE) : '',
      condition: typeof raw.condition === 'string' && isStatusId(raw.condition) ? raw.condition : null,
      notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, MAX_SPELL_NOTES) : '',
      perDay,
      used: perDay == null ? 0 : clampInt(raw.used, 0, perDay, 0),
      ...(raw.area === null ? { area: null } : raw.area !== undefined ? { area: normalizeSpellArea(raw.area) } : {}),
      ...(raw.trigger === null
        ? { trigger: null }
        : raw.trigger === 'enter' || raw.trigger === 'start' || raw.trigger === 'both'
          ? { trigger: raw.trigger }
          : {}),
      ...(raw.affects === 'all' || raw.affects === 'enemies' || raw.affects === 'allies' ? { affects: raw.affects } : {}),
    })
  }
  return spells
}

function normalizeSpellArea(value: unknown): SpellArea | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!AREA_SHAPES.some((item) => item.id === raw.shape)) return null
  return {
    shape: raw.shape as AreaShape,
    feet: clampAreaFeet(Number(raw.feet) || 0),
    width: clampLineWidth(Number(raw.width) || 5),
    ...(raw.shape === 'square' && raw.fromCaster === true ? { fromCaster: true } : {}),
  }
}

/** The area a spell fills: what was set for it, or else what its notes say. */
export function spellArea(spell: Spell): SpellArea | null {
  return spell.area === undefined ? guessSpellArea(spell.notes) : spell.area
}

/**
 * What a spell's area does once it is down, as its notes and numbers say: it is
 * named for the spell; it lasts while the caster concentrates ("Concentration"),
 * or so many rounds ("1 minute" is 10); and a damaging spell whose notes say it
 * hurts a creature that enters it or starts its turn there does so, with its save.
 */
export function spellAreaEffects(
  spell: Spell,
  casterId: string,
  casting: Spellcasting,
  stats: CharacterStats,
): Pick<AreaMark, 'name' | 'duration' | 'damage'> {
  const lasting = guessLasting(spell.notes)
  const duration: AreaDuration | undefined =
    lasting == null ? undefined : 'concentration' in lasting ? { kind: 'concentration', casterId } : { kind: 'rounds', rounds: lasting.rounds }
  const trigger = spellTrigger(spell)
  const lingers = trigger != null && hasDamage(spell) && spell.type.toLowerCase() !== 'healing'
  const damage: AreaDamage | undefined = lingers
    ? {
        count: spell.count,
        faces: spell.faces,
        bonus: spell.damageBonus,
        type: spell.type,
        trigger,
        save: spell.resolve === 'save' ? { ability: spell.save, dc: saveDc(casting, stats), onSave: spell.onSave } : null,
        affects: spellAffects(spell),
      }
    : undefined
  return { name: spell.name, ...(duration ? { duration } : {}), ...(damage ? { damage } : {}) }
}

/** When a spell's area hurts on the map between casts: what is set for it, or else what its notes say. */
export function spellTrigger(spell: Spell): AreaTrigger | null {
  return spell.trigger === undefined ? guessTrigger(spell.notes) : spell.trigger
}

/** Who a spell's area hurts on the map: what is set for it, or else what its notes say. */
export function spellAffects(spell: Spell): AreaAffects {
  return spell.affects ?? guessAffects(spell.notes, spell.type.toLowerCase() === 'healing')
}

/** "20-ft radius", "15-ft cone", "100 × 5 ft line". */
export function spellAreaLabel(area: SpellArea): string {
  if (area.shape === 'circle') return `${area.feet}-ft radius`
  if (area.shape === 'line') return `${area.feet} × ${area.width} ft line`
  if (area.shape === 'square') return `${area.feet}-ft cube`
  return `${area.feet}-ft ${area.shape}`
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
