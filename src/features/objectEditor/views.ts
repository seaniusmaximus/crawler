import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Draft } from './useDraft.ts'

/** What every view of the object editor is handed. */
export interface ViewProps {
  draft: Draft
  /** Selected parts by index; the last is the one the handles and inspector work on. */
  selected: readonly number[]
  hover: number | null
  /** Cells to snap to; 0 for none. Alt held while dragging ignores it. */
  snapStep: number
  /** Pick a part (null for none); `additive` toggles it in or out of the selection instead. */
  onSelect: (index: number | null, additive: boolean) => void
  onSelectMany: (indices: readonly number[], additive: boolean) => void
  onHover: (index: number | null) => void
}

export interface Point {
  x: number
  y: number
}

/** A pointer position in the SVG's own units. */
export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: point.x, y: point.y }
}

/**
 * Follow a drag that started on `event` until the pointer is let go, reporting
 * each position in the SVG's units. Listens on the window so a drag can leave the view.
 */
export function followDrag(
  event: ReactPointerEvent,
  svg: SVGSVGElement,
  onMove: (point: Point, event: PointerEvent) => void,
  onEnd: (moved: boolean) => void,
): Point {
  event.preventDefault()
  event.stopPropagation()
  const start = { x: event.clientX, y: event.clientY }
  let moved = false
  const move = (e: PointerEvent) => {
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return
    moved = true
    onMove(svgPoint(svg, e.clientX, e.clientY), e)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    onEnd(moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  return svgPoint(svg, event.clientX, event.clientY)
}

/** How many SVG units one screen pixel spans, kept current as the view resizes. */
export function usePixel(ref: RefObject<SVGSVGElement | null>, viewBox: string): number {
  const [pixel, setPixel] = useState(0.01)
  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    const measure = () => {
      const ctm = svg.getScreenCTM()
      if (ctm && ctm.a > 0) setPixel(1 / ctm.a)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [ref, viewBox])
  return pixel
}

/** Shift, Ctrl or Cmd held: add to the selection rather than replace it. */
export function isAdditive(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey
}

export const SELECT = '#e3bf6a'
export const HOVER = 'rgba(255, 255, 255, 0.75)'
export const OUTSIDE = '#d9625e'
