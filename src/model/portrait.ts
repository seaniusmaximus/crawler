const MAX_W = 192
const MAX_H = 288

/** Keep a transparent PNG cutout for standees — no square crop, no JPEG flatten. */
export function readPortraitFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not read standee image'))
        return
      }
      const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height)
      const width = Math.max(1, Math.round(img.width * scale))
      const height = Math.max(1, Math.round(img.height * scale))
      canvas.width = width
      canvas.height = height
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read standee image'))
    }
    img.src = url
  })
}
