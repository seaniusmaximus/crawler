import { useEffect, useRef } from 'react'
import { MapEngine } from './MapEngine.ts'

export function MapStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = new MapEngine(canvas)
    void engine.start()
    return () => engine.destroy()
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="map-stage"
      role="application"
      aria-label="Dungeon map"
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
