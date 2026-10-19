import { FOCUS_INSET } from '../../app/layout.ts'
import { anchorTarget } from '../../model/noteMap.ts'
import type { NoteAnchor } from '../../model/notes.ts'
import { characterNameOf } from '../../model/players.ts'
import { objectDef } from '../../objects/catalog.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'

/** Whether this seat is the DM's (or a solo table, which is the DM's too). */
export function useIsDm(): boolean {
  return useSessionStore((state) => state.role !== 'guest')
}

/** Look at what a note is pinned to, if it's on the map in play. */
export function goToAnchor(anchor: NoteAnchor | null): boolean {
  const { mapId } = useNotesStore.getState()
  const target = anchorTarget(useDungeonStore.getState().dungeon, anchor, mapId)
  if (!target?.room) return false
  const editor = useEditorStore.getState()
  editor.focusRoom(target.floor.id, target.room.id, FOCUS_INSET)
  if (anchor?.objectId && useSessionStore.getState().role !== 'guest') {
    editor.selectObject({ roomId: target.room.id, objectId: anchor.objectId })
  }
  return true
}

/**
 * What a note is pinned to, by today's names when it's on the map in play.
 * `here` is whether it can be looked at on this map now.
 */
export function useAnchorLabel(anchor: NoteAnchor | null): { label: string; here: boolean } | null {
  const mapId = useNotesStore((state) => state.mapId)
  // Read as one string, so a row only redraws when its own label changes, not on every move.
  const read = useDungeonStore((state) => {
    if (!anchor) return ''
    if (anchor.mapId !== mapId) return `0${anchor.label || 'Another map'}`
    if (!anchor.roomId) return `0${state.dungeon.name || anchor.label || 'This map'}`
    const target = anchorTarget(state.dungeon, anchor, mapId)
    if (!target?.room) return `0${anchor.label || 'Pin'} (gone)`
    const object = anchor.objectId ? target.room.objects?.find((item) => item.id === anchor.objectId) : undefined
    return `1${object ? `${target.room.name} · ${objectDef(object.kind).name}` : target.room.name}`
  })
  return read ? { label: read.slice(1), here: read[0] === '1' } : null
}

/** Who wrote a shared note, by character name. */
export function useAuthorName(author: string): string {
  const name = useDungeonStore((state) => {
    const player = (state.dungeon.players ?? []).find((item) => item.id === author)
    return player ? characterNameOf(player) : null
  })
  if (author === 'dm') return 'DM'
  return name ?? 'A player'
}

/** Look at a room on the map in play. */
export function lookAtRoom(floorId: string, roomId: string): void {
  useEditorStore.getState().focusRoom(floorId, roomId, FOCUS_INSET)
}
