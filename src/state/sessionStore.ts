import { create } from 'zustand'
import { FOCUS_INSET } from '../app/layout.ts'
import { isEmbedded, knownAssetUrl, uploadImage } from '../net/assets.ts'
import { diffDungeon } from '../net/patch.ts'
import { applyRemote, isRemoteApply } from '../net/remote.ts'
import {
  isNetMessage,
  joinIdFromUrl,
  joinLinks,
  parseJoinInput,
  type DdbCharacter,
  type NetMessage,
  type SessionPeer,
  type SnapshotMessage,
} from '../net/protocol.ts'
import { isMonster } from '../model/players.ts'
import type { TokenTravel } from '../model/travel.ts'
import type { Dungeon } from '../model/types.ts'
import { requestDdbCharacter } from '../features/dice/bridge.ts'
import { setTableRoller, useDiceStore } from './diceStore.ts'
import { useDungeonStore } from './dungeonStore.ts'
import { useEditorStore } from './editorStore.ts'
import { useTravelStore } from './travelStore.ts'

export type SessionRole = 'solo' | 'host' | 'guest'
export type SessionStatus = 'idle' | 'connecting' | 'reconnecting' | 'live' | 'error'

/**
 * Whether the map in this tab is safe on the server: 'idle' when there's nothing
 * to save, 'unsaved' for edits made without a campaign open, 'saving' until the
 * relay confirms, 'offline' when the DM is hosting but disconnected.
 */
export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'offline'

/** How a joining player wants to sit at the table. */
/**
 * `playerId` on a native seat is an existing token the player picked to take back;
 * `characterId` is that token's D&D Beyond character, whose sheet keeps syncing to it.
 */
export type SeatChoice =
  | { mode: 'ddb' }
  | { mode: 'native'; name: string; playerId?: string | null; characterId?: string | null }

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
  /** Guests: who holds which token (client id → player id), from the DM's latest snapshot. */
  claims: Record<string, string | null>
  /** Guests: the other players connected right now, from the relay. */
  presentGuests: string[]
  myPlayerId: string | null
  character: DdbCharacter | null
  /** The guest's seat; null until they pick one (or if they only watch). */
  seat: SeatChoice | null
  seatPrompt: boolean
  /** The campaign being hosted, for the DM's own display. */
  campaignName: string | null
  saveState: SaveState
  /** When the relay last confirmed a save of this campaign. */
  savedAt: number | null
  /** Bumped whenever the campaign's maps change, so lists can refresh. */
  mapsVersion: number
  /** The map the party is being moved to, while that's under way. */
  mapBusy: string | null
  mapError: string | null
  /** Move the party (and every player's screen) to another map of the campaign. */
  switchMap: (mapId: string) => void
  /** Something changed in the maps list (created, renamed, deleted). */
  touchMaps: () => void
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

/** This tab's id at the table, as it appears in the DM's claims. */
export function myClientId(): string {
  return clientId
}

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
let retryTimer = 0
let retries = 0
let lastDiceIds = ''
let wired = false
/** Set until the relay's first presence after each (re)connect. */
let awaitingPresence = false
/** A DM resuming after a reload adopts the relay's saved table once. */
let restorePending = false
/** Numbers each DM snapshot so the relay's "saved" reply can be matched to the latest one. */
let snapshotSeq = 0
let lastSentSeq = 0

/**
 * Keeping players in step (DM side): players get a full snapshot when they join or
 * fall out of step, and otherwise just what changed, as numbered patches. A full
 * copy goes to the relay for saving at most every SAVE_MS, and isn't sent on to
 * the players.
 */
const PATCH_MS = 30
const SAVE_MS = 1500
/** The map as the players last received it; the next patch is the difference from this. */
let synced: Dungeon | null = null
let syncedYou = ''
/**
 * The DM's revision: bumped by every snapshot or patch sent to players. Starts at a
 * random point so a reloaded DM tab can never line up with a player's old revision.
 */
