import { getDiceBridge } from '../../state/diceStore.ts'
import type { IncomingRoll } from '../../model/dice.ts'
import type { DdbCharacter } from '../../net/protocol.ts'
import { useSessionStore } from '../../state/sessionStore.ts'

const HELLO = 'CRAWLER_DICE_HELLO'
const READY = 'CRAWLER_DICE_READY'
const ROLL = 'CRAWLER_DICE_ROLL'
const CHARACTER = 'CRAWLER_DDB_CHARACTER'

let staleTimer = 0

export function startDiceBridge(): () => void {
  function onMessage(event: MessageEvent): void {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return
    const data = event.data as {
      type?: string
      roll?: IncomingRoll
      rolls?: IncomingRoll[]
      character?: DdbCharacter
    }
    const bridge = getDiceBridge()
    if (data.type === HELLO) {
      bridge.markBridge(true)
      window.clearTimeout(staleTimer)
      staleTimer = window.setTimeout(() => getDiceBridge().markBridge(false), 15000)
      return
    }
    if (data.type === CHARACTER && data.character) {
      useSessionStore.getState().setCharacter(data.character)
      return
    }
    if (data.type !== ROLL) return
    const rolls = (data.rolls ?? (data.roll ? [data.roll] : [])).filter(ownRoll)
    if (rolls.length) bridge.ingest(rolls)
  }

  function ready(): void {
    window.postMessage({ type: READY }, '*')
  }

  window.addEventListener('message', onMessage)
  ready()
  const readyTimer = window.setInterval(ready, 3000)
  return () => {
    window.removeEventListener('message', onMessage)
    window.clearTimeout(staleTimer)
    window.clearInterval(readyTimer)
  }
}

function ownRoll(roll: IncomingRoll): boolean {
  const session = useSessionStore.getState()
  if (session.role !== 'guest') return true
  const mine = session.character?.characterId
  if (!mine) return true
  const id = String(roll.characterId ?? '').trim()
  return !id || id === mine
}
