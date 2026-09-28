import { create } from 'zustand'
import { applyRemote, isRemoteApply } from '../net/remote.ts'
import {
  isNetMessage,
  joinIdFromUrl,
  joinLinks,
  parseJoinInput,
  roomCode,
  type DdbCharacter,
  type NetMessage,
  type SessionPeer,
} from '../net/protocol.ts'
import type { TokenTravel } from '../model/travel.ts'
import { useDiceStore } from './diceStore.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { useEditorStore } from './editorStore.ts'

export type SessionRole = 'solo' | 'host' | 'guest'
export type SessionStatus = 'idle' | 'connecting' | 'live' | 'error'

interface SessionState {
  role: SessionRole
  status: SessionStatus
  roomId: string | null
  joinId: string | null
  link: string | null
  links: string[]
  error: string | null
  peers: SessionPeer[]
  myPlayerId: string | null
  character: DdbCharacter | null
  startHost: () => void
  join: (input: string) => void
  leave: () => void
  setCharacter: (character: DdbCharacter | null) => void
  reportMove: (playerId: string, floorId: string, x: number, y: number) => void
  reportPlayer: (playerId: string) => void
  reportOpening: (floorId: string, roomId: string, x: number, y: number) => void
  reportTravel: (travel: TokenTravel | null) => void
  reportFocus: (floorId: string, roomId: string) => void
}

const clientId = crypto.randomUUID()

let socket: WebSocket | null = null
let snapshotTimer = 0
let lastDiceIds = ''
let wired = false

function destroySocket(): void {
  window.clearTimeout(snapshotTimer)
  socket?.close()
  socket = null
}

function send(message: NetMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) return
  try {
    socket.send(JSON.stringify(message))
  } catch {
    // Drop a single failed packet; the next snapshot will catch up.
  }
}

function claims(): Record<string, string | null> {
  const you: Record<string, string | null> = {}
  for (const peer of useSessionStore.getState().peers) you[peer.id] = peer.playerId
  return you
}

function snapshotMessage(): NetMessage {
  return {
    type: 'snapshot',
    dungeon: useDungeonStore.getState().dungeon,
    rolls: useDiceStore.getState().rolls,
    you: claims(),
  }
}

function scheduleSnapshot(): void {
  if (useSessionStore.getState().role !== 'host' || isRemoteApply()) return
  window.clearTimeout(snapshotTimer)
  snapshotTimer = window.setTimeout(() => send(snapshotMessage()), 120)
}

function applySnapshot(message: Extract<NetMessage, { type: 'snapshot' }>): void {
  const session = useSessionStore.getState()
  const mine = session.myPlayerId ?? message.you?.[clientId] ?? null
  const prevFloor = mine
    ? useDungeonStore.getState().dungeon.players.find((player) => player.id === mine)?.floorId
    : null
  applyRemote(() => {
    useDungeonStore.getState().replaceDungeon(message.dungeon)
    useDiceStore.getState().replaceRolls(message.rolls)
    const claimed = message.you?.[clientId]
    if (claimed) useSessionStore.setState({ myPlayerId: claimed })
  })
  const playerId = useSessionStore.getState().myPlayerId
  const player = playerId
    ? useDungeonStore.getState().dungeon.players.find((item) => item.id === playerId)
    : null
  if (player && prevFloor && player.floorId !== prevFloor) {
    useEditorStore.getState().focusPlayer(player.id, 260)
  }
}

function upsertPeer(peers: SessionPeer[], next: SessionPeer): SessionPeer[] {
  return [...peers.filter((item) => item.id !== next.id), next]
}

