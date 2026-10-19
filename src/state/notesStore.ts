import { create } from 'zustand'
import {
  blankNote,
  normalizeHandout,
  normalizeNote,
  normalizeSharedNote,
  type Handout,
  type Note,
  type NoteAnchor,
  type SharedNote,
} from '../model/notes.ts'
import type { NetMessage } from '../net/protocol.ts'

/** Edits go to the table once typing rests this long. */
const SAVE_MS = 600
/** At most this many handouts wait to be looked at. */
const MAX_HANDOUTS = 5

export type NotesTab = 'mine' | 'table' | 'reminders'

/** A shared note's key: notes are only unique per author. */
export function sharedKey(note: Pick<SharedNote, 'author' | 'id'>): string {
  return `${note.author}:${note.id}`
}

interface NotesState {
  /** Whether the table has sent this seat's notebook: notes need a campaign on the server. */
  ready: boolean
  /** The campaign map in play, which pins are placed on. */
  mapId: string | null
  /** This seat's own notes: the DM's, or this player's. */
  notes: Note[]
  /** Everything shared with the table, by anyone. */
  shared: SharedNote[]
  error: string | null
  open: boolean
  tab: NotesTab
  /** The note of this seat's open to edit. */
  selectedId: string | null
  /** A shared note open to read, by `sharedKey`. */
  readingKey: string | null
  /** A note waiting for a spot on the map to be pinned to. */
  pinningId: string | null
  /** Handouts put up by the DM; the first is on screen. */
  handouts: Handout[]
  /** Shared notes (by `sharedKey`) someone else shared or changed since this seat last looked. */
  unread: string[]

  openPanel: (tab?: NotesTab) => void
  closePanel: () => void
  setTab: (tab: NotesTab) => void
  /** Open one of this seat's notes in the panel. */
  select: (id: string | null) => void
  read: (key: string | null) => void
  /** Start a note, open it, and save it; returns it. */
  create: (fields?: Partial<Note>) => Note
  update: (id: string, change: Partial<Note> | ((note: Note) => Partial<Note>)) => void
  remove: (id: string) => void
  startPin: (id: string) => void
  cancelPin: () => void
  /** Pin the note waiting for a spot. */
  pinTo: (anchor: NoteAnchor) => void
  /** Put a handout up on this screen. */
  showHandout: (handout: Handout) => void
  closeHandout: () => void
  dismissError: () => void
  /** A message about notes from the table; true when it was one. */
  receive: (message: NetMessage) => boolean
  /** Leaving the table: forget its notes. */
  reset: () => void
}

type Sender = (message: NetMessage) => boolean
let sender: Sender = () => false

/** The session store hands over its socket, without the two importing each other. */
export function setNoteSender(send: Sender): void {
  sender = send
}

let clientId = ''
/** Whose notes are this seat's own when shared: `dm`, or the player's token. */
let ownAuthor: string | null = null

export function setNoteClientId(id: string): void {
  clientId = id
}

export function setNoteAuthor(author: string | null): void {
  ownAuthor = author
}

const timers = new Map<string, number>()
/** Notes changed while the table couldn't hear; sent again once the notebook comes back. */
const unsent = new Set<string>()

function flush(id: string): void {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  const note = useNotesStore.getState().notes.find((item) => item.id === id)
  if (!note) return
  if (sender({ type: 'noteSave', clientId, note })) unsent.delete(id)
  else unsent.add(id)
}

function scheduleSave(id: string): void {
  window.clearTimeout(timers.get(id))
  timers.set(id, window.setTimeout(() => flush(id), SAVE_MS))
}

function upsertShared(shared: SharedNote[], key: string, note: SharedNote | null): SharedNote[] {
  const rest = shared.filter((item) => sharedKey(item) !== key)
  return note ? [note, ...rest] : rest
}