let rev = Math.floor(Math.random() * 1_000_000_000)
let patchTimer = 0
let fullTimer = 0
let saveTimer = 0
let saveQueued = false
/** Players whose position must go out even if unchanged (a move the DM refused). */
let forced = new Set<string>()
/** Resend who holds which token even if unchanged: the answer to a refused pick. */
let resendClaims = false
/** Player side: the DM revision this tab's map is at, or null before the first snapshot. */
let guestRev: number | null = null
let resyncTimer = 0
/** A token picked from the "played here before" list, until the DM confirms or refuses it. */
let pickPending = false
/** Live token paths go out at most this often while dragging; starts and ends go at once. */
const TRAVEL_MS = 66
let travelTimer = 0
let travelQueued: TokenTravel | null = null
let travelSentAt = 0
/** The token whose path this tab last announced, so "path ended" can name it. */
let travelPlayerId: string | null = null
/** Close table waits on this for the relay to confirm the final save. */
let closeWaiter: (() => void) | null = null

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
      return {
        mode: 'native',
        name: String(parsed.name ?? ''),
        playerId: parsed.playerId ?? null,
        characterId: parsed.characterId ?? null,
      }
    }
    return null
  } catch {
    return null
  }
}

function writeSeat(room: string, seat: SavedSeat | null): void {
  try {
    if (seat) window.localStorage.setItem(SEAT_KEY + room, JSON.stringify(seat))
    else window.localStorage.removeItem(SEAT_KEY + room)
  } catch {
    // Storage blocked: the player is asked again after a reload.
  }
}

