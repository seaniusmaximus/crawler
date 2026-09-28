let depth = 0

export function applyRemote(work: () => void): void {
  depth += 1
  try {
    work()
  } finally {
    depth -= 1
  }
}

export function isRemoteApply(): boolean {
  return depth > 0
}
