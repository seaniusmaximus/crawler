/**
 * Notes are kept by the campaign, not the map: the DM's planning notes, and each
 * player's notebook. They live on the server beside the maps (see worker/room.ts)
 * and never ride in map snapshots, so what the DM keeps to themselves never
 * reaches a player's browser; a shared note goes out with only its shared parts.
 */

/** Who a note belongs to: the DM, or a player by their party token's id. */
export type NoteOwner = 'dm' | string

/** One part of a note: a passage of text, or a picture that can be shown to the table as a handout. */
export type NoteBlock =
  | { id: string; kind: 'text'; text: string; shared: boolean }
  | { id: string; kind: 'image'; src: string; caption: string; shared: boolean }

/**
 * What a note is pinned to on a map: the map, a room (at a spot in it, kept
 * relative to the room so it moves with it), or an object in a room. `label`
 * names it as it was when pinned, for when that map isn't the one in play.
 */
export interface NoteAnchor {
  mapId: string
  floorId?: string
  roomId?: string
  objectId?: string
  /** Squares in from the room's top-left corner; missing pins it in the room's middle. */
  dx?: number
  dy?: number
  label: string
}

export interface Note {
  id: string
  title: string
  /** A folder to file it under; empty for none. */
  folder: string
  blocks: NoteBlock[]
  anchor: NoteAnchor | null
  /**
   * Shared with the table. A DM's note shares only the blocks marked shared; a
   * player's note shares all of it.
   */
  shared: boolean
  /** Kept at the top of the list. */
  starred: boolean
  createdAt: number
  updatedAt: number
}

/** A note as the table sees it once it's shared: only its shared parts, with who wrote it. */
export interface SharedNote {
  id: string
  /** `dm`, or the player token whose note it is. */
  author: NoteOwner
  title: string
  blocks: NoteBlock[]
  updatedAt: number
}

/** A picture (and words) put up on everyone's screen at once. */
export interface Handout {
  id: string
  title: string
  blocks: NoteBlock[]
}

export const MAX_DM_NOTES = 500
export const MAX_PLAYER_NOTES = 200
export const MAX_BLOCKS = 60
const MAX_TITLE = 120
const MAX_FOLDER = 60
const MAX_TEXT = 20_000
const MAX_CAPTION = 200
const MAX_LABEL = 120
const MAX_ID = 64
/** A note's JSON is at most this long, well under a storage row. */
export const MAX_NOTE_CHARS = 200_000

/** Images in notes (and world maps) are always the campaign's own uploads (only the DM can add those), never embedded or from elsewhere. */
export const ASSET_SRC = /^\/crawler-sync\/asset\/[a-z0-9]{4,32}\/[0-9a-f]{64}$/

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value && value.length <= MAX_ID ? value : null
}

function whole(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined
}

function normalizeBlock(raw: unknown): NoteBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const block = raw as Record<string, unknown>
  const blockId = id(block.id)
  if (!blockId) return null
  const shared = block.shared === true
  if (block.kind === 'text') return { id: blockId, kind: 'text', text: text(block.text, MAX_TEXT), shared }
  if (block.kind === 'image' && typeof block.src === 'string' && ASSET_SRC.test(block.src)) {
    return { id: blockId, kind: 'image', src: block.src, caption: text(block.caption, MAX_CAPTION), shared }
  }
  return null
}

function normalizeBlocks(raw: unknown): NoteBlock[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_BLOCKS)
    .map(normalizeBlock)
    .filter((block): block is NoteBlock => block !== null)
}

function normalizeAnchor(raw: unknown): NoteAnchor | null {
  if (!raw || typeof raw !== 'object') return null
  const anchor = raw as Record<string, unknown>
  const mapId = id(anchor.mapId)
  if (!mapId) return null
  const out: NoteAnchor = { mapId, label: text(anchor.label, MAX_LABEL) }
  const floorId = id(anchor.floorId)
  if (!floorId) return out
  out.floorId = floorId
  const roomId = id(anchor.roomId)
  if (!roomId) return out
  out.roomId = roomId
  const objectId = id(anchor.objectId)
  if (objectId) out.objectId = objectId
  const dx = whole(anchor.dx)
  const dy = whole(anchor.dy)
  if (!objectId && dx !== undefined && dy !== undefined) {
    out.dx = dx
    out.dy = dy
  }
  return out
}

/** A note as saved or sent, checked over; null if it isn't one. */
export function normalizeNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const note = raw as Record<string, unknown>
  const noteId = id(note.id)
  if (!noteId) return null
  const now = Date.now()
  return {
    id: noteId,
    title: text(note.title, MAX_TITLE),
    folder: text(note.folder, MAX_FOLDER).trim(),
    blocks: normalizeBlocks(note.blocks),
    anchor: normalizeAnchor(note.anchor),
    shared: note.shared === true,
    starred: note.starred === true,
    createdAt: whole(note.createdAt) ?? now,
    updatedAt: whole(note.updatedAt) ?? now,
  }
}

/**
 * What the table sees of a shared note: a DM's note without the parts kept back,
 * a player's whole. Null when it isn't shared. Pins stay with their owner.
 */
export function sharedView(note: Note, owner: NoteOwner): SharedNote | null {
  if (!note.shared) return null
  const blocks = owner === 'dm' ? note.blocks.filter((block) => block.shared) : note.blocks
  return {
    id: note.id,
    author: owner,
    title: note.title,
    blocks: blocks.map((block) => ({ ...block, shared: true })),
    updatedAt: note.updatedAt,
  }
}

/** A shared note from the server, checked over. */
export function normalizeSharedNote(raw: unknown): SharedNote | null {
  if (!raw || typeof raw !== 'object') return null
  const note = raw as Record<string, unknown>
  const noteId = id(note.id)
  const author = id(note.author)
  if (!noteId || !author) return null
  return {
    id: noteId,
    author,
    title: text(note.title, MAX_TITLE),
    blocks: normalizeBlocks(note.blocks),
    updatedAt: whole(note.updatedAt) ?? Date.now(),
  }
}

/** A handout from the DM, checked over. */
export function normalizeHandout(raw: unknown): Handout | null {
  if (!raw || typeof raw !== 'object') return null
  const handout = raw as Record<string, unknown>
  const handoutId = id(handout.id)
  if (!handoutId) return null
  const blocks = normalizeBlocks(handout.blocks)
  if (!blocks.length) return null
  return { id: handoutId, title: text(handout.title, MAX_TITLE), blocks }
}

export function newBlockId(): string {
  return crypto.randomUUID().slice(0, 12)
}

export function blankNote(fields: Partial<Note> = {}): Note {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: '',
    folder: '',
    blocks: [{ id: newBlockId(), kind: 'text', text: '', shared: false }],
    anchor: null,
    shared: false,
    starred: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
  }
}

export function noteTitle(note: Pick<Note, 'title'>): string {
  return note.title.trim() || 'Untitled note'
}

/** The first line of a note's words, for its row in a list. */
export function notePreview(note: Pick<Note, 'blocks'>): string {
  for (const block of note.blocks) {
    const line = block.kind === 'text' ? block.text.trim().split('\n')[0] : block.caption.trim()
    if (line) return line
  }
  return note.blocks.some((block) => block.kind === 'image') ? 'Picture' : ''
}

/** Whether a note matches a search, by its title, folder or words. */
export function noteMatches(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (note.title.toLowerCase().includes(q) || note.folder.toLowerCase().includes(q)) return true
  return note.blocks.some((block) => (block.kind === 'text' ? block.text : block.caption).toLowerCase().includes(q))
}

/** Starred first, then the most recently changed. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt - a.updatedAt)
}
