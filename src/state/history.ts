import { applyDungeonPatch, diffDungeon } from '../net/patch.ts'
import type { DungeonPatch } from '../net/patch.ts'
import { isRemoteApply } from '../net/remote.ts'
import type { Dungeon } from '../model/types.ts'
import { useDungeonStore } from './dungeonStore.ts'

/** A stretch of local changes: the map just before it and just after it. */
interface Span {
  before: Dungeon
  after: Dungeon
}

/**
 * One undoable step. Usually a single span; a drag that other people's changes
 * landed in the middle of keeps one span per stretch, so undoing it leaves
 * theirs alone.
 */
type Step = Span[]

const LIMIT = 100

const undoStack: Step[] = []
const redoStack: Step[] = []
/** Changes while a pointer gesture is held fold into one step, so a drag undoes in one go. */
let gestureOpen = false
let gestureStep: Step | null = null
/** Set while a change should not become a step of its own: undo itself, or upkeep. */
let quiet = 0

/**
 * Run a change that isn't the user's to undo, such as a portrait finishing its
 * upload or an initiative roll landing.
 */
export function untracked(work: () => void): void {
  quiet += 1
  try {
    work()
  } finally {
    quiet -= 1
  }
}

export function beginGesture(): void {
  gestureOpen = true
  gestureStep = null
}

export function endGesture(): void {
  gestureOpen = false
  gestureStep = null
}

export function clearHistory(): void {
  undoStack.length = 0
  redoStack.length = 0
  gestureStep = null
}

/**
 * Take back the latest step. Only what that step changed is put back, so
 * anything that happened since (another player's token, say) stays as it is.
 * False when there is nothing to undo.
 */
export function undo(): boolean {
  return replay(undoStack, redoStack, (step) =>
    [...step].reverse().map((span) => diffDungeon(span.after, span.before)),
  )
}

export function redo(): boolean {
  return replay(redoStack, undoStack, (step) => step.map((span) => diffDungeon(span.before, span.after)))
}

function replay(from: Step[], to: Step[], patchesFor: (step: Step) => (DungeonPatch | null)[]): boolean {
  endGesture()
  // A step that changes nothing any more (already put back by hand) is skipped.
  for (let step = from.pop(); step; step = from.pop()) {
    const start = useDungeonStore.getState().dungeon
    let dungeon = start
    for (const patch of patchesFor(step)) {
      if (patch) dungeon = applyDungeonPatch(dungeon, patch)
    }
    if (diffDungeon(start, dungeon) === null) continue
    untracked(() => useDungeonStore.setState({ dungeon: { ...dungeon, travel: start.travel } }))
    to.push(step)
    return true
  }
  return false
}

function record(before: Dungeon, after: Dungeon): void {
  // Another map, or a whole map loaded over this one: earlier steps no longer apply.
  if (before.id !== after.id) {
    clearHistory()
    return
  }
  // Only the walk being planned changed, which never counts as an edit.
  if (!diffDungeon(before, after)) return
  redoStack.length = 0
  if (gestureOpen && gestureStep) {
    const last = gestureStep[gestureStep.length - 1]
    if (last && last.after === before) last.after = after
    else gestureStep.push({ before, after })
    return
  }
  const step: Step = [{ before, after }]
  undoStack.push(step)
  if (undoStack.length > LIMIT) undoStack.shift()
  if (gestureOpen) gestureStep = step
}

useDungeonStore.subscribe((state, prev) => {
  if (state.dungeon === prev.dungeon || quiet > 0 || isRemoteApply()) return
  record(prev.dungeon, state.dungeon)
})
