import { useEffect } from 'react'
import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'
type Toast = { id: number; tone: ToastTone; text: string }

let nextId = 1

export const useToasts = create<{
  toasts: Toast[]
  push: (text: string, tone?: ToastTone) => number
  dismiss: (id: number) => void
}>()(set => ({
  toasts: [],
  push: (text, tone = 'info') => {
    const id = nextId++
    set(state => ({ toasts: [...state.toasts.slice(-3), { id, tone, text }] }))
    return id
  },
  dismiss: id => set(state => ({ toasts: state.toasts.filter(toast => toast.id !== id) }))
}))

/** Show a short message. Errors stay until dismissed; the rest fade after 4 s. */
export const toast = (text: string, tone: ToastTone = 'info') => useToasts.getState().push(text, tone)

function ToastItem({ item }: { item: Toast }) {
  const dismiss = useToasts(state => state.dismiss)
  useEffect(() => {
    if (item.tone === 'error') return
    const timer = setTimeout(() => dismiss(item.id), 4000)
    return () => clearTimeout(timer)
  }, [item, dismiss])
  return <div className="bh-toast" data-tone={item.tone} role={item.tone === 'error' ? 'alert' : 'status'}>
    <span>{item.text}</span>
    <button type="button" aria-label="ปิดข้อความ" onClick={() => dismiss(item.id)}>×</button>
  </div>
}

export function ToastViewport() {
  const toasts = useToasts(state => state.toasts)
  if (!toasts.length) return null
  return <div className="bh-toasts">{toasts.map(item => <ToastItem key={item.id} item={item} />)}</div>
}
