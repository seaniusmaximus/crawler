import { playerSize } from '../../model/players.ts'
import {
  hasDamage,
  normalizeSpellcasting,
  saveDc,
  spellAffects,
  spellArea,
  spellAreaEffects,
  spellTrigger,
  type Spell,
  type SpellArea,
} from '../../model/spells.ts'
import { areaColorFor, type AreaMark } from '../../model/marks.ts'
import { normalizeStats } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { INSTANT_AREA_MS, rollCast, type CastRoll } from '../areas/castRolls.ts'
import { tokenShown } from './tokenInfo.ts'
import { rollSpellAttack, rollSpellDamage } from './tokenRolls.ts'

/**
 * Cast a spell as its sheet row would: one with an area goes on the map (and
 * rolls for whoever it catches as it lands); one without rolls its attack and
 * its damage or healing.
 */
export function castSpell(player: Player, spell: Spell): void {
  const area = spellArea(spell)
  if (area) {
    placeSpellArea(player, spell, area)
    return
  }
  if (spell.resolve === 'attack') rollSpellAttack(player, spell)
  if (hasDamage(spell)) rollSpellDamage(player, spell)
}

/**
 * Lay a spell's area on the map. An emanation lands on the caster at once;
 * anything else takes up the area tool at the spell's shape and size, coming
 * out of the caster (a circle goes wherever it is clicked).
 */
export function placeSpellArea(player: Player, spell: Spell, area: SpellArea): void {
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
      color: areaColorFor(editor.aoeColor, player),
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
