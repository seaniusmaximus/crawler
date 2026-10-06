import { useEffect } from 'react'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { roomsWithOwnTileset, tilesetById } from '../../tiles/sets/index.ts'

/** Asked when the map's tileset changes while some rooms have their own: do they follow? */
export function TilesetPrompt() {
  const pending = useEditorStore((state) => state.tilesetPrompt)
  const close = useEditorStore((state) => state.closeTilesetPrompt)
  const floors = useDungeonStore((state) => state.dungeon.floors)

  useEffect(() => {
    if (!pending) return
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, close])

  if (!pending) return null
  const id = pending
  const name = tilesetById(id).name
  const count = roomsWithOwnTileset({ floors }, id)

  function apply(keepRoomTilesets: boolean): void {
    useDungeonStore.getState().setTileset(id, keepRoomTilesets)
    close()
  }

  return (
    <div className="dialog-backdrop" onPointerDown={close} role="presentation">
      <div
        className="dialog tileset-dialog"
        role="alertdialog"
        aria-labelledby="tileset-prompt-title"
        aria-describedby="tileset-prompt-body"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="tileset-prompt-title">Switch the map to {name}?</h2>
        <p id="tileset-prompt-body">
          {count === 1 ? 'One room has' : `${count} rooms have`} a tileset of {count === 1 ? 'its' : 'their'} own. Change
          every room to {name}, or keep those rooms as they are?
        </p>
        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={() => apply(true)}>
            Keep room tilesets
          </button>
          <button type="button" className="dialog-button is-primary" onClick={() => apply(false)}>
            Change all rooms
          </button>
          <button type="button" className="dialog-button is-cancel" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
