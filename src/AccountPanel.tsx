import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Account } from '../shared/model.ts'
import { api, json } from './api.ts'

export function AccountPanel({ account, change }: { account: Account | null; change: (account: Account | null) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() }
    catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const name = fields.get('name')
    void run(async () => {
      if (account) {
        change(await api<Account>('/api/account', json({ name }, 'PATCH')))
        setNotice('บันทึกชื่อตัวละครแล้ว')
      } else {
        change(await api<Account>('/api/account/session', json({ mode, name, email: fields.get('email'), password: fields.get('password') })))
        setMode('login')
      }
    })
  }

  return <form className="account-form" onSubmit={submit}>
    <h2>{account ? 'ตั้งค่าบัญชี' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</h2>
    {account ? <p className="muted account-email">{account.email}</p> : <>
      <label>อีเมล<input name="email" type="email" required maxLength={254} autoComplete="username" /></label>
      <label>รหัสผ่าน<input key={mode} name="password" type="password" required minLength={8} maxLength={128}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></label>
    </>}
    {(account || mode === 'register') && <label>ชื่อตัวละครที่ใช้บนโต๊ะ<input key={account?.name} name="name" required maxLength={40}
      autoComplete="nickname" defaultValue={account?.name} /></label>}
    {error && <p role="alert" className="feedback">{error}</p>}
    {notice && <p role="status" className="feedback">{notice}</p>}
    <div className="inline">
      <button className="primary" disabled={busy}>{account ? 'บันทึกชื่อ' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครบัญชี'}</button>
      {account ? <button type="button" disabled={busy} onClick={() => void run(async () => {
        await api('/api/account/session', { method: 'DELETE' })
        change(null)
      })}>ออกจากระบบ</button> : <button type="button" disabled={busy} onClick={() => {
        setMode(mode === 'login' ? 'register' : 'login')
        setError('')
      }}>{mode === 'login' ? 'สร้างบัญชี' : 'กลับไปเข้าสู่ระบบ'}</button>}
    </div>
  </form>
}
