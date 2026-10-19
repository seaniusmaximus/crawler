import { DAMAGE_TYPES } from './damage.ts'
import { clampAreaFeet, clampLineWidth, MAX_AREA_ROUNDS, type AreaAffects, type AreaShape, type AreaTrigger } from './marks.ts'
import type { Spell, SpellArea } from './spells.ts'
import { ABILITY_KEYS, type AbilityKey } from './stats.ts'
import { CONDITION_EFFECTS, type StatusId } from './status.ts'

/**
 * Reading a spell's description the way its rules text (or a stat block) puts
 * it, so typing or pasting it in fills in the rest of the spell: its level, how
 * it lands, the save, damage, condition and area, and what its area does on the
 * map. Each guess is only that: whatever is set on the spell wins.
 */

/** A number of feet as notes write it: "20-foot", "20 feet", "20 ft.", "20-ft". */
const FEET = String.raw`(\d+)\s*-?\s*(?:foot|feet|ft\.?)`

const ABILITY_WORDS: Record<AbilityKey, string> = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
}

/**
 * The area the notes describe, as stat blocks and spell text put it: a
 * "20-foot-radius sphere", a "15-foot cone", a "100-foot-long, 5-foot-wide line",
 * a "10-foot cube", a "10-foot Emanation". Null when they don't say.
 */
export function guessSpellArea(notes: string): SpellArea | null {
  const text = notes.toLowerCase()
  const find = (pattern: string) => {
    const match = new RegExp(pattern).exec(text)
    return match ? Number(match[1]) : null
  }
  const area = (shape: AreaShape, feet: number | null, width = 5): SpellArea | null =>
    feet ? { shape, feet: clampAreaFeet(feet), width: clampLineWidth(width) } : null
  // A cube comes out of the caster when the text says so ("originating from you"); otherwise it lands in range.
  const cube = (feet: number | null): SpellArea | null => {
    const found = area('square', feet)
    return found && /originat\w* from you|\bfrom you\b/.test(text) ? { ...found, fromCaster: true } : found
  }
  return (
    area('emanation', find(`${FEET}[\\s-]*emanation`) ?? find(String.raw`emanation\D{0,24}(\d+)\s*-?\s*(?:foot|feet|ft)`)) ??
    area('cone', find(`${FEET}[\\s-]*cone`)) ??
    cube(find(`${FEET}[\\s-]*(?:cube|square)`)) ??
    area('line', find(`${FEET}[\\s-]*long`) ?? find(`${FEET}[\\s-]*line`), find(`${FEET}[\\s-]*wide`) ?? 5) ??
    area('circle', find(`${FEET}[\\s-]*radius`) ?? find(String.raw`radius\D{0,12}(\d+)\s*-?\s*(?:foot|feet|ft)`))
  )
}

/**
 * When the notes say an area hurts a creature that stays in it: as it enters
 * ("enters", "moves into"), as it starts its turn there ("starts its turn",
 * "start of their turn", "start turn", "starting turn", "turn start"), or both.
 * Null when they don't, so it only hurts when cast.
 */
export function guessTrigger(notes: string): AreaTrigger | null {
  const text = notes.toLowerCase()
  const enters = /\benter(s|ing)?\b|\bmoves? into\b/.test(text)
  const whose = String.raw`(?:(?:its|their|his|her|your|a)\s+)?`
  const starts = new RegExp(String.raw`\bstart(?:s|ing)?\s+${whose}turn\b|\bstart of\s+${whose}turn\b|\bturn[\s-]*start`).test(text)
  return enters && starts ? 'both' : enters ? 'enter' : starts ? 'start' : null
}

/**
 * Who the notes say its area takes in: only enemies for "enemies" or "hostile
 * creatures"; only allies for "allies" or "friendly"; "creatures of your choice"
 * means allies for a healing spell and enemies for any other; everyone otherwise
 * ("each creature").
 */
export function guessAffects(notes: string, healing = false): AreaAffects {
  const text = notes.toLowerCase()
  if (/\benem(?:y|ies)\b|\bhostile\b/.test(text)) return 'enemies'
  if (/\ball(?:y|ies)\b|\bfriendly\b/.test(text)) return 'allies'
  if (/of your choice/.test(text)) return healing ? 'allies' : 'enemies'
  return 'all'
}

