'use client'
import { useEffect, useState } from 'react'

type State = {
  agent: string; vault: string; chainId: number; explorer: string
  liquid: string; invested: string; total: string; error?: string
}
type Ev = { type: 'sweep' | 'withdraw' | 'pay'; amountUSDC: string; txHash: string; at: number; to?: string; memo?: string }

const fmt = (s: string | number) => Number(s).toLocaleString(undefined, { maximumFractionDigits: 6 })
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
const ago = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}

const LABEL: Record<Ev['type'], { t: string; c: string; icon: string }> = {
  sweep: { t: 'Invested idle USDC', c: '#3b82f6', icon: '↑' },
  withdraw: { t: 'Withdrew (just-in-time)', c: '#f59e0b', icon: '↓' },
  pay: { t: 'Paid for service', c: '#22c55e', icon: '→' },
}

export default function Page() {
  const [s, setS] = useState<State | null>(null)
  const [evs, setEvs] = useState<Ev[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [st, ev] = await Promise.all([
          fetch('/api/state').then((r) => r.json()),
          fetch('/api/events').then((r) => r.json()),
        ])
        if (!alive) return
        if (st.error) setErr(st.error)
        else { setS(st); setErr('') }
        setEvs(ev.events || [])
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, 4000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const liquid = s ? Number(s.liquid) : 0
  const invested = s ? Number(s.invested) : 0
  const total = liquid + invested
  const liqPct = total > 0 ? (liquid / total) * 100 : 0
  const lastPay = evs.find((e) => e.type === 'pay')
  const runway = lastPay && Number(lastPay.amountUSDC) > 0 ? Math.floor(total / Number(lastPay.amountUSDC)) : null

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <h1>Auto-Invest Agent <span className="live"><i />live</span></h1>
          <p className="sub">Idle USDC earns yield; redeemed just-in-time to pay for services · Arc Testnet</p>
        </div>
        {s && (
          <div className="meta">
            <a href={`${s.explorer}/address/${s.agent}`} target="_blank" rel="noreferrer">agent {short(s.agent)}</a>
            <a href={`${s.explorer}/address/${s.vault}`} target="_blank" rel="noreferrer">vault {short(s.vault)}</a>
          </div>
        )}
      </header>

      {err && <div className="err">⚠ {err}</div>}

      <section className="cards">
        <div className="card"><span className="lbl">Total balance</span><span className="val">{fmt(total)} <em>USDC</em></span></div>
        <div className="card"><span className="lbl">Liquid (spendable)</span><span className="val green">{fmt(liquid)}</span></div>
        <div className="card"><span className="lbl">Earning (invested)</span><span className="val blue">{fmt(invested)}</span></div>
        <div className="card"><span className="lbl">Runway</span><span className="val">{runway != null ? `~${runway} tasks` : '—'}</span></div>
      </section>

      <section className="split">
        <div className="bar">
          <div className="liq" style={{ width: `${liqPct}%` }} />
          <div className="inv" style={{ width: `${100 - liqPct}%` }} />
        </div>
        <div className="legend">
          <span><i className="dot green" />liquid {liqPct.toFixed(0)}%</span>
          <span><i className="dot blue" />earning {(100 - liqPct).toFixed(0)}%</span>
        </div>
      </section>

      <section className="feed">
        <h2>Activity</h2>
        {evs.length === 0 && (
          <p className="muted">No activity yet. Run <code>npm run demo</code> to see the agent invest, withdraw, and pay.</p>
        )}
        {evs.map((e, i) => {
          const L = LABEL[e.type]
          return (
            <div className="row" key={`${e.txHash}-${i}`}>
              <span className="ic" style={{ background: L.c }}>{L.icon}</span>
              <span className="rt">{L.t}{e.type === 'pay' && e.to ? ` → ${short(e.to)}` : ''}</span>
              <span className="amt">{fmt(e.amountUSDC)} USDC</span>
              {s && <a className="tx" href={`${s.explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">tx ↗</a>}
              <span className="time">{ago(e.at)}</span>
            </div>
          )
        })}
      </section>
    </main>
  )
}
