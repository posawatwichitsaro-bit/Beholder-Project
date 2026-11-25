import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Account, Snapshot } from '../../../shared/model.ts'
import { AccountPanel } from '../account/AccountPanel.tsx'
import { api, json as post } from '../../lib/api.ts'

export type AccountProps = { account: Account | null; changeAccount: (account: Account | null) => void }

export function Entry({ invite, roomId, dmLink, enter, initialError, account, changeAccount }: AccountProps & {
  invite?: string; roomId: string | null; dmLink: boolean; enter: (room: Snapshot) => void; initialError: string
}) {
  const [error, setError] = useState(initialError)
  const [waiting, setWaiting] = useState(false)
  useEffect(() => setError(initialError), [initialError])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setWaiting(true)
    try {
      enter(invite
        ? await api<Snapshot>('/api/join', post({ name: form.get('member'), invite, roomId, role: form.get('role') }))
        : await api<Snapshot>('/api/rooms', post({ name: form.get('room'), member: form.get('member') })))
    } catch (error) { setError((error as Error).message) }
    finally { setWaiting(false) }
  }
  return <main className="entry">
    <header className="entry-hero"><h1>Beholder</h1><span>Dungeons &amp; Dragons · Virtual Tabletop</span></header>
    <div className="entry-panels">
      <AccountPanel account={account} change={changeAccount} />
      <form onSubmit={submit}>
        <h2>{invite ? 'เข้าร่วมโต๊ะ' : 'เปิดโต๊ะใหม่'}</h2>
        {!invite && <label>ชื่อห้อง<input name="room" required maxLength={120} placeholder="เช่น ประตูเมืองเหนือ" /></label>}
        {account ? <p className="muted">ชื่อที่ใช้บนโต๊ะ · {account.name}</p>
          : <label>ชื่อที่ใช้บนโต๊ะ<input name="member" required maxLength={120} autoComplete="nickname" /></label>}
        {invite && <label>บทบาท<select name="role" defaultValue={dmLink ? 'dm' : 'player'}><option value="dm">DM</option><option value="player">Player</option></select></label>}
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={waiting}>{waiting ? 'กำลังเชื่อมต่อ…' : invite ? 'เข้าร่วม' : 'สร้างห้อง DM'}</button>
      </form>
    </div>
  </main>
}
