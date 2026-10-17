import type { DiceRoll } from '../model/dice.ts'
import { effectReady, readTag, resolveEffect, rollTitle, type EffectOutcome, type EffectPlan } from '../model/effects.ts'
import { playerStatuses } from '../model/players.ts'
import { normalizeStats } from '../model/stats.ts'
import { onNewRolls } from './diceStore.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { useSessionStore } from './sessionStore.ts'

/**
 * Spells and zones going off, waiting on their rolls. When a creature's save
 * and the damage have all come in (from the table's relay, so nobody chooses
 * their own numbers), what each creature takes is applied to its hit points,
 * and a failed save brings its condition. The DM's browser does this, so it
 * happens once, on the map everyone shares.
 */
interface Pending {
  plan: EffectPlan
  saves: Map<string, number>
  damage: number | null
  at: number
}

const pending = new Map<string, Pending>()
/** Rolls that never come (a dropped connection) let an effect go after this long. */
const GIVE_UP_MS = 30_000

/** Wait for an effect's rolls (the DM's own, or one a player sent). */
export function registerEffect(plan: EffectPlan): void {
  const now = Date.now()
  for (const [id, entry] of pending) if (now - entry.at > GIVE_UP_MS) pending.delete(id)
  pending.set(plan.id, { plan, saves: new Map(), damage: null, at: now })
}

/** Start applying effects as their rolls arrive. Returns a function that stops it. */
export function startEffectResolver(): () => void {
  return onNewRolls((rolls) => {
    if (useSessionStore.getState().role === 'guest') return
    for (const roll of rolls) {
      const found = place(roll)
      if (!found) continue
      const [id, entry] = found
      if (!effectReady(entry.plan, entry.saves, entry.damage)) continue
      pending.delete(id)
      const players = useDungeonStore.getState().dungeon.players ?? []
      for (const outcome of resolveEffect(entry.plan, entry.saves, entry.damage, players)) apply(outcome)
    }
  })
}

/**
 * Note a roll against the effect it belongs to: by its tag, or (from a relay
 * that hands rolls back untagged) by its title, and for a save its creature.
 * Returns that effect, or null when the roll belongs to none.
 */
function place(roll: DiceRoll): [string, Pending] | null {
  const tag = readTag(roll.effect)
  if (tag) {
    const entry = pending.get(tag.effectId)
    if (!entry) return null
    if (tag.part === 'save') entry.saves.set(tag.tokenId, roll.total)
    else entry.damage = roll.total
    return [tag.effectId, entry]
  }
  const title = rollTitle(roll.title)
  for (const [id, entry] of pending) {
    const { plan } = entry
    if (roll.kind === 'save' && roll.tokenId && plan.saveTitle === title) {
      if (!plan.targets.includes(roll.tokenId) || entry.saves.has(roll.tokenId)) continue
      entry.saves.set(roll.tokenId, roll.total)
      return [id, entry]
    }
    if ((roll.kind === 'damage' || roll.kind === 'healing') && plan.damageTitle === title && entry.damage == null) {
      entry.damage = roll.total
      return [id, entry]
    }
  }
  return null
}

/**
 * Put one creature's outcome on the map: damage comes off temporary hit points
 * first, then hit points (not below 0); healing goes on up to its maximum. A
 * creature with no hit points written down is left alone.
 */
function apply(outcome: EffectOutcome): void {
  const store = useDungeonStore.getState()
  const token = (store.dungeon.players ?? []).find((player) => player.id === outcome.tokenId)
  if (!token) return
  const stats = normalizeStats(token.stats)
  if (outcome.amount > 0 && stats.hp != null) {
    if (outcome.healing) {
      const healed = stats.hp + outcome.amount
      store.setPlayerStat(token.id, 'hp', stats.hpMax != null ? Math.min(stats.hpMax, healed) : healed)
    } else {
      const temp = stats.hpTemp != null && stats.hpTemp > 0 ? stats.hpTemp : 0
      const absorbed = Math.min(temp, outcome.amount)
      if (absorbed > 0) store.setPlayerStat(token.id, 'hpTemp', temp - absorbed)
      store.setPlayerStat(token.id, 'hp', Math.max(0, stats.hp - (outcome.amount - absorbed)))
    }
  }
  if (outcome.condition && !playerStatuses(token).includes(outcome.condition)) {
    store.togglePlayerStatus(token.id, outcome.condition)
  }
}
