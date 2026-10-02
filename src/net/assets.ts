/**
 * Portraits live on the server once per campaign (see worker/index.ts) and travel
 * as short URLs instead of embedded data. The DM's browser uploads embedded images
 * as it meets them; a save file puts them back inline so it works on its own.
 */

const ASSET_PATH = '/crawler-sync/asset/'
/** After a failed upload, wait this long before trying the same image again. */
const RETRY_MS = 30_000

type Entry = { url: string } | { pending: Promise<string | null> } | { failedAt: number }

/** Keyed by campaign and the embedded data itself, so a repeat is swapped without uploading. */
const uploads = new Map<string, Entry>()

export function isEmbedded(src: string | null | undefined): src is string {
  return Boolean(src?.startsWith('data:'))
}

export function isAssetUrl(src: string | null | undefined): src is string {
  return Boolean(src?.startsWith(ASSET_PATH))
}

/** The server URL for an image already uploaded to this campaign, if any. */
export function knownAssetUrl(room: string, dataUrl: string): string | null {
  const entry = uploads.get(`${room}\n${dataUrl}`)
  return entry && 'url' in entry ? entry.url : null
}

/** Upload an embedded image to the campaign; null when it can't be (and it stays embedded). */
export function uploadImage(room: string, dataUrl: string): Promise<string | null> {
  const key = `${room}\n${dataUrl}`
  const entry = uploads.get(key)
  if (entry && 'url' in entry) return Promise.resolve(entry.url)
  if (entry && 'pending' in entry) return entry.pending
  if (entry && Date.now() - entry.failedAt < RETRY_MS) return Promise.resolve(null)

  const pending = (async () => {
    const blob = dataUrlToBlob(dataUrl)
    if (!blob) return null
    const response = await fetch(`${ASSET_PATH}${room}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': blob.type },
      body: blob,
    })
    if (!response.ok) return null
    const { url } = (await response.json()) as { url?: string }
    return url ?? null
  })().then(
    (url) => {
      uploads.set(key, url ? { url } : { failedAt: Date.now() })
      return url
    },
    () => {
      uploads.set(key, { failedAt: Date.now() })
      return null
    },
  )
  uploads.set(key, { pending })
  return pending
}

/** Turn a server image back into embedded data (for save files); the original on failure. */
export async function inlineImage(src: string): Promise<string> {
  if (!isAssetUrl(src)) return src
  try {
    const response = await fetch(src, { credentials: 'same-origin' })
    if (!response.ok) return src
    const type = response.headers.get('Content-Type') ?? 'image/png'
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return `data:${type};base64,${btoa(binary)}`
  } catch {
    return src
  }
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return null
  const [, type, base64, body] = match
  try {
    if (!base64) return new Blob([decodeURIComponent(body)], { type })
    const binary = atob(body)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type })
  } catch {
    return null
  }
}
