import { useEffect, type CSSProperties } from 'react'
import { MapStage } from '../canvas/MapStage.tsx'
import { FloorPanel, PANEL_WIDTH } from '../features/floors/FloorPanel.tsx'
import { FloorSwitcher } from '../features/floors/FloorSwitcher.tsx'
import { RadialMenu } from '../features/menus/RadialMenu.tsx'
import { StairsPrompt } from '../features/stairs/StairsPrompt.tsx'
import { CameraControls } from '../features/tools/CameraControls.tsx'
import { useDiceStore } from '../state/diceStore.ts'
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
  const diceOpen = useDiceStore((state) => state.open)

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
          '--dice-width': diceOpen ? '286px' : '86px',
        } as CSSProperties
      }
      onContextMenu={(event) => event.preventDefault()}
    >
      <MapStage />

      <FloorPanel />
      <FloorSwitcher />
      {guest ? null : (
        <div className="top-dock">
          <ViewToggle />
          <ToolPanel />
        </div>
      )}
      <CameraControls />

      <p className="map-hint">
        {guest
          ? 'Connected as a player · Drag your token to move · Rolls from your D&D Beyond sheet land in the shared tray · Q / E rotate view · Page Up / Page Down change floor'
          : viewMode === 'player'
            ? 'Drag a token to move · Right-click a token for size, fly/climb, hide, and status · Click a door or window to open or close it · Q / E rotate view · Page Up / Page Down change floor · V switches DM / Player view'
            : 'Pick a tool above, then drag on the map · Drag a token to move a player · Right-click a token for size, fly/climb, hide, and status · Right-click while dragging to pin a turn · Walls add or erase tiles · Ramp steps between room heights · Link joins rooms without a door · Right-click a room for options · Right-click a door or window to open or close it · Eye icons reveal rooms and tokens to players · V switches DM / Player view · + / – raise and lower a room · Q / E rotate view · Page Up / Page Down change floor'}
      </p>
      <RadialMenu />
      <StairsPrompt />
    </div>
  )
}
