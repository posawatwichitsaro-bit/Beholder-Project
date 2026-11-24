export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}))
    throw new ApiError(response.status, problem.error ?? 'เชื่อมต่อไม่สำเร็จ')
  }
  return response.status === 204 ? undefined as T : response.json()
}

export function json(body: object, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export function commandId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
