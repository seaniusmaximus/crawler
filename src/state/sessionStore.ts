import { create } from 'zustand'
import { FOCUS_INSET } from '../app/layout.ts'
import { applyRemote, isRemoteApply } from '../net/remote.ts'
import {
  isNetMessage,
  joinIdFromUrl,
  joinLinks,
  parseJoinInput,
  type DdbCharacter,
  type NetMessage,
  type SessionPeer,
} from '../net/protocol.ts'
import type { TokenTravel } from '../model/travel.ts'
import { requestDdbCharacter } from '../features/dice/bridge.ts'
import { useDiceStore } from './diceStore.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { useEditorStore } from './editorStore.ts'

export type SessionRole = 'solo' | 'host' | 'guest'
export type SessionStatus = 'idle' | 'connecting' | 'reconnecting' | 'live' | 'error'

/** How a joining player wants to sit at the table. */
export type SeatChoice = { mode: 'ddb' } | { mode: 'native'; name: string }

interface SessionState {
  role: SessionRole
  status: SessionStatus
  roomId: string | null
  joinId: string | null
  link: string | null
  links: string[]
  error: string | null
  /** Whether the DM is connected; guests keep the last table while the DM is away. */
  hostOnline: boolean
  peers: SessionPeer[]
  myPlayerId: string | null
  character: DdbCharacter | null
  /** The guest's seat; null until they pick one (or if they only watch). */
  seat: SeatChoice | null
  seatPrompt: boolean
  /** The campaign being hosted, for the DM's own display. */
  campaignName: string | null
  /** Open a saved campaign; `restore` loads its saved map instead of sending this tab's. */
  hostCampaign: (campaign: ActiveCampaign, restore: boolean) => void
  /** Save and step away; the campaign stays in the DM's list. */
  closeTable: () => void
  join: (input: string) => void
  leave: () => void
  setCharacter: (character: DdbCharacter | null) => void
  chooseSeat: (seat: SeatChoice) => void
  setSeatPrompt: (open: boolean) => void
  reportMove: (playerId: string, floorId: string, x: number, y: number) => void
  reportPlayer: (playerId: string) => void
  reportOpening: (floorId: string, roomId: string, x: number, y: number) => void
  reportTravel: (travel: TokenTravel | null) => void
  reportFocus: (floorId: string, roomId: string) => void
}

const clientId = crypto.randomUUID()

/** Relay close codes that mean stop retrying (see worker/index.ts). */
const CLOSE_REPLACED = 4001
const CLOSE_SIGNED_OUT = 4002
const CLOSE_NOT_HOST = 4003
const CLOSE_NO_TABLE = 4004

const ACTIVE_KEY = 'crawler.activeCampaign'
const SEAT_KEY = 'crawler.seat.'

/** A guest's seat, remembered per table so a reload doesn't ask again or spawn a twin. */
type SavedSeat = SeatChoice & { playerId?: string | null }

export interface ActiveCampaign {
  id: string
  name: string
}

let socket: WebSocket | null = null
let snapshotTimer = 0
let retryTimer = 0
let retries = 0
let lastDiceIds = ''
let wired = false
/** Set until the relay's first presence after each (re)connect. */
let awaitingPresence = false
/** A DM resuming after a reload adopts the relay's saved table once. */
let restorePending = false

/** The campaign this tab is hosting, so a reload picks it back up. */
function readActive(): ActiveCampaign | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<ActiveCampaign>) : null
    return parsed?.id ? { id: parsed.id, name: String(parsed.name ?? '') } : null
  } catch {
    return null
  }
}

function writeActive(campaign: ActiveCampaign | null): void {
  try {
    if (campaign) window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(campaign))
    else window.localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Storage blocked: the campaign is still saved, it just won't reopen on reload.
  }
}

function readSeat(room: string): SavedSeat | null {
  try {
    const raw = window.localStorage.getItem(SEAT_KEY + room)
    const parsed = raw ? (JSON.parse(raw) as Partial<SavedSeat>) : null
    if (parsed?.mode === 'ddb') return { mode: 'ddb' }
    if (parsed?.mode === 'native') {
      return { mode: 'native', name: String(parsed.name ?? ''), playerId: parsed.playerId ?? null }
    }
    return null
  } catch {
    return null
  }
}

function writeSeat(room: string, seat: SavedSeat): void {
  try {
    window.localStorage.setItem(SEAT_KEY + room, JSON.stringify(seat))
  } catch {
    // Storage blocked: the player is asked again after a reload.
  }
}

