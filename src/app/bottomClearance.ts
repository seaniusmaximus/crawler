import { useLayoutEffect, type RefObject } from 'react'

/** Room kept between the chest row and the floor tower. */
const GAP = 24

/**
 * The floor tower sits in the middle of the bottom edge, unless the chest row on the
 * left reaches it: then it slides right just far enough to clear the row. The slide
 * goes out as --clear-left on the centre dock, which its transform adds.
 */
export function useBottomClearance(
  row: RefObject<HTMLElement | null>,
  centre: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const left = row.current
    const middle = centre.current
    const hud = middle?.parentElement
    if (!left || !middle || !hud) return
    const update = (): void => {
      const box = hud.getBoundingClientRect()
      const rowRight = left.getBoundingClientRect().right - box.left
      const centredLeft = box.width / 2 - middle.offsetWidth / 2
      const shift = Math.max(0, Math.ceil(rowRight + GAP - centredLeft))
      middle.style.setProperty('--clear-left', `${shift}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(left)
    observer.observe(middle)
    observer.observe(hud)
    return () => observer.disconnect()
  }, [row, centre])
}
