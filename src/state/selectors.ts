import { resolveFloor } from '../model/floors.ts'
import type { Floor } from '../model/types.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { useEditorStore } from './editorStore.ts'

/** The floor the editor is currently showing; falls back to the lowest one. */
export function getActiveFloor(): Floor {
  return resolveFloor(useDungeonStore.getState().dungeon.floors, useEditorStore.getState().activeFloorId)
}
