import { enteredAreas, sweptTokens, turnStartAreas, type AreaHit } from '../model/areaEffects.ts'
import { turnTokenIds, withAreaHit } from '../model/combat.ts'
import { walkCells } from '../model/movement.ts'
import { characterNameOf } from '../model/players.ts'
import { ABILITY_LABEL, displayedAbilityMod, normalizeStats } from '../model/stats.ts'
import type { Cell, Dungeon, Player } from '../model/types.ts'
import { damageTag, effectId, rollTitle, saveTag, type EffectPlan } from '../model/effects.ts'
import { requestRoll } from './diceStore.ts'
import { registerEffect } from './effectResolver.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { untracked } from './history.ts'
import { useSessionStore } from './sessionStore.ts'
import { useTravelStore } from './travelStore.ts'

/**
 * Spell areas that hurt, set off as the rules have it: when a creature enters
 * one (once a turn, including an emanation sweeping over it) or starts its turn
 * in one. The DM's browser runs them, so each goes off once for the table: it
 * rolls the creature's save, if there is one, and the damage, into the dice log.
 * It also ends areas whose caster has stopped concentrating, however that came
 * about (a player's own sheet included). Returns a function that stops it.
 */
export function startAreaTriggers(): () => void {
  let busy = false
  return useDungeonStore.subscribe((state, prev) => {
    if (busy || useSessionStore.getState().role === 'guest') return
    const next = state.dungeon
    const before = prev.dungeon
    // A different map, or a whole one loaded, sets nothing off.
    if (next === before || next.id !== before.id) return
    busy = true
    try {
      untracked(() => {
        useDungeonStore.getState().dropBrokenConcentration()
        settle(next, before)
      })
    } finally {
      busy = false
    }
  })
}

function settle(next: Dungeon, before: Dungeon): void {
  const areas = next.areas ?? []
  if (!areas.some((area) => area.damage)) return
  const players = next.players ?? []
  const was = before.players ?? []
  const combat = next.combat
  const done = combat?.areaHits ?? []
  const hits: AreaHit[] = []

  // A new turn: everyone acting on it who starts it in a damaging area.
  const turn = combat?.turnPlayerId ?? null
  if (turn && turn !== before.combat?.turnPlayerId) {
    for (const id of turnTokenIds(players, turn)) {
      const token = players.find((player) => player.id === id)
      if (token) hits.push(...turnStartAreas(areas, players, token))
    }
  }

  // Tokens that moved on their floor: areas they walked into, and anyone their emanations swept over.
  for (const token of players) {
    const from = was.find((player) => player.id === token.id)
    if (!from || from.floorId !== token.floorId || (from.x === token.x && from.y === token.y)) continue
    hits.push(...enteredAreas(areas, players, token, token.floorId, walkedPath(next, before, from, token), done))
    for (const area of areas) {
      if (area.playerId === token.id) hits.push(...sweptTokens(area, players, was, token.floorId, done))
    }
  }

  const seen = new Set<string>()
  const fresh = hits.filter((hit) => {
    const key = `${hit.area.id}:${hit.token.id}:${hit.why}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (fresh.length === 0) return
  for (const hit of fresh) fire(hit)

  // In combat, an area hurts a creature entering it only once a turn.
  const entered = fresh.filter((hit) => hit.why === 'enter').map((hit) => `${hit.area.id}:${hit.token.id}`)
  if (turn && entered.length) {
    const dungeon = useDungeonStore.getState().dungeon
    let noted = dungeon.combat
    for (const hit of entered) noted = withAreaHit(noted, hit)
    useDungeonStore.setState({ dungeon: { ...dungeon, combat: noted } })
  }
}

/**
 * The squares a token passed over getting from `from` to `to`: the walk it took
 * when there is one (this tab's, or another's heard over the relay), else a
 * straight line.
 */
function walkedPath(next: Dungeon, before: Dungeon, from: Player, to: Player): Cell[] {
  const ends = (cells: readonly Cell[]) => {
    const last = cells[cells.length - 1]
    return last != null && last.x === to.x && last.y === to.y
  }
  const own = next.travel ?? before.travel
  if (own?.playerId === to.id && ends(own.cells)) return own.cells
  const remote = useTravelStore.getState().remote[to.id]
  if (remote && ends(remote.cells)) return remote.cells
  return [{ x: from.x, y: from.y }, ...walkCells(from, to)]
}

/** Roll an area going off on a creature: its save (if the area allows one), then the damage. */
function fire({ area, token, why }: AreaHit): void {
  const damage = area.damage
  if (!damage) return
  const name = area.name || 'Area'
  const victim = {
    character: characterNameOf(token),
    characterId: token.characterId ?? undefined,
    tokenId: token.id,
  }
  const how = why === 'enter' ? 'entering' : 'starting in'
  const healing = damage.type.toLowerCase() === 'healing'
  const onSave = damage.save ? (damage.save.onSave === 'half' ? ', half on save' : ', none on save') : ''
  const saveTitle = damage.save ? `${ABILITY_LABEL[damage.save.ability]} save vs ${name} (DC ${damage.save.dc})` : undefined
  const damageTitle = `${name}${damage.type ? ` ${damage.type}` : ''} ${healing ? 'healing' : 'damage'} (${how}${onSave})`
  const plan: EffectPlan = {
    id: effectId(),
    name,
    targets: [token.id],
    save: damage.save,
    damage: healing ? null : { type: damage.type },
    healing,
    condition: null,
    ...(saveTitle ? { saveTitle: rollTitle(saveTitle) } : {}),
    damageTitle: rollTitle(damageTitle),
  }
  registerEffect(plan)
  if (damage.save && saveTitle) {
    const stats = normalizeStats(token.stats)
    requestRoll({
      count: 1,
      faces: 20,
      modifier: displayedAbilityMod(stats, damage.save.ability) ?? 0,
      title: saveTitle,
      kind: 'save',
      effect: saveTag(plan, token.id),
      ...victim,
    })
  }
  requestRoll({
    count: damage.count,
    faces: damage.faces,
    modifier: damage.bonus,
    title: damageTitle,
    kind: healing ? 'healing' : 'damage',
    effect: damageTag(plan),
    ...victim,
  })
}
