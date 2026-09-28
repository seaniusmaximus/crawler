import { useEffect, type CSSProperties } from 'react'
import { MapStage } from '../canvas/MapStage.tsx'
import { FloorPanel, PANEL_WIDTH } from '../features/floors/FloorPanel.tsx'
import { FloorSwitcher } from '../features/floors/FloorSwitcher.tsx'
import { RadialMenu } from '../features/menus/RadialMenu.tsx'
import { StairsPrompt } from '../features/stairs/StairsPrompt.tsx'
import { CameraControls } from '../features/tools/CameraControls.tsx'
import { ToolPanel } from '../features/tools/ToolPanel.tsx'
import { ViewToggle } from '../features/view/ViewToggle.tsx'
import { useEditorStore } from '../state/editorStore.ts'
import { useSessionStore } from '../state/sessionStore.ts'

export function EditorPage() {
  const closeMenu = useEditorStore((state) => state.closeMenu)
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const characterId = useSessionStore((state) => state.character?.characterId ?? '')
  const guest = role === 'guest'

  useEffect(() => {
    function onPointerDown(): void {
      closeMenu()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [closeMenu])

  return (
    <div
      className={`editor${viewMode === 'player' ? ' is-player' : ''}`}
      data-crawler="1"
      data-crawler-role={role}
      data-crawler-character-id={characterId}
      style={
        {
          '--panel-width': `${PANEL_WIDTH}px`,
        } as CSSProperties
      }
      onContextMenu={(event) => event.preventDefault()}
    >
      <MapStage />

      <FloorPanel />
      <div className="right-dock">
        <FloorSwitcher />
        <CameraControls />
      </div>
      {guest ? null : (
        <div className="top-dock">
          <ViewToggle />
          <ToolPanel />
        </div>
      )}
      <RadialMenu />
      <StairsPrompt />
    </div>
  )
}
