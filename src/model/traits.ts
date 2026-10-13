/**
 * A stat block's trait: anything worth knowing about the creature, from an
 * ability ("Pack Tactics") to plain nature ("Keen Smell", "Hates fire"). The
 * text is the DM's own notes, as long and loose as they like within a limit.
 */
export interface Trait {
  id: string
  name: string
  text: string
}

export const MAX_TRAITS = 12
export const MAX_TRAIT_NAME = 40
export const MAX_TRAIT_TEXT = 1000

export function newTrait(): Trait {
  return { id: crypto.randomUUID(), name: '', text: '' }
}

/** Traits read from somewhere untrusted (a save file, the network, storage), made safe. Empty ones are dropped. */
export function normalizeTraits(value: unknown): Trait[] {
  if (!Array.isArray(value)) return []
  const traits: Trait[] = []
  for (const item of value.slice(0, MAX_TRAITS)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_TRAIT_NAME) : ''
    const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TRAIT_TEXT) : ''
    if (!name && !text) continue
    traits.push({ id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(), name, text })
  }
  return traits
}
