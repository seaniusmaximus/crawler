import { useEffect } from 'react'
import { MapStage } from '../canvas/MapStage.tsx'
import { DiceTray } from '../features/dice/DiceTray.tsx'
import { RollToasts } from '../features/dice/RollToasts.tsx'
import { FloorDock } from '../features/floors/FloorPanel.tsx'
import { RadialMenu } from '../features/menus/RadialMenu.tsx'
import { FoesCard, PartyCard } from '../features/party/PartyList.tsx'
import { TokenSheet } from '../features/party/TokenSheet.tsx'
import { TurnBanner } from '../features/party/TurnBanner.tsx'
import { SeatPrompt } from '../features/session/SeatPrompt.tsx'
import { Brand, TableMenu } from '../features/session/SessionPanel.tsx'
import { StairUsePrompt } from '../features/stairs/StairUsePrompt.tsx'
import { StairsPrompt } from '../features/stairs/StairsPrompt.tsx'
import { CameraControls } from '../features/tools/CameraControls.tsx'
import { ToolPanel } from '../features/tools/ToolPanel.tsx'
import { ViewToggle } from '../features/view/ViewToggle.tsx'
import { useEditorStore } from '../state/editorStore.ts'
import { useSessionStore } from '../state/sessionStore.ts'

/** The map fills the window; every control floats over it in its own corner. */
export function EditorPage() {
  const closeMenu = useEditorStore((state) => state.closeMenu)
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const characterId = useSessionStore((state) => state.character?.characterId ?? '')
  const guest = role === 'guest'
  const tools = !guest && viewMode !== 'player'

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
      onContextMenu={(event) => event.preventDefault()}
    >
      <MapStage />
      <div className="map-vignette" aria-hidden />
      <RollToasts />

      <div className="hud">
        <div className="hud-top-left">
          <Brand />
        </div>
        <div className="hud-top-center">{tools ? <ToolPanel /> : <TurnBanner />}</div>
        <div className="hud-top-right">
          {guest ? null : <ViewToggle />}
          <TableMenu />
        </div>

        <div className="hud-left">
          <PartyCard />
        </div>
        <div className="hud-right">
          <FoesCard />
        </div>
        <TokenSheet />

        <div className="hud-bottom-left">
          <DiceTray />
        </div>
        <div className="hud-bottom-center">
          <FloorDock />
        </div>
        <div className="hud-bottom-right">
          <CameraControls />
        </div>
      </div>

      <RadialMenu />
      <StairsPrompt />
      <StairUsePrompt />
      <SeatPrompt />
    </div>
  )
}
