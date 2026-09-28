import { useEffect } from 'react'
import type { StairLanding } from '../../model/stairs.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'

export function StairsPrompt() {
  const landings = useEditorStore((state) => state.stairsPrompt)
  const close = useEditorStore((state) => state.closeStairsPrompt)

  useEffect(() => {
    if (!landings) return
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [landings, close])

  if (!landings) return null

  const leftovers = landings
  const floors = unique(leftovers.map((item) => item.floorName))
  const floorList = floors.length === 1 ? floors[0] : `${floors.slice(0, -1).join(', ')} and ${floors[floors.length - 1]}`

  function remove(): void {
    useDungeonStore.getState().clearStairLandings(leftovers)
    close()
  }

  return (
    <div className="dialog-backdrop" onPointerDown={close} role="presentation">
      <div
        className="dialog"
        role="alertdialog"
        aria-labelledby="stairs-prompt-title"
        aria-describedby="stairs-prompt-body"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id="stairs-prompt-title">Stairs unlinked</h2>
        <p id="stairs-prompt-body">
          Those stairs no longer connect to {floorList}. Leftover staircases there now lead nowhere.
        </p>
        <ul className="dialog-list">
          {uniqueRooms(leftovers).map((item) => (
            <li key={`${item.floorId}:${item.roomId}`}>
              {item.roomName}
              <span> on {item.floorName}</span>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={close}>
            Leave them
          </button>
          <button type="button" className="dialog-button is-danger" onClick={remove}>
            Remove leftovers
          </button>
        </div>
      </div>
    </div>
  )
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function uniqueRooms(landings: readonly StairLanding[]): StairLanding[] {
  const seen = new Set<string>()
  return landings.filter((item) => {
    const key = `${item.floorId}:${item.roomId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
