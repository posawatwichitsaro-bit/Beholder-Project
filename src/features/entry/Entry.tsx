import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Plus, Users } from 'lucide-react'
import type { Account, Snapshot, TableSummary } from '../../../shared/model.ts'
import { AccountPanel } from '../account/AccountPanel.tsx'
import { api, json as post } from '../../lib/api.ts'
import { BeholderEyeIcon, Button, GrimoireIcon } from '../../ui/index.ts'
import { joinPathFromLink, playedAgo } from './links.ts'

export type AccountProps = { account: Account | null; changeAccount: (account: Account | null) => void }

type Filter = 'all' | 'dm' | 'player'
const spines = ['#7a2f2f', '#2f5a6a', '#5a3a6a', '#5a4a2a', '#3a5a3a']
const covers = ['#3a2418', '#1f2a30', '#2a2030', '#2e2618', '#1f2a20']

function TableBook({ table, index }: { table: TableSummary; index: number }) {
  const online = table.members.filter(member => member.online).length
  const style = {
    '--_spine': spines[index % spines.length],
    '--_cover': covers[index % covers.length],
    ...(table.mapUrl ? { '--_art': `url("${table.mapUrl}")` } : {})
  } as CSSProperties
  return <Link className="lobby-book" to={'/room/' + table.id} style={style} aria-label={'เปิดโต๊ะ ' + table.name}>
    <span className="lobby-book-spine" aria-hidden="true" />
    <span className="lobby-book-cover" data-art={table.mapUrl ? 'true' : undefined}>
      <span className="lobby-book-role">{table.role === 'dm' ? 'DUNGEON MASTER' : 'ADVENTURER'}</span>
      <span className="lobby-book-title">{table.name}</span>
      <span className="lobby-book-rule" aria-hidden="true" />
      <span className="lobby-book-line">{table.sceneName ? 'ฉาก · ' + table.sceneName : 'ยังไม่ได้เปิดฉาก'}</span>
      <span className="lobby-book-line muted-line"><Users size={13} aria-hidden="true" /> {table.members.map(member => member.name).join(' · ')}</span>
      <span className="lobby-book-foot">
        <span className={online ? 'lobby-online' : 'muted-line'}>{online ? `● ออนไลน์ ${online} คน` : 'เล่นล่าสุด ' + playedAgo(table.updatedAt)}</span>
        <span className="lobby-book-open" aria-hidden="true">เปิดอ่านต่อ</span>
      </span>
    </span>
  </Link>
}

/**
 * The lobby. Signed in: the "bookshelf" of tables you sit at, plus a new-table
 * form. Signed out: create as a guest or sign in. With an invite: the join card.
 * Also shown when a table link cannot be opened, with the server's reason.
 */