function handleHostMessage(message: NetMessage): void {
  const session = useSessionStore.getState()
  if (message.type === 'hello' || message.type === 'claim') {
    const character = message.type === 'claim' ? message.character : null
    const id = message.clientId
    let playerId = session.peers.find((item) => item.id === id)?.playerId ?? null
    if (character) {
      applyRemote(() => {
        playerId = useDungeonStore.getState().claimCharacter(character)
      })
    }
    useSessionStore.setState({
      peers: upsertPeer(session.peers, {
        id,
        playerId,
        name: character?.name || 'Player',
      }),
    })
    send(snapshotMessage())
    return
  }
  if (message.type === 'move') {
    applyRemote(() => {
      useDungeonStore.getState().movePlayer(message.playerId, message.floorId, message.x, message.y)
    })
    send(snapshotMessage())
    return
  }
  if (message.type === 'player') {
    applyRemote(() => useDungeonStore.getState().upsertPlayer(message.player))
    send(snapshotMessage())
    return
  }
  if (message.type === 'opening') {
    applyRemote(() => {
      useDungeonStore
        .getState()
        .toggleConnectedOpenings(message.floorId, message.roomId, message.x, message.y)
    })
    send(snapshotMessage())
    return
  }
  if (message.type === 'dice') {
    applyRemote(() => useDiceStore.getState().ingest(message.rolls))
    send({ type: 'dice', rolls: message.rolls })
    return
  }
  if (message.type === 'travel') {
    applyRemote(() => useDungeonStore.getState().setTravel(message.travel))
    send(snapshotMessage())
  }
}

function handleGuestMessage(message: NetMessage): void {
  if (message.type === 'snapshot') {
    applySnapshot(message)
    return
  }
  if (message.type === 'dice') {
    applyRemote(() => useDiceStore.getState().ingest(message.rolls))
    return
  }
  if (message.type === 'focus') {
    useEditorStore.getState().focusRoom(message.floorId, message.roomId, 260)
  }
}

function onSocketMessage(event: MessageEvent): void {
  let data: unknown = event.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return
    }
  }
  if (!isNetMessage(data)) return
  if (useSessionStore.getState().role === 'host') handleHostMessage(data)
  else handleGuestMessage(data)
}

async function tableOrigins(): Promise<string[]> {
  try {
    const response = await fetch('/crawler-sync/info')
    if (!response.ok) throw new Error('relay missing')
    const body = (await response.json()) as { origins?: string[] }
    if (body.origins?.length) return body.origins
  } catch {
    // Fall back to this page's origin when the relay info route is missing.
  }
  return [window.location.origin]
}

