import { uploadImage } from '../../net/assets.ts'

/** Handouts are read on screen: this is plenty, and keeps them well under the upload limit. */
const MAX_SIDE = 1600
const QUALITY = 0.85

/** Shrink a picture to fit `MAX_SIDE` as a JPEG data URL (WebP for ones with see-through parts). */
function readHandoutFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_SIDE / img.width, MAX_SIDE / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not read that picture'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const clear = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif'
      resolve(canvas.toDataURL(clear ? 'image/webp' : 'image/jpeg', QUALITY))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that picture'))
    }
    img.src = url
  })
}

/** Put a picture on the campaign's server for a note; resolves to its URL. */
export async function uploadNoteImage(room: string, file: File): Promise<string> {
  const data = await readHandoutFile(file)
  const url = await uploadImage(room, data)
  if (!url) throw new Error('Could not upload that picture (pictures must be under 1.5 MB)')
  return url
}