export function Entry({ invite, roomId, dmLink, enter, initialError, account, changeAccount }: AccountProps & {
  invite?: string; roomId: string | null; dmLink: boolean; enter: (room: Snapshot) => void; initialError: string
}) {
  const navigate = useNavigate()
  const [error, setError] = useState(initialError)
  const [waiting, setWaiting] = useState(false)
  const [tables, setTables] = useState<TableSummary[]>()
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState('')
  useEffect(() => setError(initialError), [initialError])
  useEffect(() => {
    if (!account) { setTables(undefined); return }
    let alive = true
    api<TableSummary[]>('/api/account/rooms').then(list => { if (alive) setTables(list) }).catch(() => { if (alive) setTables([]) })
    return () => { alive = false }
  }, [account?.email])
  const shown = useMemo(() => (tables ?? []).filter(table => filter === 'all' || table.role === filter), [tables, filter])
  const counts = { all: tables?.length ?? 0, dm: tables?.filter(table => table.role === 'dm').length ?? 0, player: tables?.filter(table => table.role === 'player').length ?? 0 }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError('')
    setWaiting(true)
    try {
      enter(invite
        ? await api<Snapshot>('/api/join', post({ name: form.get('member'), invite, roomId, role: dmLink ? 'dm' : 'player' }))
        : await api<Snapshot>('/api/rooms', post({ name: form.get('room'), member: form.get('member') })))
    } catch (error) { setError((error as Error).message) }
    finally { setWaiting(false) }
  }
  function openLink(event: FormEvent) {
    event.preventDefault()
    const path = joinPathFromLink(link)
    if (!path) { setLinkError('ลิงก์นี้ไม่ใช่ลิงก์เชิญของ Beholder'); return }
    setLinkError('')
    navigate(path)
  }

  const nameField = account
    ? <p className="lobby-as">ชื่อที่ใช้บนโต๊ะ · {account.name}</p>
    : <label>ชื่อที่ใช้บนโต๊ะ<input name="member" required maxLength={120} autoComplete="nickname" /></label>
  const createForm = <form className="lobby-form lobby-create" onSubmit={submit}>
    <h2>{account ? 'เขียนเรื่องใหม่' : 'เปิดโต๊ะใหม่'}</h2>
    <label>ชื่อห้อง<input name="room" required maxLength={120} placeholder="เช่น ป้อมร้างริมทาง" autoFocus={creating} /></label>
    {nameField}
    {error && <p role="alert" className="lobby-error">{error}</p>}
    <div className="lobby-actions">
      <Button type="submit" variant="primary" className="primary" pending={waiting}>{waiting ? 'กำลังเชื่อมต่อ…' : 'สร้างห้อง DM'}</Button>
      {account && creating && <Button variant="ghost" onClick={() => setCreating(false)}>ยกเลิก</Button>}
    </div>
  </form>

  return <main className="lobby">
    <header className="lobby-top">
      <Link to="/" className="lobby-brand"><BeholderEyeIcon size={26} /><span>Beholder</span></Link>
      <span className="lobby-tagline">Dungeons &amp; Dragons · Virtual Tabletop</span>
      {account && <span className="lobby-me">{account.name}</span>}
    </header>

    <div className="lobby-body">
      <section className="lobby-shelf" aria-label={invite ? 'เข้าร่วมโต๊ะ' : account ? 'โต๊ะของฉัน' : 'เริ่มเล่น'}>
        {invite ? <form className="lobby-form lobby-join" onSubmit={submit}>
          <p className="lobby-kicker">คุณได้รับคำเชิญ</p>
          <h1>เข้าร่วมโต๊ะ</h1>
          <p className="lobby-role-note">{dmLink ? 'ลิงก์นี้เชิญคุณเป็น DM ร่วม · ใช้ได้ครั้งเดียว' : 'คุณจะเข้าร่วมในฐานะผู้เล่น'}</p>
          {nameField}
          {!account && <p className="lobby-hint">มีบัญชีอยู่แล้ว? เข้าสู่ระบบทางขวาก่อน แล้วกลับมาที่ห้องนี้ได้จากทุกเครื่อง</p>}
          {error && <p role="alert" className="lobby-error">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="primary" pending={waiting}>{waiting ? 'กำลังเชื่อมต่อ…' : 'เข้าร่วม'}</Button>
        </form> : account ? <>
          <div className="lobby-heading">
            <p className="lobby-kicker">ค่ำคืนนี้จะเปิดเรื่องไหนดี</p>
            <h1>ชั้นหนังสือของฉัน</h1>
          </div>
          {roomId && error && <p role="alert" className="lobby-error">{error}</p>}
          {!!tables?.length && <div className="lobby-filters" role="group" aria-label="กรองโต๊ะ">
            {([['all', 'ทั้งหมด'], ['dm', 'ฉันเป็น DM'], ['player', 'เข้าร่วม']] as const).map(([id, label]) =>
              <button key={id} type="button" className="bh-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} · {counts[id]}</button>)}
          </div>}
          {tables && <div className="lobby-books">
            {shown.map((table, index) => <TableBook key={table.id} table={table} index={index} />)}
            {creating || tables?.length === 0 ? createForm : <button type="button" className="lobby-new-book" onClick={() => setCreating(true)}>
              <Plus size={30} aria-hidden="true" />
              <span className="lobby-new-title">เขียนเรื่องใหม่</span>
              <span className="lobby-new-sub" aria-hidden="true">เปิดโต๊ะในฐานะ DM</span>
            </button>}
          </div>}
          {tables && !tables.length && <p className="lobby-empty">ยังไม่มีโต๊ะบนชั้น · เขียนเรื่องแรกของคุณด้านบน หรือวางลิงก์เชิญจากเพื่อน</p>}
          {!tables && <p className="lobby-empty">กำลังหยิบหนังสือลงจากชั้น…</p>}
        </> : <>
          <div className="lobby-heading">
            <p className="lobby-kicker">a tabletop grimoire</p>
            <h1>ยินดีต้อนรับ นักผจญภัย</h1>
            <p className="lobby-lead">เปิดโต๊ะให้เพื่อนเข้าร่วมด้วยลิงก์ หรือเข้าสู่ระบบเพื่อเก็บโต๊ะ ชีต และคลังไว้ใช้ได้ทุกเครื่อง</p>
          </div>
          {createForm}
        </>}
      </section>

      <aside className="lobby-journal bh-on-parchment" aria-label="บัญชีและลิงก์เชิญ">
        <span className="lobby-ribbon" aria-hidden="true" />
        <AccountPanel account={account} change={changeAccount} />
        {!invite && <form className="lobby-link" onSubmit={openLink}>
          <h2><GrimoireIcon size={18} /> มีลิงก์เชิญจากเพื่อน?</h2>
          <label>วางลิงก์ที่ DM ส่งมา<input value={link} onChange={event => setLink(event.target.value)} placeholder="https://…/?invite=…" /></label>
          {linkError && <p role="alert" className="lobby-error">{linkError}</p>}
          <Button type="submit" variant="brass">ไปที่หน้าเข้าร่วม</Button>
        </form>}
      </aside>
    </div>
  </main>
}
