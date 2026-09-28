import { useEditorStore } from '../../state/editorStore.ts'

export function CameraControls() {
  const yaw = useEditorStore((state) => state.camera.yaw)
  const rotateView = useEditorStore((state) => state.rotateView)

  return (
    <div className="camera-dock" role="group" aria-label="Camera">
      <button
        type="button"
        className="iso-orbit-btn"
        onClick={() => rotateView(-1)}
        title="Rotate view left (Q)"
        aria-label="Rotate view left"
      >
        ↺
        <span className="tool-key">Q</span>
      </button>
      <div className="iso-compass" aria-hidden="true">
        <span
          className="iso-compass-diamond"
          style={{ transform: `rotate(${45 + yaw * 90}deg)` }}
        >
          <span className="iso-compass-n" style={{ transform: `rotate(${-(45 + yaw * 90)}deg)` }}>
            N
          </span>
        </span>
      </div>
      <button
        type="button"
        className="iso-orbit-btn"
        onClick={() => rotateView(1)}
        title="Rotate view right (E)"
        aria-label="Rotate view right"
      >
        ↻
        <span className="tool-key">E</span>
      </button>
    </div>
  )
}
