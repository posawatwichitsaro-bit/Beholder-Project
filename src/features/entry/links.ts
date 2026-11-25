const ago = new Intl.RelativeTimeFormat('th', { numeric: 'auto' })

/** "2 วันที่แล้ว" style text for when a table last changed. */
export function playedAgo(iso: string, now = Date.now()) {
  const minutes = Math.round((Date.parse(iso) - now) / 60000)
  if (Math.abs(minutes) < 60) return ago.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return ago.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return ago.format(days, 'day')
  return ago.format(Math.round(days / 30), 'month')
}

/** Accept a full invite URL, a path, or just the query string, and return the /join path. */
export function joinPathFromLink(value: string) {
  const text = value.trim()
  if (!text) return undefined
  let params: URLSearchParams
  try { params = new URL(text.startsWith('?') ? '/' + text : text, 'http://local').searchParams }
  catch { return undefined }
  const invite = params.get('invite')
  if (!invite) return undefined
  const next = new URLSearchParams({ invite })
  const room = params.get('room')
  if (room) next.set('room', room)
  if (params.get('role') === 'dm') next.set('role', 'dm')
  return '/join?' + next.toString()
}