function openSocket(room: string, role: SessionRole): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/crawler-sync?room=${encodeURIComponent(room)}&role=${role}&id=${encodeURIComponent(clientId)}`
    const next = new WebSocket(url)
    socket = next
    next.addEventListener('message', onSocketMessage)
    next.addEventListener('open', () => resolve(), { once: true })
    next.addEventListener('error', () => reject(new Error('Could not reach the table relay')), { once: true })
    next.addEventListener('close', () => {
      if (socket !== next) return
      socket = null
      const session = useSessionStore.getState()
      if (session.role === 'solo' || session.status === 'idle') return
      useSessionStore.setState({
        status: 'error',
        error: 'Disconnected from the table. Rejoin with the DM link.',
      })
    })
  })
}

function wireSync(): void {
  if (wired) return
  wired = true
  lastDiceIds = useDiceStore.getState().rolls.map((roll) => roll.id).join()
  useDungeonStore.subscribe((state, prev) => {
    if (state.dungeon === prev.dungeon || isRemoteApply()) return
    const session = useSessionStore.getState()
    if (session.role === 'host') scheduleSnapshot()
    if (session.role === 'guest' && session.myPlayerId) {
      const player = state.dungeon.players.find((item) => item.id === session.myPlayerId)
      const before = prev.dungeon.players.find((item) => item.id === session.myPlayerId)
      if (player && player !== before) send({ type: 'player', player })
    }
  })
  useDiceStore.subscribe((state) => {
    if (isRemoteApply()) {
      lastDiceIds = state.rolls.map((roll) => roll.id).join()
      return
    }
    const ids = state.rolls.map((roll) => roll.id).join()
    if (ids === lastDiceIds) return
    const known = new Set(lastDiceIds.split(',').filter(Boolean))
    const added = state.rolls.filter((roll) => !known.has(roll.id))
    lastDiceIds = ids
    if (added.length === 0) return
    const session = useSessionStore.getState()
    if (session.role === 'host' || session.role === 'guest') send({ type: 'dice', rolls: added })
  })
}

export function canControlPlayer(playerId: string): boolean {
  const session = useSessionStore.getState()
  const token = useDungeonStore.getState().dungeon.players.find((player) => player.id === playerId)
  if (token?.kind === 'monster') return session.role !== 'guest'
  if (session.role !== 'guest') return true
  return session.myPlayerId === playerId
}

export const useSessionStore = create<SessionState>((set, get) => ({
  role: 'solo',
  status: 'idle',
  roomId: null,
  joinId: null,
  link: null,
  links: [],
  error: null,
  peers: [],
  myPlayerId: null,
  character: null,

  startHost: () => {
    const room = roomCode()
    destroySocket()
    wireSync()
    set({
      role: 'host',
      status: 'connecting',
      roomId: room,
      joinId: null,
      error: null,
      peers: [],
      myPlayerId: null,
      links: [],
      link: null,
    })
    useEditorStore.getState().setViewMode('dm')
    void (async () => {
      try {
        const origins = await tableOrigins()
        const links = joinLinks(origins, room)
        await openSocket(room, 'host')
        const character = get().character
        if (character) applyRemote(() => useDungeonStore.getState().claimCharacter(character))
        set({
          status: 'live',
          links,
          link: links.find((item) => !item.includes('localhost')) ?? links[0] ?? null,
        })
      } catch (error) {
        set({
          status: 'error',
          error: error instanceof Error ? error.message : 'Could not start a table',
        })
      }
    })()
  },

  join: (input) => {
    const parsed = parseJoinInput(input)
    if (!parsed.room) return
    if (parsed.href) {
      const target = new URL(parsed.href)
      if (target.origin !== window.location.origin) {
        window.location.assign(target.href)
        return
      }
    }
    destroySocket()
    wireSync()
    set({
      role: 'guest',
      status: 'connecting',
      roomId: parsed.room,
      joinId: parsed.room,
      error: null,
      peers: [],
      myPlayerId: null,
      link: null,
      links: [],
    })
    useEditorStore.getState().setViewMode('player')
    void (async () => {
      try {
        await openSocket(parsed.room, 'guest')
        set({ status: 'live' })
        send({ type: 'hello', clientId })
        send({ type: 'claim', clientId, character: get().character })
      } catch (error) {
        set({
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Could not join. Open the DM’s join link, not your own localhost.',
        })
      }
    })()
  },

  leave: () => {
    destroySocket()
    set({
      role: 'solo',
      status: 'idle',
      roomId: null,
      joinId: null,
      link: null,
      links: [],
      error: null,
      peers: [],
      myPlayerId: null,
    })
  },

  setCharacter: (character) => {
    set({ character })
    const session = get()
    if (session.role === 'host' && character) {
      applyRemote(() => useDungeonStore.getState().claimCharacter(character))
      scheduleSnapshot()
    }
    if (session.role === 'guest' && session.status === 'live') {
      send({ type: 'claim', clientId, character })
    }
  },

  reportMove: (playerId, floorId, x, y) => {
    if (get().role !== 'guest') return
    send({ type: 'move', playerId, floorId, x, y })
  },

  reportPlayer: (playerId) => {
    if (get().role !== 'guest') return
    const player = useDungeonStore.getState().dungeon.players.find((item) => item.id === playerId)
    if (player) send({ type: 'player', player })
  },

  reportOpening: (floorId, roomId, x, y) => {
    if (get().role !== 'guest') {
      useDungeonStore.getState().toggleConnectedOpenings(floorId, roomId, x, y)
      return
    }
    send({ type: 'opening', floorId, roomId, x, y })
  },

  reportTravel: (travel) => {
    if (get().role !== 'guest') return
    send({ type: 'travel', travel })
  },

  reportFocus: (floorId, roomId) => {
    if (get().role === 'guest') return
    send({ type: 'focus', floorId, roomId })
  },
}))

export function bootSessionFromUrl(): void {
  const joinId = joinIdFromUrl()
  const session = useSessionStore.getState()
  if (joinId && session.role === 'solo') session.join(joinId)
}
