import { useState } from 'react'

async function prepare(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('ใช้ PNG, JPEG หรือ WebP ขนาดไม่เกิน 10 MB')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    for (const edge of [256, 192, 128, 80]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const picture = canvas.toDataURL('image/webp', .8)
      if (picture.length <= 32000) return picture
    }
    throw new Error('ย่อรูปให้เล็กพอไม่ได้')
  } finally { bitmap.close() }
}

export function PictureInput({ label, value, change, pending }: {
  label: string; value?: string; change: (value: string | undefined) => void; pending: (busy: boolean) => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <div className="picture-input">
    {value && <img src={value} alt={label} />}
    <label>{label}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      setError('')
      setBusy(true)
      pending(true)
      try { change(await prepare(file)) }
      catch { setError('อ่านรูปไม่ได้ กรุณาเลือก PNG, JPEG หรือ WebP ขนาดไม่เกิน 10 MB') }
      finally { setBusy(false); pending(false) }
    }} /></label>
    {value && <button type="button" disabled={busy} onClick={() => change(undefined)}>เอารูปออก</button>}
    {error && <small role="alert">{error}</small>}
  </div>
}