/** How long the notes say its area lasts: "concentration", or "N rounds", or "N minutes" (10 rounds each). */
export function guessLasting(notes: string): { concentration: true } | { rounds: number } | null {
  const text = notes.toLowerCase()
  if (/concentration/.test(text)) return { concentration: true }
  const rounds = /(\d+)\s*rounds?/.exec(text)
  if (rounds) return { rounds: Math.min(MAX_AREA_ROUNDS, Math.max(1, Number(rounds[1]))) }
  const minutes = /(\d+)\s*-?\s*minutes?/.exec(text)
  if (minutes) return { rounds: Math.min(MAX_AREA_ROUNDS, Math.max(1, Number(minutes[1]) * 10)) }
  return null
}

/** The spell fields its notes give, for the ones they say anything about. */
export type NotesFields = Partial<
  Pick<Spell, 'level' | 'perDay' | 'resolve' | 'save' | 'onSave' | 'count' | 'faces' | 'damageBonus' | 'type' | 'condition' | 'area' | 'affects' | 'trigger'>
>

/**
 * Everything the notes say about a spell: its level ("3rd-level", "cantrip"),
 * uses ("1/day"), how it lands ("Dexterity saving throw", "spell attack"), what a
 * success does ("half as much"), its damage ("8d6 fire damage") or healing
 * ("regains 2d8 hit points"), the condition it puts on ("is frightened"), its
 * area, and what that area does on the map. Only fields they mention are given.
 */
export function readSpellNotes(notes: string): NotesFields {
  const text = notes.toLowerCase()
  const fields: NotesFields = {}

  if (/\bcantrip\b/.test(text)) fields.level = 0
  const level = /\b([1-9])(?:st|nd|rd|th)[\s-]*level\b|\blevel\s+([1-9])\b/.exec(text)
  if (level) fields.level = Number(level[1] ?? level[2])

  const perDay = /\b(\d)\s*\/\s*day\b/.exec(text)
  if (perDay) fields.perDay = Number(perDay[1])
  else if (/\bat will\b/.test(text)) fields.perDay = null

  const save = new RegExp(String.raw`\b(${Object.values(ABILITY_WORDS).join('|')}|str|dex|con|int|wis|cha)\s+sav(?:ing throw|e)\b`).exec(text)
  if (save) {
    const word = save[1] ?? ''
    fields.resolve = 'save'
    fields.save = ABILITY_KEYS.find((key) => key === word || ABILITY_WORDS[key] === word) ?? 'dex'
    fields.onSave = /half as much|half damage|half on (?:a )?success|\bhalf\b/.test(text) ? 'half' : 'none'
  } else if (/\bspell attack\b/.test(text)) {
    fields.resolve = 'attack'
  }

  // Healing first ("regains 2d8 hit points"), else damage dice with the type beside them.
  const types = DAMAGE_TYPES.join('|')
  const healing = /regains?\s+(?:a number of\s+)?(?:hit points equal to\s+)?(\d+)d(\d+)(?:\s*\+\s*(\d+))?/.exec(text)
  const typed = new RegExp(String.raw`(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s+(${types})\b`).exec(text)
  const dice = healing ?? typed ?? /(\d+)d(\d+)(?:\s*\+\s*(\d+))?/.exec(text)
  if (dice) {
    const faces = Number(dice[2])
    if ([4, 6, 8, 10, 12, 20].includes(faces)) {
      fields.count = Number(dice[1])
      fields.faces = faces
      fields.damageBonus = Number(dice[3] ?? 0)
    }
    if (healing) fields.type = 'healing'
    else if (typed) fields.type = typed[4]
    // Damage or healing with neither a save nor an attack to it simply happens (Cloud of Daggers, Cure Wounds).
    fields.resolve ??= 'auto'
  }

  const conditions = CONDITION_EFFECTS.map((effect) => effect.id).join('|')
  const condition = new RegExp(String.raw`\b(?:is|are|be|becomes?|falls?)\s+(?:knocked\s+)?(${conditions})\b`).exec(text)
  if (condition) fields.condition = condition[1] as StatusId

  const area = guessSpellArea(notes)
  if (area) fields.area = area
  const trigger = guessTrigger(notes)
  if (trigger) fields.trigger = trigger
  if (area || trigger) fields.affects = guessAffects(notes, fields.type === 'healing')
  return fields
}
