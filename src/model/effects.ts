import { isDamageType, normalizeDefenses } from './damage.ts'
import { ABILITY_KEYS, type AbilityKey } from './stats.ts'
import { CONDITION_EFFECTS, type StatusId } from './status.ts'
import type { Player } from './types.ts'

/**
 * A spell or zone going off on some creatures: who it catches, the save each
 * makes, the damage (or healing) rolled once for all of them, and the condition
 * a failed save brings. Its rolls are tagged with its id, and once they are all
 * in, what each creature takes is worked out here and applied.
 */
export interface EffectPlan {
  id: string
  /** The spell or zone, for the log. */
  name: string
  /** Creatures it catches, by token. */
  targets: string[]
  save: { ability: AbilityKey; dc: number; onSave: 'half' | 'none' } | null
  /** Rolled once for everyone; null when it only imposes a save or condition. */
  damage: { type: string } | null
  healing: boolean
  condition: StatusId | null
  /**
   * The titles its save rolls and its damage roll go out with. A table whose
   * relay predates roll tags hands rolls back without them; these find them anyway.
   */
  saveTitle?: string
  damageTitle?: string
}

/** A roll title as the relay hands it back: trimmed, and no longer than it keeps. */
export function rollTitle(title: string): string {
  return title.trim().slice(0, 80)
}

/** How a roll belongs to an effect: a creature's save, or the damage for everyone. */
export type EffectPart = { effectId: string; part: 'save'; tokenId: string } | { effectId: string; part: 'damage' }

const MAX_TARGETS = 40

/** The tag on a creature's save roll. */
export function saveTag(plan: Pick<EffectPlan, 'id'>, tokenId: string): string {
  return `${plan.id}|s|${tokenId}`
}

/** The tag on the damage (or healing) roll. */
export function damageTag(plan: Pick<EffectPlan, 'id'>): string {
  return `${plan.id}|d`
}

/** What part of which effect a roll's tag says it is; null for an untagged roll. */
export function readTag(tag: string | undefined): EffectPart | null {
  if (!tag) return null
  const [effectId, part, tokenId] = tag.split('|')
  if (!effectId) return null
  if (part === 'd') return { effectId, part: 'damage' }
  if (part === 's' && tokenId) return { effectId, part: 'save', tokenId }
  return null
}

/** A fresh id for an effect, short enough to tag every roll with. */
export function effectId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

/** An effect sent by a player, checked over; null if it isn't one. */
export function normalizeEffect(raw: unknown): EffectPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const plan = raw as Record<string, unknown>
  if (typeof plan.id !== 'string' || !/^[0-9a-z]{6,24}$/i.test(plan.id)) return null
  if (!Array.isArray(plan.targets)) return null
  const targets = plan.targets.filter((id): id is string => typeof id === 'string').slice(0, MAX_TARGETS)
  const save = plan.save as Record<string, unknown> | null | undefined
  const damage = plan.damage as Record<string, unknown> | null | undefined
  return {
    id: plan.id,
    name: typeof plan.name === 'string' ? plan.name.slice(0, 60) : 'Spell',
    targets,
    save:
      save && typeof save === 'object'
        ? {
            ability: ABILITY_KEYS.find((key) => key === save.ability) ?? 'dex',
            dc: Math.max(1, Math.min(40, Math.round(Number(save.dc)) || 10)),
            onSave: save.onSave === 'none' ? 'none' : 'half',
          }
        : null,
    damage: damage && typeof damage === 'object' ? { type: typeof damage.type === 'string' ? damage.type.slice(0, 30) : '' } : null,
    healing: plan.healing === true,
    condition: CONDITION_EFFECTS.some((effect) => effect.id === plan.condition) ? (plan.condition as StatusId) : null,
    ...(typeof plan.saveTitle === 'string' ? { saveTitle: rollTitle(plan.saveTitle) } : {}),
    ...(typeof plan.damageTitle === 'string' ? { damageTitle: rollTitle(plan.damageTitle) } : {}),
  }
}

/** What one creature takes from an effect. */
export interface EffectOutcome {
  tokenId: string
  /** Its save made it (null when there was none to make). */
  saved: boolean | null
  /** Hit points it loses (or, healing, gains); 0 for none. */
  amount: number
  healing: boolean
  /** Why the amount isn't simply the roll: "half on save", "resistant", "immune", "vulnerable". */
  notes: string[]
  /** A condition it now has. */
  condition: StatusId | null
}

/**
 * Whether an effect has everything it needs to be worked out: a save from each
 * creature that makes one, and its damage roll if it has one.
 */
export function effectReady(plan: EffectPlan, saves: ReadonlyMap<string, number>, damage: number | null): boolean {
  if ((plan.damage || plan.healing) && damage == null) return false
  return !plan.save || plan.targets.every((tokenId) => saves.has(tokenId))
}

/**
 * What each creature takes: the rolled damage, halved (or nothing) on a made
 * save, then halved for a resistance, nothing for an immunity, doubled for a
 * vulnerability; or the healing, whole. A failed save (or no save at all)
 * brings its condition.
 */
export function resolveEffect(
  plan: EffectPlan,
  saves: ReadonlyMap<string, number>,
  damage: number | null,
  players: readonly Player[],
): EffectOutcome[] {
  return plan.targets.flatMap((tokenId) => {
    const token = players.find((player) => player.id === tokenId)
    if (!token) return []
    const roll = saves.get(tokenId)
    const saved = plan.save ? roll != null && roll >= plan.save.dc : null
    const notes: string[] = []
    let amount = Math.max(0, damage ?? 0)
    if (!plan.healing && amount > 0) {
      if (saved && plan.save) {
        amount = plan.save.onSave === 'half' ? Math.floor(amount / 2) : 0
        notes.push(plan.save.onSave === 'half' ? 'half on save' : 'saved')
      }
      const type = plan.damage?.type.toLowerCase()
      const defense = type && isDamageType(type) ? normalizeDefenses(token.defenses)[type] : undefined
      if (defense === 'resistant') amount = Math.floor(amount / 2)
      if (defense === 'immune') amount = 0
      if (defense === 'vulnerable') amount *= 2
      if (defense) notes.push(defense)
    }
    return [{ tokenId, saved, amount, healing: plan.healing, notes, condition: saved ? null : plan.condition }]
  })
}
