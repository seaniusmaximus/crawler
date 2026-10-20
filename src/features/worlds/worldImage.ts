import { uploadImage } from '../../net/assets.ts'
import type { WorldImage } from '../../model/worlds.ts'

/** Uploads must stay under 1.5 MB (see worker/index.ts); this leaves a little room. */
const MAX_BYTES = 1_450_000
/** As sharp as will fit: the largest of these that comes in under the limit. */
const SIDES = [4096, 3584, 3072, 2560, 2048, 1600]
const QUALITIES = [0.86, 0.74]

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that picture'))
    }
    img.src = url
  })
}

/** Roughly how many bytes a base64 data URL decodes to. */
function bytesOf(dataUrl: string): number {
  return Math.ceil(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)
}

/**
 * A world map picture as a JPEG data URL, as large as fits the upload limit.
 * World maps are flat and opaque, so JPEG suits them; anything see-through sits on the page's dark.
 */
async function encode(file: File): Promise<{ data: string; width: number; height: number }> {
  const img = await loadImage(file)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx || !img.width || !img.height) throw new Error('Could not read that picture')
  for (const side of SIDES) {
    const scale = Math.min(1, side / img.width, side / img.height)
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    ctx.fillStyle = '#0b0c10'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of QUALITIES) {
      const data = canvas.toDataURL('image/jpeg', quality)
      if (bytesOf(data) <= MAX_BYTES) return { data, width: canvas.width, height: canvas.height }
    }
  }
  throw new Error('That picture is too detailed to fit; try a smaller one')
}

/** Put a world map picture on the campaign's server. */
export async function uploadWorldImage(room: string, file: File): Promise<WorldImage> {
  const { data, width, height } = await encode(file)
  const src = await uploadImage(room, data)
  if (!src) throw new Error('Could not upload that picture')
  return { src, width, height }
}
