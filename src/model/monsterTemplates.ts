import { normalizeAttacks, type Attack } from './attacks.ts'
import { normalizeDefenses, type Defenses } from './damage.ts'
import { normalizeSenses, type Senses } from './senses.ts'
import { normalizeSpellcasting, normalizeSpells, type Spell, type Spellcasting } from './spells.ts'
import { characterNameOf, MAX_TOKEN_SIZE, MIN_TOKEN_SIZE, PLAYER_COLORS } from './players.ts'
import { normalizeStats, type CharacterStats } from './stats.ts'
import type { Player } from './types.ts'

/**
 * A monster (or companion) the DM saved from a stat block, ready to drop onto any map: its
 * name, standee, footprint, stats, attacks, spells, defenses and senses. Kept in the DM's Monster
 * or Companion library, with their account when signed in and in this browser otherwise.
 * Both libraries are one store underneath, told apart by `kind`.
 *
 * The standee is kept inline as PNG data. Uploaded images belong to a single
 * campaign, and a template has to work in any of them.
 */
export interface MonsterTemplate {
  id: string
  /** Which library it's in; templates saved before companions existed are monsters. */
  kind: TemplateKind
  name: string
  /** PNG (or other raster) data URL; null for the default pawn. */
  portrait: string | null
  color: string
  size: number
  stats: CharacterStats
  attacks: Attack[]
  defenses: Defenses
  senses: Senses
  spellcasting: Spellcasting
  spells: Spell[]
}

export type TemplateKind = 'monster' | 'companion'

/** What each library is called, for messages and titles. */
export const LIBRARY_NAME: Record<TemplateKind, string> = {
  monster: 'Monster library',
  companion: 'Companion library',
}

export const TEMPLATE_PREFIX = 'monster-'
export const MAX_LIBRARY_MONSTERS = 300
export const MAX_TEMPLATE_NAME = 40
/**
 * Standees are cut down to 192×288 PNGs (see portrait.ts), well under this as
 * base64. The cap keeps a whole template far below a storage row's limit.
 */
export const MAX_TEMPLATE_PORTRAIT = 400_000
/** A template with the largest standee allowed and every field filled in fits under this. */
export const MAX_TEMPLATE_BYTES = MAX_TEMPLATE_PORTRAIT + 40_000

const TEMPLATE_ID = new RegExp(`^${TEMPLATE_PREFIX}[0-9a-f-]{36}$`)
const INLINE_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/
const HEX = /^#[0-9a-f]{6}$/i

export function newTemplateId(): string {
  return `${TEMPLATE_PREFIX}${crypto.randomUUID()}`
}

export function isInlineImage(src: string | null | undefined): src is string {
  return typeof src === 'string' && src.length <= MAX_TEMPLATE_PORTRAIT && INLINE_IMAGE.test(src)
}

/** The library a token saves into: companions to theirs, everything else to the Monster library. */
export function templateKindOf(token: Pick<Player, 'kind'>): TemplateKind {
  return token.kind === 'companion' ? 'companion' : 'monster'
}

/**
 * A monster or companion token as a template. `portrait` is its standee already turned back
 * into inline data. It's saved unhurt: full hit points, no temporary ones.
 */
export function templateFromToken(token: Player, portrait: string | null, id = newTemplateId()): MonsterTemplate {
  const stats = normalizeStats(token.stats)
  return cleanTemplate({
    id,
    kind: templateKindOf(token),
    name: characterNameOf(token),
    portrait,
    color: token.color,
    size: token.size,
    stats: { ...stats, hp: stats.hpMax ?? stats.hp, hpTemp: null },
    attacks: normalizeAttacks(token.attacks),
    defenses: normalizeDefenses(token.defenses),
    senses: normalizeSenses(token.senses),
    spellcasting: normalizeSpellcasting(token.spellcasting),
    // Saved rested: every spell's uses back.
    spells: normalizeSpells(token.spells).map((spell) => ({ ...spell, used: 0 })),
  })
}

/** A template read from somewhere untrusted (the network, browser storage), checked and cleaned; null when it isn't one. */
export function parseTemplate(value: unknown): MonsterTemplate | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !TEMPLATE_ID.test(raw.id)) return null
  if (raw.portrait != null && !isInlineImage(raw.portrait as string)) return null
  return cleanTemplate({
    id: raw.id,
    kind: raw.kind === 'companion' ? 'companion' : 'monster',
    name: typeof raw.name === 'string' ? raw.name : '',
    portrait: (raw.portrait as string | null | undefined) ?? null,
    color: typeof raw.color === 'string' ? raw.color : '',
    size: Number(raw.size),
    stats: normalizeStats(raw.stats),
    attacks: normalizeAttacks(raw.attacks),
    defenses: normalizeDefenses(raw.defenses),
    senses: normalizeSenses(raw.senses),
    spellcasting: normalizeSpellcasting(raw.spellcasting),
    spells: normalizeSpells(raw.spells),
  })
}

function cleanTemplate(template: MonsterTemplate): MonsterTemplate {
  const size = Math.round(template.size)
  return {
    id: template.id,
    kind: template.kind === 'companion' ? 'companion' : 'monster',
    name: template.name.trim().slice(0, MAX_TEMPLATE_NAME) || (template.kind === 'companion' ? 'Companion' : 'Monster'),
    portrait: isInlineImage(template.portrait) ? template.portrait : null,
    color: HEX.test(template.color) ? template.color.toLowerCase() : PLAYER_COLORS[0],
    size: Number.isFinite(size) ? Math.max(MIN_TOKEN_SIZE, Math.min(MAX_TOKEN_SIZE, size)) : MIN_TOKEN_SIZE,
    stats: template.stats,
    attacks: template.attacks,
    defenses: template.defenses,
    senses: template.senses,
    spellcasting: template.spellcasting,
    spells: template.spells,
  }
}

/**
 * A name for another of a template's monsters on this map: its own name while
 * that's free, then "Goblin 2", "Goblin 3", so the DM can tell them apart.
 */
export function spawnName(base: string, tokens: readonly Player[]): string {
  const used = new Set(tokens.map((token) => characterNameOf(token).toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  let n = 2
  while (used.has(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}
