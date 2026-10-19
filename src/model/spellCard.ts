import { readSpellNotes } from './spellNotes.ts'
import { MAX_SPELL_NAME, MAX_SPELL_NOTES, newSpell, type Spell } from './spells.ts'

/**
 * A spell as D&D Beyond shows it (a character sheet's spell pane, or a spell's
 * own page), sent over by the Dice Bridge: its name, the lines under it
 * ("Casting Time: 1 Action"), and its description. The extension only reads the
 * page; everything here works out what the spell does from that text, so a
 * change in how it is read needs no new extension.
 */
export interface SpellCard {
  id: string
  name: string
  /** As the page puts it under the name: "3rd-level Evocation", "Evocation cantrip". */
  subtitle: string
  /** The page's labelled lines, in its order. */
  properties: SpellCardProperty[]
  /** Paragraphs split by blank lines, as the page has them. */
  description: string
  /** The D&D Beyond character whose sheet sent it, if a sheet did. */
  characterId: string | null
  /** Who showed it to the table; only on a card someone else showed. */
  from?: string
}

export interface SpellCardProperty {
  label: string
  value: string
}

const MAX_NAME = 60
const MAX_SUBTITLE = 80
const MAX_PROPERTIES = 12
const MAX_LABEL = 32
const MAX_VALUE = 160
const MAX_DESCRIPTION = 6000
const MAX_FROM = 40

/** A card read from somewhere untrusted (the extension, the network), made safe; null when there's no spell in it. */
export function normalizeSpellCard(value: unknown): SpellCard | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = text(raw.name, MAX_NAME)
  if (!name) return null
  const properties: SpellCardProperty[] = []
  for (const item of Array.isArray(raw.properties) ? raw.properties.slice(0, MAX_PROPERTIES) : []) {
    if (!item || typeof item !== 'object') continue
    const property = item as Record<string, unknown>
    const label = text(property.label, MAX_LABEL).replace(/:$/, '')
    const shown = text(property.value, MAX_VALUE)
    if (label && shown) properties.push({ label, value: shown })
  }
  const from = text(raw.from, MAX_FROM)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
    name,
    subtitle: text(raw.subtitle, MAX_SUBTITLE),
    properties,
    description: typeof raw.description === 'string' ? raw.description.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_DESCRIPTION) : '',
    characterId: typeof raw.characterId === 'string' && /^\d{1,20}$/.test(raw.characterId) ? raw.characterId : null,
    ...(from ? { from } : {}),
  }
}

/** One of the card's lines by its label ("Duration"), or "" when it has none. */
export function cardProperty(card: SpellCard, pattern: RegExp): string {
  return card.properties.find((property) => pattern.test(property.label))?.value ?? ''
}

/**
 * Its level: from "3rd-level Evocation" or "Evocation cantrip" under the name,
 * or a "Level: 3rd" line; null when the page doesn't say.
 */
export function cardLevel(card: SpellCard): number | null {
  const said = `${card.subtitle} ${cardProperty(card, /^level$/i)}`.toLowerCase()
  if (/\bcantrip\b/.test(said)) return 0
  const level = /\b([1-9])(?:st|nd|rd|th)?\b/.exec(said)
  return level ? Number(level[1]) : null
}

/**
 * The card as a spell for a sheet: its text goes into the spell's notes, read
 * exactly as typing or pasting it there would be (see `readSpellNotes`), so it
 * comes out as the spell form would fill it in, and can be fixed there the same way.
 */
export function spellFromCard(card: SpellCard): Spell {
  const notes = cardNotes(card)
  const read = readSpellNotes(notes)
  return {
    ...newSpell(),
    // Nothing the notes don't say: no damage, no roll, no condition.
    count: 0,
    type: '',
    resolve: 'auto',
    condition: null,
    ...read,
    level: cardLevel(card) ?? read.level ?? 1,
    name: card.name.slice(0, MAX_SPELL_NAME),
    notes,
    perDay: null,
    used: 0,
    area: read.area ?? null,
    trigger: read.trigger ?? null,
    affects: read.affects ?? 'all',
  }
}

/**
 * The spell's notes: what it is and how long it lasts (the map reads that for
 * how long its area stays), then its description, cut to fit.
 */
function cardNotes(card: SpellCard): string {
  const duration = cardProperty(card, /^duration$/i)
  const head = [card.subtitle, duration ? `Duration: ${duration}` : ''].filter(Boolean).join('. ')
  const notes = [head, card.description].filter(Boolean).join('\n\n')
  if (notes.length <= MAX_SPELL_NOTES) return notes
  const cut = notes.slice(0, MAX_SPELL_NOTES - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_SPELL_NOTES - 40)).trimEnd()}…`
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}