function destroySocket(): void {
  window.clearTimeout(patchTimer)
  window.clearTimeout(fullTimer)
  window.clearTimeout(saveTimer)
  window.clearTimeout(resyncTimer)
  patchTimer = fullTimer = saveTimer = resyncTimer = 0
  saveQueued = false
  synced = null
  guestRev = null
  forced = new Set()
  window.clearTimeout(retryTimer)
  window.clearTimeout(travelTimer)
  travelQueued = null
  travelPlayerId = null
  useTravelStore.getState().clear()
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

function snapshotMessage(): SnapshotMessage {
  return {
    type: 'snapshot',
    // Paths in progress travel separately and are never saved with the map.
    dungeon: { ...useDungeonStore.getState().dungeon, travel: null },
    rolls: useDiceStore.getState().rolls,
    you: claims(),
  }
}

function setSaveState(saveState: SaveState): void {
  if (useSessionStore.getState().saveState !== saveState) useSessionStore.setState({ saveState })
}

function connected(): boolean {
  return socket?.readyState === WebSocket.OPEN
}

/** The whole map to everyone (the relay saves it too): on (re)connect, joins and resyncs. */
function sendSnapshot(): void {
  window.clearTimeout(patchTimer)
  window.clearTimeout(fullTimer)
  window.clearTimeout(saveTimer)
  patchTimer = fullTimer = saveTimer = 0
  saveQueued = false
  forced = new Set()
  resendClaims = false
  if (useSessionStore.getState().role !== 'host') return
  if (!connected()) {
    setSaveState('offline')
    return
  }
  rev += 1
  snapshotSeq += 1
  lastSentSeq = snapshotSeq
  const message = { ...snapshotMessage(), seq: snapshotSeq, rev }
  send(message)
  synced = useDungeonStore.getState().dungeon
  syncedYou = JSON.stringify(message.you)
  setSaveState('saving')
}

/** Several joins or resync requests at once get one snapshot. */
function requestFullSnapshot(): void {
  if (!fullTimer) fullTimer = window.setTimeout(sendSnapshot, 60)
}

/** Something changed on the DM's side: players get the difference soon, the relay a full copy later. */
function scheduleSync(): void {
  if (useSessionStore.getState().role !== 'host' || restorePending) return
  setSaveState(connected() ? 'saving' : 'offline')
  if (!patchTimer) patchTimer = window.setTimeout(flushPatch, PATCH_MS)
  saveQueued = true
  if (!saveTimer) saveTimer = window.setTimeout(saveNow, SAVE_MS)
}

/** Send players what changed since they were last in step. */
function flushPatch(): void {
  window.clearTimeout(patchTimer)
  patchTimer = 0
  if (useSessionStore.getState().role !== 'host') return
  if (!connected()) {
    setSaveState('offline')
    return
  }
  if (!synced) {
    sendSnapshot()
    return
  }
  const dungeon = useDungeonStore.getState().dungeon
  const you = claims()
  const youJson = JSON.stringify(you)
  const patch = diffDungeon(synced, dungeon, forced)
  forced = new Set()
  const youChanged = youJson !== syncedYou || resendClaims
  resendClaims = false
  if (!patch && !youChanged) return
  send({ type: 'patch', base: rev, rev: rev + 1, patch: patch ?? {}, ...(youChanged ? { you } : {}) })
  rev += 1
  synced = dungeon
  syncedYou = youJson
}

/** A full copy for the relay to save, not forwarded to players (they have the patches). */
function saveNow(): void {
  window.clearTimeout(saveTimer)
  saveTimer = 0
  if (patchTimer) flushPatch()
  saveQueued = false
  if (useSessionStore.getState().role !== 'host') return
  if (!connected()) {
    setSaveState('offline')
    return
  }
  snapshotSeq += 1
  lastSentSeq = snapshotSeq
  // At the players' revision, so someone joining from this copy can take the next patch.
  send({ ...snapshotMessage(), seq: snapshotSeq, rev, quiet: true })
}

function applySnapshot(message: Extract<NetMessage, { type: 'snapshot' }>): void {
  window.clearTimeout(resyncTimer)
  resyncTimer = 0
  guestRev = typeof message.rev === 'number' ? message.rev : null
  const newMap = useDungeonStore.getState().dungeon.id !== message.dungeon.id
  applyFromDm(message.you, () => {
    useDungeonStore.getState().replaceDungeon(message.dungeon)
    useDiceStore.getState().replaceRolls(message.rolls)
  })
  if (newMap) {
    useTravelStore.getState().clear()
    settleViewOnNewMap(useSessionStore.getState().myPlayerId)
  }
}

/** After moving to another map: clear selections and look at your token (or the party, or the first room). */
function settleViewOnNewMap(playerId: string | null): void {
  const dungeon = useDungeonStore.getState().dungeon
  const editor = useEditorStore.getState()
  editor.selectRoom(null)
  editor.selectPlayer(null)
  editor.openSheet(null)
  const players = dungeon.players ?? []
  const token = players.find((player) => player.id === playerId) ?? players.find((player) => !isMonster(player))
  if (token) {
    editor.setActiveFloor(token.floorId)
    editor.focusPlayer(token.id, 260)
    return
  }
  const ground = dungeon.floors.find((floor) => floor.order === 0) ?? dungeon.floors[0]
  if (!ground) return
  editor.setActiveFloor(ground.id)
  const room = ground.rooms[0]
  if (room) editor.focusRoom(ground.id, room.id, FOCUS_INSET)
}

/** A patch from the DM: apply it if this map is at its base revision, otherwise ask to resync. */
function applyPatch(message: Extract<NetMessage, { type: 'patch' }>): void {
  if (guestRev === null || message.base !== guestRev) {
    // Missed something (a reconnect, or joined from an older saved copy): get the whole map.
    if (!resyncTimer) {
      resyncTimer = window.setTimeout(() => {
        resyncTimer = 0
        send({ type: 'resync', clientId })
      }, 300)
    }
    return
  }
  guestRev = message.rev
  applyFromDm(message.you, () => useDungeonStore.getState().applyPatch(message.patch))
}

/** Apply the DM's map change, then catch up on seats and follow this player's token between floors. */
function applyFromDm(you: Record<string, string | null> | undefined, change: () => void): void {
  const session = useSessionStore.getState()
  const mine = session.myPlayerId ?? you?.[clientId] ?? null
  const prevFloor = mine
    ? useDungeonStore.getState().dungeon.players.find((player) => player.id === mine)?.floorId
    : null
  applyRemote(() => {
    change()
    if (!you) return
    const claimed = you[clientId]
    useSessionStore.setState({ claims: you, ...(claimed ? { myPlayerId: claimed } : {}) })
    if (claimed) pickPending = false
  })
  refusePickIfTaken()
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

/** The DM said no to a picked token (someone else holds it): forget that seat and ask again. */
function refusePickIfTaken(): void {
  const { seat, roomId, claims, presentGuests, myPlayerId } = useSessionStore.getState()
  if (!pickPending || myPlayerId || seat?.mode !== 'native' || !seat.playerId || !roomId) return
  const taken = Object.entries(claims).some(
    ([id, playerId]) => id !== clientId && playerId === seat.playerId && presentGuests.includes(id),
  )
  if (!taken) return
  pickPending = false
  writeSeat(roomId, null)
  useSessionStore.setState({ seat: null, seatPrompt: true })
}

function upsertPeer(peers: SessionPeer[], next: SessionPeer): SessionPeer[] {
  return [...peers.filter((item) => item.id !== next.id), next]
}

/** Whether this sheet belongs to the D&D Beyond token a returning player took back. */
function sheetMatchesSeat(character: DdbCharacter | null): character is DdbCharacter {
  const { seat } = useSessionStore.getState()
  return Boolean(seat?.mode === 'native' && seat.characterId && character?.characterId === seat.characterId)
}

function sendSeat(): void {
  const { seat, character, myPlayerId, roomId } = useSessionStore.getState()
  if (seat?.mode === 'ddb') sendClaim(character)
  if (seat?.mode === 'native') {
    const saved = roomId ? readSeat(roomId) : null
    const playerId = myPlayerId ?? seat.playerId ?? (saved?.mode === 'native' ? (saved.playerId ?? null) : null)
    send({ type: 'spawn', clientId, name: seat.name, playerId, pick: pickPending || undefined })
    // A reclaimed D&D Beyond token: the sheet's latest stats land on the same token.
    if (sheetMatchesSeat(character)) sendClaim(character)
  }
}

function greet(): void {
  // A new connection (or a returning DM) gets the portrait once more with the next claim.
  lastClaimPortrait = null
  send({ type: 'hello', clientId })
  sendSeat()
}

/** The portrait this tab last sent with a claim; repeats go out as null ("keep what you have"). */
let lastClaimPortrait: string | null = null

function sendClaim(character: DdbCharacter | null): void {
  const portrait = character?.portrait ?? null
  const repeat = portrait !== null && portrait === lastClaimPortrait
  if (portrait) lastClaimPortrait = portrait
  send({ type: 'claim', clientId, character: character && repeat ? { ...character, portrait: null } : character })
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
  if (message.type === 'saved') {
    if (message.seq === lastSentSeq && !saveQueued && !patchTimer) {
      useSessionStore.setState({ saveState: 'saved', savedAt: Date.now() })
      closeWaiter?.()
    }
    return
  }
  if (message.type === 'mapLoad') {
    applyRemote(() => useDungeonStore.getState().enterMap(message.snapshot?.dungeon ?? null))
    useSessionStore.getState().reportTravel(null)
    useTravelStore.getState().clear()
    convertPortraits()
    // Everyone switches with this, and the relay saves it as the live map.
    sendSnapshot()
    settleViewOnNewMap(null)
    useSessionStore.setState({ mapBusy: null, mapsVersion: session.mapsVersion + 1 })
    return
  }
  if (message.type === 'mapError') {
    useSessionStore.setState({ mapBusy: null, mapError: message.message, mapsVersion: session.mapsVersion + 1 })
    return
  }
  if (message.type === 'restore') {
    // The DM restored a save point: adopt it, then send it back so player claims stay current.
    applyRemote(() => {
      useDungeonStore.getState().replaceDungeon(message.snapshot.dungeon)
      useDiceStore.getState().replaceRolls(message.snapshot.rolls)
    })
    sendSnapshot()
    return
  }
  if (message.type === 'presence') {
    const live = new Set(message.guests)
    const peers = session.peers.filter((peer) => live.has(peer.id))
    useSessionStore.setState({ hostOnline: true, peers })
    // Someone left: tell the others their token is free to take back.
    if (peers.length !== session.peers.length && !awaitingPresence) scheduleSync()
    if (awaitingPresence) {
      // The relay sends any saved snapshot before presence, so a restore is done.
      awaitingPresence = false
      restorePending = false
      const character = session.character
      if (character) applyRemote(() => useDungeonStore.getState().claimCharacter(character))
      convertPortraits()
      sendSnapshot()
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
    // Someone (re)joining needs the whole map; a sheet update is just a change.
    if (message.type === 'hello') requestFullSnapshot()
    else scheduleSync()
    return
  }
  if (message.type === 'resync') {
    requestFullSnapshot()
    return
  }
  if (message.type === 'spawn') {
    const id = message.clientId
    // A playerId only comes from this browser's saved seat, so another tab of the
    // same player shares the token rather than spawning a twin.
    let playerId: string | null = null
    const taken =
      message.pick && session.peers.some((peer) => peer.id !== id && peer.playerId === message.playerId)
    // A picked token someone else holds stays theirs; the player is left unseated to choose again,
    // and told so even though nothing on the map changed.
    if (taken) resendClaims = true
    if (!taken) {
      applyRemote(() => {
        playerId = useDungeonStore.getState().spawnPlayer(message.name, message.playerId)
      })
    }
    useSessionStore.setState({
      peers: upsertPeer(session.peers, { id, playerId, name: message.name.trim() || 'Player' }),
    })
    scheduleSync()
    return
  }
  if (message.type === 'move') {
    applyRemote(() => {
      useDungeonStore.getState().movePlayer(message.playerId, message.floorId, message.x, message.y)
    })
    // Resend where the token stands even if the DM refused the move, so the mover snaps back.
    forced.add(message.playerId)
    scheduleSync()
    return
  }
  if (message.type === 'player') {
    applyRemote(() => useDungeonStore.getState().upsertPlayer(message.player))
    scheduleSync()
    return
  }
  if (message.type === 'opening') {
    applyRemote(() => {
      useDungeonStore
        .getState()
        .toggleConnectedOpenings(message.floorId, message.roomId, message.x, message.y)
    })
    scheduleSync()
    return
  }
  if (message.type === 'dice') {
    // The relay already sent these to everyone.
    applyRemote(() => useDiceStore.getState().ingest(message.rolls))
    return
  }
}

/** Send this tab's token path (or its end) straight to the table through the relay. */
function sendTravel(travel: TokenTravel | null): void {
  const playerId = travel?.playerId ?? travelPlayerId
  if (!playerId) return
  const fromHost = useSessionStore.getState().role === 'host'
  send({ type: 'travel', clientId, fromHost, playerId, travel })
  travelPlayerId = travel ? travel.playerId : null
  travelSentAt = Date.now()
}

/** Messages every seat handles the same way. */
function handleSharedMessage(message: NetMessage): boolean {
  if (message.type === 'travel') {
    useTravelStore.getState().receive(message.clientId, message.fromHost, message.playerId, message.travel)
    return true
  }
  if (message.type === 'presence') useTravelStore.getState().prune(message)
  return false
}

function handleGuestMessage(message: NetMessage): void {
  if (message.type === 'presence') {
    const wasOnline = useSessionStore.getState().hostOnline
    useSessionStore.setState({ hostOnline: message.host, presentGuests: message.guests })
    // Introduce ourselves on every (re)connect, and again whenever the DM returns.
    if (message.host && (awaitingPresence || !wasOnline)) greet()
    awaitingPresence = false
    return
  }
  if (message.type === 'snapshot') {
    applySnapshot(message)
    return
  }
  if (message.type === 'patch') {
    applyPatch(message)
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
  if (handleSharedMessage(data)) return
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
        saveState: session.saveState === 'saved' ? 'idle' : 'unsaved',
      })
      return
    }
    useSessionStore.setState({ status: 'error', error: final, hostOnline: false })
    return
  }
  useSessionStore.setState({
    status: 'reconnecting',
    hostOnline: false,
    ...(session.role === 'host' ? { saveState: 'offline' as const } : {}),
  })
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
    saveState: 'saving',
    savedAt: null,
    mapBusy: null,
    mapError: null,
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

/**
 * DM side: swap embedded portraits for the campaign's image URLs, so each image
 * crosses the network once. Ones uploaded before are swapped on the spot, before
 * any patch goes out; new ones are uploaded and swapped when the upload lands.
 */
function convertPortraits(): void {
  const { role, roomId } = useSessionStore.getState()
  if (role !== 'host' || !roomId || restorePending) return
  for (const player of useDungeonStore.getState().dungeon.players ?? []) {
    const src = player.portrait
    if (!isEmbedded(src)) continue
    const known = knownAssetUrl(roomId, src)
    if (known) {
      swapPortrait(player.id, src, known)
      continue
    }
    void uploadImage(roomId, src).then((url) => {
      if (url && useSessionStore.getState().roomId === roomId) swapPortrait(player.id, src, url)
    })
  }
}

/** Only if the token still shows that same image: it may have changed while uploading. */
function swapPortrait(playerId: string, src: string, url: string): void {
  const player = (useDungeonStore.getState().dungeon.players ?? []).find((item) => item.id === playerId)
  if (player?.portrait === src) useDungeonStore.getState().setPlayerPortrait(playerId, url)
}

function wireSync(): void {
  if (wired) return
  wired = true
  // Before the sync listener below, and for changes from players too (D&D Beyond sheets, uploads).
  useDungeonStore.subscribe((state, prev) => {
    if (state.dungeon.players !== prev.dungeon.players) convertPortraits()
  })
  lastDiceIds = useDiceStore.getState().rolls.map((roll) => roll.id).join()
  useDungeonStore.subscribe((state, prev) => {
    if (state.dungeon === prev.dungeon || isRemoteApply()) return
    const session = useSessionStore.getState()
    if (session.role === 'host') scheduleSync()
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
  claims: {},
  presentGuests: [],
  myPlayerId: null,
  character: null,
  seat: null,
  seatPrompt: false,
  campaignName: null,
  saveState: 'idle',
  savedAt: null,
  mapsVersion: 0,
  mapBusy: null,
  mapError: null,

  switchMap: (mapId) => {
    if (get().role !== 'host' || !connected()) {
      set({ mapError: 'Open the campaign first' })
      return
    }
    set({ mapBusy: mapId, mapError: null })
    // The relay files the live map away as it stands, so send everything first.
    saveNow()
    send({ type: 'switchMap', mapId })
  },

  touchMaps: () => set({ mapsVersion: get().mapsVersion + 1 }),

  hostCampaign: (campaign, restore) => hostTable(campaign, restore),

  closeTable: () => {
    if (get().role !== 'host') return
    if (restorePending || get().saveState === 'saved') {
      get().leave()
      return
    }
    // Flush the latest change and give the relay a moment to confirm it before leaving.
    saveNow()
    if (get().saveState !== 'saving') {
      get().leave()
      return
    }
    const done = (): void => {
      window.clearTimeout(timer)
      closeWaiter = null
      if (get().role === 'host') get().leave()
    }
    const timer = window.setTimeout(done, 4000)
    closeWaiter = done
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
    if (saved?.mode === 'ddb' || (saved?.mode === 'native' && saved.characterId)) requestDdbCharacter()
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
      claims: {},
      presentGuests: [],
      myPlayerId: null,
      link: null,
      links: [],
    })
    useEditorStore.getState().setViewMode('player')
    connect(parsed.room, 'guest')
  },

  leave: () => {
    const wasHost = get().role === 'host'
    if (wasHost) writeActive(null)
    restorePending = false
    closeWaiter = null
    destroySocket()
    set({
      // A DM leaving before the relay confirmed keeps a "not saved" warning on the map in hand.
      saveState: wasHost && get().saveState !== 'saved' ? 'unsaved' : 'idle',
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
      scheduleSync()
    }
    if (session.role === 'guest' && session.seat?.mode === 'ddb') {
      sendClaim(character)
      if (character) set({ seatPrompt: false })
    }
    // Other sheets are ignored on a native seat, except the one its token came from.
    if (session.role === 'guest' && sheetMatchesSeat(character)) sendClaim(character)
  },

  chooseSeat: (seat) => {
    const session = get()
    if (session.role !== 'guest' || !session.roomId) return
    writeSeat(session.roomId, seat)
    pickPending = seat.mode === 'native' && Boolean(seat.playerId)
    // Switching seats starts fresh; the host keeps any old token on the map. The prompt
    // stays up while waiting on a D&D Beyond sheet or the DM's answer to a pick.
    set({
      seat,
      myPlayerId: null,
      seatPrompt: (seat.mode === 'ddb' && !session.character) || pickPending,
    })
    if (seat.mode === 'ddb' && !session.character) requestDdbCharacter()
    if (seat.mode === 'native' && seat.characterId) requestDdbCharacter()
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
    if (get().role === 'solo') return
    window.clearTimeout(travelTimer)
    // Moving a different token: end the old path first so it doesn't linger for others.
    if (travel && travelPlayerId && travelPlayerId !== travel.playerId) sendTravel(null)
    const urgent = !travel || travel.phase === 'playing'
    const wait = TRAVEL_MS - (Date.now() - travelSentAt)
    if (urgent || wait <= 0) {
      travelQueued = null
      sendTravel(travel)
      return
    }
    // Dragging: keep only the newest path and send it when the window opens.
    travelQueued = travel
    travelTimer = window.setTimeout(() => {
      const next = travelQueued
      travelQueued = null
      if (next) sendTravel(next)
    }, wait)
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

// Edits on a solo table aren't going anywhere: say so, and warn before the tab closes.
useDungeonStore.subscribe((state, prev) => {
  if (state.dungeon === prev.dungeon || isRemoteApply()) return
  if (useSessionStore.getState().role === 'solo') setSaveState('unsaved')
})

window.addEventListener('beforeunload', (event) => {
  const { saveState } = useSessionStore.getState()
  if (saveState === 'unsaved' || saveState === 'saving' || saveState === 'offline') event.preventDefault()
})

// At a table, the relay rolls the dice (see worker/room.ts): no browser picks its own numbers.
setTableRoller((request) => {
  if (useSessionStore.getState().role === 'solo' || !connected()) return false
  send({ type: 'roll', clientId, request })
  return true
})
