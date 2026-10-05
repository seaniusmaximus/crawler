/**
 * Thrown dice and their pop-ups take turns: a roll's toast waits until its dice
 * land, so the result isn't given away mid-tumble. Rolls with no dice thrown
 * (the switch is off, or nothing to throw) show their toast straight away.
 */

/** Rolls with no token to stand by land here: right of where the dice tray opens, near its button. */
export const TRAY_SPOT = { left: 540, fromBottom: 170 }

const inFlight = new Set<string>()
const events = new EventTarget()

export function markThrown(rollId: string): void {
  inFlight.add(rollId)
}

export function markLanded(rollId: string): void {
  if (inFlight.delete(rollId)) events.dispatchEvent(new CustomEvent<string>('landed', { detail: rollId }))
}

/** Run `then` once this roll's dice have landed (now, if none were thrown). Returns a cancel. */
export function whenLanded(rollId: string, then: () => void, backstopMs = 6000): () => void {
  if (!inFlight.has(rollId)) {
    then()
    return () => {}
  }
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    events.removeEventListener('landed', onLanded)
    window.clearTimeout(backstop)
    then()
  }
  const onLanded = (event: Event) => {
    if ((event as CustomEvent<string>).detail === rollId) finish()
  }
  events.addEventListener('landed', onLanded)
  const backstop = window.setTimeout(finish, backstopMs)
  return () => {
    finished = true
    events.removeEventListener('landed', onLanded)
    window.clearTimeout(backstop)
  }
}
