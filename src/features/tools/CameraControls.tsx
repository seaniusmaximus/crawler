import { useEditorStore } from '../../state/editorStore.ts'
import { Icon } from '../../ui/Icon.tsx'

const ZOOM_STEP = 1.2

export function CameraControls() {
  const yaw = useEditorStore((state) => state.camera.yaw)
  const zoom = useEditorStore((state) => state.camera.zoom)
  const rotateView = useEditorStore((state) => state.rotateView)
  const zoomView = useEditorStore((state) => state.zoomView)

  return (
    <div className="panel camera-dock" role="group" aria-label="Camera">
      <button type="button" className="icon-btn is-lg" onClick={() => rotateView(-1)} title="Rotate left (Q)" aria-label="Rotate view left">
        <Icon id="rotateLeft" size={17} />
      </button>
      <span className="compass" title="North" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 26 26">
          <path d="M13 3.5L22.5 13 13 22.5 3.5 13z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M13 0.5l2 3.2h-4z" fill="currentColor" transform={`rotate(${yaw * 90} 13 13)`} />
          <text x="13" y="16.5" textAnchor="middle">
            N
          </text>
        </svg>
      </span>
      <button type="button" className="icon-btn is-lg" onClick={() => rotateView(1)} title="Rotate right (E)" aria-label="Rotate view right">
        <Icon id="rotateRight" size={17} />
      </button>
      <span className="tool-rule" aria-hidden />
      <button type="button" className="icon-btn is-lg" onClick={() => zoomView(1 / ZOOM_STEP)} title="Zoom out" aria-label="Zoom out">
        <Icon id="minus" />
      </button>
      <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
      <button type="button" className="icon-btn is-lg" onClick={() => zoomView(ZOOM_STEP)} title="Zoom in" aria-label="Zoom in">
        <Icon id="plus" />
      </button>
    </div>
  )
}
