import type { MonsterTemplate, TemplateKind } from '../../model/monsterTemplates.ts'
import { isCharacter } from '../../model/players.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useMonsterLibraryStore } from '../../state/monsterLibraryStore.ts'
import { getActiveFloor } from '../../state/selectors.ts'

/**
 * What Add monster does: with nothing saved yet, stands a blank monster on
 * the floor in view; otherwise opens the picker of saved monsters.
 */
export function addMonster(): void {
  if (!hasSaved('monster')) {
    placeCreature('monster', undefined, null)
    return
  }
  useEditorStore.getState().setCreaturePicker({ kind: 'monster', ownerId: null })
}

/**
 * What Add companion does: opens the picker, which also asks whose companion
 * it is. It starts on the character whose sheet or token is open, if any.
 */
export function addCompanion(): void {
  const editor = useEditorStore.getState()
  const tokens = useDungeonStore.getState().dungeon.players ?? []
  const picked = [editor.sheetPlayerId, editor.selectedPlayerId]
    .map((id) => tokens.find((token) => token.id === id))
    .find((token) => token && isCharacter(token))
  const ownerId = picked?.id ?? tokens.find(isCharacter)?.id ?? null
  editor.setCreaturePicker({ kind: 'companion', ownerId })
}

function hasSaved(kind: TemplateKind): boolean {
  return useMonsterLibraryStore.getState().monsters.some((template) => template.kind === kind)
}

/**
 * Stands a monster or companion (one of `template`'s, or a blank one) on the
 * map; a companion beside its owner when it can. Its name, or null when there's no room.
 */
export function placeCreature(
  kind: TemplateKind,
  template: MonsterTemplate | undefined,
  ownerId: string | null,
): string | null {
  const store = useDungeonStore.getState()
  const floorId = getActiveFloor().id
  const id = kind === 'companion' ? store.addCompanion(floorId, ownerId, template) : store.addMonster(floorId, template)
  if (!id) return null
  useEditorStore.getState().selectPlayer(id)
  // Read after adding: the name may have been numbered ("Goblin 2").
  const placed = useDungeonStore.getState().dungeon.players.find((token) => token.id === id)
  return placed?.characterName ?? (kind === 'companion' ? 'Companion' : 'Monster')
}