function destroySocket(): void {
  window.clearTimeout(snapshotTimer)
  window.clearTimeout(retryTimer)
  const old = socket
  socket = null
  old?.close()
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
  if (useSessionStore.getState().role !== 'host' || isRemoteApply() || restorePending) return
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
  const { seat, roomId, myPlayerId } = useSessionStore.getState()
  if (seat?.mode === 'native' && roomId && myPlayerId) writeSeat(roomId, { ...seat, playerId: myPlayerId })
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

function sendSeat(): void {
  const { seat, character, myPlayerId, roomId } = useSessionStore.getState()
  if (seat?.mode === 'ddb') send({ type: 'claim', clientId, character })
  if (seat?.mode === 'native') {
    const saved = roomId ? readSeat(roomId) : null
    const playerId = myPlayerId ?? (saved?.mode === 'native' ? (saved.playerId ?? null) : null)
    send({ type: 'spawn', clientId, name: seat.name, playerId })
  }
}

function greet(): void {
  send({ type: 'hello', clientId })
  sendSeat()
}

function handleHostMessage(message: NetMessage): void {
  const session = useSessionStore.getState()
  if (message.type === 'snapshot') {
    // Only the relay sends a host a snapshot: the table as it was last saved.
    if (!restorePending) return
    applyRemote(() => {
      useDungeonStore.getState().replaceDungeon(message.dungeon)
      useDiceStore.getState().replaceRolls(message.rolls)
    })
    return
  }
  if (message.type === 'presence') {
    const live = new Set(message.guests)
    useSessionStore.setState({ hostOnline: true, peers: session.peers.filter((peer) => live.has(peer.id)) })
    if (awaitingPresence) {
      // The relay sends any saved snapshot before presence, so a restore is done.
      awaitingPresence = false
      restorePending = false
      const character = session.character
      if (character) applyRemote(() => useDungeonStore.getState().claimCharacter(character))
      send(snapshotMessage())
    }
    return
  }
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
  if (message.type === 'spawn') {
    const id = message.clientId
    // A playerId only comes from this browser's saved seat, so another tab of the
    // same player shares the token rather than spawning a twin.
    let playerId: string | null = null
    applyRemote(() => {
      playerId = useDungeonStore.getState().spawnPlayer(message.name, message.playerId)
    })
    useSessionStore.setState({
      peers: upsertPeer(session.peers, { id, playerId, name: message.name.trim() || 'Player' }),
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
  if (message.type === 'presence') {
    const wasOnline = useSessionStore.getState().hostOnline
    useSessionStore.setState({ hostOnline: message.host })
    // Introduce ourselves on every (re)connect, and again whenever the DM returns.
    if (message.host && (awaitingPresence || !wasOnline)) greet()
    awaitingPresence = false
    return
  }
  if (message.type === 'snapshot') {
    applySnapshot(message)
    return
  }
  if (message.type === 'dice') {
    applyRemote(() => useDiceStore.getState().ingest(message.rolls))
    return
  }
  if (message.type === 'focus') {
    useEditorStore.getState().focusRoom(message.floorId, message.roomId, FOCUS_INSET)
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
  if (data.type === 'kicked') {
    const ws = socket
    socketEnded(data.code)
    ws?.close()
    return
  }
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

function scheduleReconnect(): void {
  window.clearTimeout(retryTimer)
  const delay = Math.min(15_000, 500 * 2 ** retries)
  retries += 1
  retryTimer = window.setTimeout(() => {
    const session = useSessionStore.getState()
    if (session.role === 'solo' || !session.roomId) return
    connect(session.roomId, session.role)
  }, delay)
}

function closeReason(code: number, role: SessionRole): string | null {
  if (code === CLOSE_NO_TABLE) {
    return role === 'host'
      ? 'This campaign no longer exists.'
      : 'No table with that code. Ask the DM for a fresh join link.'
  }
  if (code === CLOSE_SIGNED_OUT) return 'Sign in with Google to host this campaign.'
  if (code === CLOSE_NOT_HOST) return 'This campaign belongs to a different Google account.'
  if (code === CLOSE_REPLACED) return 'This table was opened in another tab.'
  return null
}

function connect(room: string, role: SessionRole): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const params = new URLSearchParams({ room, role, id: clientId })
  const next = new WebSocket(`${protocol}//${window.location.host}/crawler-sync?${params}`)
  socket = next
  next.addEventListener('message', onSocketMessage)
  next.addEventListener('open', () => {
    if (socket !== next) return
    retries = 0
    awaitingPresence = true
    useSessionStore.setState({ status: 'live', error: null })
  })
  next.addEventListener('close', (event) => {
    if (socket === next) socketEnded(event.code)
  })
}

/** The current socket is gone, by close frame or a `kicked` message: give up or retry. */
function socketEnded(code: number): void {
  socket = null
  const session = useSessionStore.getState()
  if (session.role === 'solo' || session.status === 'idle') return
  const final = closeReason(code, session.role)
  if (final) {
    // Keep the campaign to reopen after signing in; forget one that's gone or not ours.
    if (session.role === 'host' && (code === CLOSE_NO_TABLE || code === CLOSE_NOT_HOST)) writeActive(null)
    if (session.role === 'host') {
      // Back to the solo table with the map still in hand; the menu explains why.
      useSessionStore.setState({
        role: 'solo',
        status: 'idle',
        roomId: null,
        campaignName: null,
        link: null,
        links: [],
        peers: [],
        error: final,
      })
      return
    }
    useSessionStore.setState({ status: 'error', error: final, hostOnline: false })
    return
  }
  useSessionStore.setState({ status: 'reconnecting', hostOnline: false })
  scheduleReconnect()
}

function hostTable(campaign: ActiveCampaign, restore: boolean): void {
  destroySocket()
  wireSync()
  writeActive(campaign)
  restorePending = restore
  const room = campaign.id
  useSessionStore.setState({
    role: 'host',
    status: 'connecting',
    roomId: room,
    campaignName: campaign.name,
    joinId: null,
    error: null,
    hostOnline: true,
    peers: [],
    myPlayerId: null,
    links: [],
    link: null,
  })
  useEditorStore.getState().setViewMode('dm')
  connect(room, 'host')
  void tableOrigins().then((origins) => {
    if (useSessionStore.getState().roomId !== room) return
    const links = joinLinks(origins, room)
    useSessionStore.setState({
      links,
      link: links.find((item) => !item.includes('localhost')) ?? links[0] ?? null,
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
  hostOnline: false,
  peers: [],
  myPlayerId: null,
  character: null,
  seat: null,
  seatPrompt: false,

  campaignName: null,

  hostCampaign: (campaign, restore) => hostTable(campaign, restore),

  closeTable: () => {
    if (get().role !== 'host') return
    // Flush any pending change so the saved copy matches what the DM sees.
    if (!restorePending) send(snapshotMessage())
    get().leave()
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
    const saved = readSeat(parsed.room)
    if (saved?.mode === 'ddb') requestDdbCharacter()
    set({
      seat: saved,
      seatPrompt: !saved,
      role: 'guest',
      status: 'connecting',
      roomId: parsed.room,
      joinId: parsed.room,
      error: null,
      hostOnline: false,
      peers: [],
      myPlayerId: null,
      link: null,
      links: [],
    })
    useEditorStore.getState().setViewMode('player')
    connect(parsed.room, 'guest')
  },

  leave: () => {
    if (get().role === 'host') writeActive(null)
    restorePending = false
    destroySocket()
    set({
      role: 'solo',
      status: 'idle',
      roomId: null,
      joinId: null,
      link: null,
      links: [],
      error: null,
      hostOnline: false,
      peers: [],
      myPlayerId: null,
      seat: null,
      seatPrompt: false,
      campaignName: null,
    })
  },

  setCharacter: (character) => {
    set({ character })
    const session = get()
    if (session.role === 'host' && character) {
      applyRemote(() => useDungeonStore.getState().claimCharacter(character))
      scheduleSnapshot()
    }
    if (session.role === 'guest' && session.seat?.mode === 'ddb') {
      send({ type: 'claim', clientId, character })
      if (character) set({ seatPrompt: false })
    }
  },

  chooseSeat: (seat) => {
    const session = get()
    if (session.role !== 'guest' || !session.roomId) return
    writeSeat(session.roomId, seat)
    // Switching seats starts fresh; the host keeps any old token on the map.
    set({ seat, myPlayerId: null, seatPrompt: seat.mode === 'ddb' && !session.character })
    if (seat.mode === 'ddb' && !session.character) requestDdbCharacter()
    sendSeat()
  },

  setSeatPrompt: (open) => set({ seatPrompt: open }),

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
  const session = useSessionStore.getState()
  if (session.role !== 'solo') return
  const joinId = joinIdFromUrl()
  if (joinId) {
    session.join(joinId)
    return
  }
  // A DM who reloads mid-session picks the same table back up from the relay.
  const active = readActive()
  if (active) hostTable(active, true)
}
