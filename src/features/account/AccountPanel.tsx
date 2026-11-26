import { useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff, LogOut } from 'lucide-react'
import type { Account } from '../../../shared/model.ts'
import { api, json } from '../../lib/api.ts'
import { Button } from '../../ui/index.ts'

/**
 * Sign in, register, or (when signed in) rename and sign out.
 * Button and field names are what the browser tests and screen readers rely on.
 */
export function AccountPanel({ account, change, initialMode = 'login' }: {
  account: Account | null; change: (account: Account | null) => void; initialMode?: 'login' | 'register'
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)

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

  return <form className="account-form" data-mode={account ? 'settings' : mode} onSubmit={submit}>
    <h2>{account ? 'ตั้งค่าบัญชี' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</h2>
    {!account && <p className="account-why">{mode === 'login'
      ? 'กลับเข้าโต๊ะเดิมได้ทุกเครื่อง และใช้คลังชีตส่วนตัว'
      : 'บัญชีเก็บโต๊ะ ชีต และ Object ไว้ใช้ข้ามโต๊ะ'}</p>}
    {account ? <p className="muted account-email">{account.email}</p> : <>
      <label>อีเมล<input name="email" type="email" required maxLength={254} autoComplete="username" /></label>
      <label>รหัสผ่าน<span className="account-password">
        <input key={mode} name="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'register' ? 15 : 8} maxLength={256}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
        <button type="button" className="account-reveal" aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword}
          onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button>
      </span></label>
      {mode === 'register' && <small>ใช้รหัสผ่าน 15–128 ตัวอักษร เช่น ประโยคสั้น ๆ ที่จำง่าย</small>}
    </>}
    {(account || mode === 'register') && <label>ชื่อตัวละครที่ใช้บนโต๊ะ<input key={account?.name} name="name" required maxLength={40}
      autoComplete="nickname" defaultValue={account?.name} /></label>}
    {error && <p role="alert" className="feedback">{error}</p>}
    {notice && <p role="status" className="feedback">{notice}</p>}
    <div className="inline account-actions">
      <Button type="submit" variant="primary" className="primary" pending={busy}>{account ? 'บันทึกชื่อ' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครบัญชี'}</Button>
      {account ? <Button disabled={busy} icon={<LogOut size={15} />} onClick={() => void run(async () => {
        await api('/api/account/session', { method: 'DELETE' })
        change(null)
      })}>ออกจากระบบ</Button> : <Button variant="ghost" disabled={busy} onClick={() => {
        setMode(mode === 'login' ? 'register' : 'login')
        setError('')
      }}>{mode === 'login' ? 'สร้างบัญชี' : 'กลับไปเข้าสู่ระบบ'}</Button>}
    </div>
  </form>
}
