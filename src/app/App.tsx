import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import type { Account, Snapshot } from '../../shared/model.ts'
import { api } from '../lib/api.ts'
import { useRoomStore } from '../state/roomStore.ts'
import { Entry } from '../features/entry/Entry.tsx'
import type { AccountProps } from '../features/entry/Entry.tsx'
import { Table } from '../features/table/Table.tsx'
import { UiKitGallery } from '../features/dev/UiKitGallery.tsx'

/**
 * Routes
 * - `/`            lobby: sign in and open a new table
 * - `/join`        join with an invite (`?invite=…&room=…[&role=dm]`)
 * - `/room/:id`    the table
 *
 * Links issued before the router existed keep working: `/?room=id` redirects to
 * `/room/id`, and `/?invite=…` redirects to `/join?invite=…`.
 */
export function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountError, setAccountError] = useState('')
  useEffect(() => {
    api<Account | null>('/api/account').then(setAccount)
      .catch(error => setAccountError((error as Error).message))
      .finally(() => setLoading(false))
  }, [])
  useSessionWatch(account, setAccount)
  if (loading) return <main className="entry"><p>กำลังเปิดโต๊ะ…</p></main>
  const props: AccountProps = { account, changeAccount: setAccount }
  return <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home {...props} initialError={accountError} />} />
      <Route path="/join" element={<Join {...props} />} />
      <Route path="/room/:id" element={<RoomRoute {...props} />} />
      <Route path="/ui-kit" element={<UiKitGallery />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
}

/** Re-check the account every 30 s and when the tab becomes visible again. */
function useSessionWatch(account: Account | null, setAccount: (account: Account | null) => void) {
  useEffect(() => {
    if (!account) return
    let active = true
    const check = () => {
      void api<Account | null>('/api/account').then(current => {
        if (active && current?.email !== account.email) setAccount(current)
      }).catch(() => {})
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const timer = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [account])
}

function useEnterRoom() {
  const navigate = useNavigate()
  return (room: Snapshot) => {
    useRoomStore.getState().enterRoom(room)
    navigate('/room/' + room.id, { replace: true })
  }
}

function Home({ initialError, ...props }: AccountProps & { initialError: string }) {
  const [params] = useSearchParams()
  const enter = useEnterRoom()
  const legacyRoom = params.get('room')
  if (params.get('invite')) return <Navigate to={'/join?' + params.toString()} replace />
  if (legacyRoom) return <Navigate to={'/room/' + encodeURIComponent(legacyRoom)} replace />
  return <Entry {...props} roomId={null} dmLink={false} enter={enter} initialError={initialError} />
}

function Join(props: AccountProps) {
  const [params] = useSearchParams()
  const enter = useEnterRoom()
  const invite = params.get('invite')
  if (!invite) return <Navigate to="/" replace />
  return <Entry {...props} invite={invite} roomId={params.get('room')} dmLink={params.get('role') === 'dm'} enter={enter} initialError="" />
}

/**
 * Loads the seat for `/room/:id`. Without one (signed out, or a stale link),
 * the lobby is shown with the server's message; signing in from there loads
 * the room again because the account email changes.
 */
function RoomRoute(props: AccountProps) {
  const { id = '' } = useParams()
  const location = useLocation()
  const enter = useEnterRoom()
  const room = useRoomStore(state => state.room)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(room?.id !== id)
  const email = props.account?.email
  const lastEmail = useRef(email)
  useEffect(() => {
    const accountChanged = lastEmail.current !== email
    lastEmail.current = email
    const held = useRoomStore.getState().room
    if (held?.id === id && !accountChanged) { setLoading(false); return }
    let active = true
    if (accountChanged && held?.id === id) {
      // Signing in or out while seated: re-check the seat in the background so the
      // table (and anything half-done in it, like a sheet waiting to be saved) stays open.
      api<Snapshot>('/api/rooms/' + id).then(state => {
        if (active) useRoomStore.getState().accept(state)
      }).catch(failure => {
        if (!active) return
        useRoomStore.getState().leaveRoom()
        setError(email ? (failure as Error).message : '')
      })
      return () => { active = false }
    }
    setLoading(true)
    api<Snapshot>('/api/rooms/' + id).then(state => {
      if (!active) return
      setError('')
      useRoomStore.getState().enterRoom(state)
    }).catch(failure => {
      if (!active) return
      useRoomStore.getState().leaveRoom()
      setError(accountChanged && !email ? '' : (failure as Error).message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, email, location.key])
  if (loading) return <main className="entry"><p>กำลังเปิดโต๊ะ…</p></main>
  if (room?.id === id) return <Table key={room.id + room.me.id} {...props} />
  return <Entry {...props} roomId={id} dmLink={false} enter={enter} initialError={error} />
}