export const useNotesStore = create<NotesState>((set, get) => ({
  ready: false,
  mapId: null,
  notes: [],
  shared: [],
  error: null,
  open: false,
  tab: 'mine',
  selectedId: null,
  readingKey: null,
  pinningId: null,
  handouts: [],
  unread: [],

  openPanel: (tab) =>
    set((state) => {
      const next = tab ?? state.tab
      return { open: true, tab: next, ...(next === 'table' ? { unread: [] } : {}) }
    }),
  closePanel: () => set({ open: false, pinningId: null }),
  setTab: (tab) => set({ tab, selectedId: null, readingKey: null, ...(tab === 'table' ? { unread: [] } : {}) }),
  select: (id) => set({ selectedId: id, readingKey: null, open: true, ...(id ? { tab: 'mine' as const } : {}) }),
  read: (key) =>
    set({ readingKey: key, selectedId: null, open: true, ...(key ? { tab: 'table' as const, unread: [] } : {}) }),

  create: (fields) => {
    const note = blankNote(fields)
    set((state) => ({ notes: [note, ...state.notes], selectedId: note.id, readingKey: null, open: true, tab: 'mine' }))
    flush(note.id)
    return note
  },

  update: (id, change) => {
    let changed = false
    set((state) => ({
      notes: state.notes.map((note) => {
        if (note.id !== id) return note
        changed = true
        const fields = typeof change === 'function' ? change(note) : change
        return { ...note, ...fields, updatedAt: Date.now() }
      }),
    }))
    if (changed) scheduleSave(id)
  },

  remove: (id) => {
    window.clearTimeout(timers.get(id))
    timers.delete(id)
    unsent.delete(id)
    sender({ type: 'noteDelete', clientId, id })
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      pinningId: state.pinningId === id ? null : state.pinningId,
    }))
  },

  startPin: (id) => set({ pinningId: id }),
  cancelPin: () => set({ pinningId: null }),
  pinTo: (anchor) => {
    const id = get().pinningId
    if (!id) return
    set({ pinningId: null, selectedId: id, open: true, tab: 'mine' })
    get().update(id, { anchor })
  },

  showHandout: (handout) =>
    set((state) =>
      state.handouts.some((item) => item.id === handout.id) || state.handouts.length >= MAX_HANDOUTS
        ? state
        : { handouts: [...state.handouts, handout] },
    ),
  closeHandout: () => set((state) => ({ handouts: state.handouts.slice(1) })),
  dismissError: () => set({ error: null }),

  receive: (message) => {
    switch (message.type) {
      case 'notebook': {
        const notes = (Array.isArray(message.notes) ? message.notes : [])
          .map((note) => normalizeNote(note))
          .filter((note): note is Note => note !== null)
        // Changes this tab made while the table couldn't hear keep their place, and go again.
        const local = new Map(get().notes.map((note) => [note.id, note]))
        const kept = [...unsent].map((id) => local.get(id)).filter((note): note is Note => note !== undefined)
        const merged = [...kept, ...notes.filter((note) => !unsent.has(note.id))]
        const shared = (Array.isArray(message.shared) ? message.shared : [])
          .map(normalizeSharedNote)
          .filter((note): note is SharedNote => note !== null)
        set((state) => ({
          ready: true,
          mapId: typeof message.mapId === 'string' ? message.mapId : null,
          notes: merged,
          shared,
          selectedId: merged.some((note) => note.id === state.selectedId) ? state.selectedId : null,
        }))
        for (const note of kept) flush(note.id)
        return true
      }
      case 'noteMine': {
        // Another tab of this seat: unless this one is mid-edit on it.
        if (timers.has(message.id)) return true
        const note = message.note ? normalizeNote(message.note) : null
        set((state) => {
          const rest = state.notes.filter((item) => item.id !== message.id)
          return {
            notes: note ? [note, ...rest] : rest,
            selectedId: !note && state.selectedId === message.id ? null : state.selectedId,
          }
        })
        return true
      }
      case 'noteShared': {
        const note = message.note ? normalizeSharedNote(message.note) : null
        const key = `${message.author}:${message.id}`
        set((state) => {
          const looking = state.open && state.tab === 'table'
          const fresh = note && !looking && message.author !== ownAuthor
          const unread = state.unread.filter((item) => item !== key)
          return {
            shared: upsertShared(state.shared, key, note),
            readingKey: !note && state.readingKey === key ? null : state.readingKey,
            unread: fresh ? [...unread, key] : unread,
          }
        })
        return true
      }
      case 'noteError':
        set({ error: typeof message.message === 'string' ? message.message.slice(0, 200) : 'Could not save that note' })
        return true
      case 'handout': {
        const handout = normalizeHandout(message.handout)
        if (handout) get().showHandout(handout)
        return true
      }
      case 'liveMap':
        set({ mapId: typeof message.mapId === 'string' ? message.mapId : null })
        return true
      default:
        return false
    }
  },

  reset: () => {
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
    unsent.clear()
    set({
      ready: false,
      mapId: null,
      notes: [],
      shared: [],
      error: null,
      selectedId: null,
      readingKey: null,
      pinningId: null,
      handouts: [],
      unread: [],
    })
  },
}))

/** Send a handout to everyone else at the table. */
export function sendHandout(handout: Handout): boolean {
  return sender({ type: 'handout', clientId, handout })
}
