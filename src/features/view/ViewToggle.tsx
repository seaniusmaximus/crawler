import { useEditorStore } from '../../state/editorStore.ts'

export function ViewToggle() {
  const mode = useEditorStore((state) => state.viewMode)
  const setViewMode = useEditorStore((state) => state.setViewMode)

  return (
    <div className="view-toggle" role="group" aria-label="Map view">
      <button
        type="button"
        className={mode === 'dm' ? 'is-active' : ''}
        aria-pressed={mode === 'dm'}
        onClick={() => setViewMode('dm')}
        title="Dungeon Master view — see everything (V)"
      >
        DM
      </button>
      <button
        type="button"
        className={mode === 'player' ? 'is-active' : ''}
        aria-pressed={mode === 'player'}
        onClick={() => setViewMode('player')}
        title="Player view — only revealed rooms and tokens (V)"
      >
        Player
      </button>
    </div>
  )
}
