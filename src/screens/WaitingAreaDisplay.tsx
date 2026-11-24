import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { useLanguage } from '../i18n/LanguageContext'
import './display.css'

const API_BASE = 'http://localhost:3001'
type DisplayData = {
  barbers: { id: string; name: string; status: 'Free' | 'Busy' | 'On Break'; currentCustomer: null | { id: string; token: string; status: 'Called' | 'In Chair'; calledAt: string | null; flashUntil: string | null } }[]
  upNext: { id: string; token: string; services: { id: string; nameEn: string; nameGu: string }[]; estimatedWaitMinutes: number }[]
  waitingCount: number
}

export function WaitingAreaDisplay() {
  const { t, language } = useLanguage()
  const [data, setData] = useState<DisplayData | null>(null)
  const [flashUntil, setFlashUntil] = useState<Record<string, number>>({})
  const flashTimers = useRef(new Map<string, number>())
  const [, setClock] = useState(Date.now())

  const flashToken = (id: string, until: number) => {
    setFlashUntil((current) => ({ ...current, [id]: until }))
    const previousTimer = flashTimers.current.get(id)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const timer = window.setTimeout(() => {
      setFlashUntil((current) => {
        if (current[id] !== until) return current
        const next = { ...current }
        delete next[id]
        return next
      })
      flashTimers.current.delete(id)
    }, Math.max(0, until - Date.now()))
    flashTimers.current.set(id, timer)
  }

  const refresh = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/display`)
      if (!response.ok) throw new Error('Display refresh failed')
      const result = await response.json() as DisplayData
      setData(result)
      for (const barber of result.barbers) {
        const current = barber.currentCustomer
        if (current?.status === 'Called' && current.flashUntil) {
          const until = Date.parse(current.flashUntil)
          if (until > Date.now()) flashToken(current.id, until)
        }
      }
    } catch { /* Keep the last live snapshot on transient connection errors. */ }
  }

  useEffect(() => {
    void refresh()
    const socket = io(API_BASE, { reconnection: true })
    socket.on('queue:update', () => { void refresh() })
    socket.on('queue:called', (event: { id: string; durationMs?: number }) => {
      flashToken(event.id, Date.now() + (event.durationMs ?? 5_000))
      void refresh()
    })
    const poll = window.setInterval(() => { void refresh() }, 30_000)
    const clock = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => {
      socket.disconnect(); window.clearInterval(poll); window.clearInterval(clock)
      for (const timer of flashTimers.current.values()) window.clearTimeout(timer)
      flashTimers.current.clear()
    }
  }, [])

  return <main className="display-page">
    <header className="display-header"><div className="display-brand"><span className="display-mark" aria-hidden="true">✦</span><div><p>{t('salonName')}</p><span>{t('nowServing')}</span></div></div><div className="display-queue-count"><strong>{data?.waitingCount ?? 0}</strong><span>{t('peopleWaiting')}</span></div></header>
    <div className="display-layout">
      <section className="display-serving-section" aria-labelledby="now-serving-title"><div className="display-section-heading"><span className="display-live-dot" /><h1 id="now-serving-title">{t('nowServing')}</h1></div>
        <div className="display-barber-grid">{(data?.barbers ?? []).map((barber) => {
          const current = barber.currentCustomer
          const isFlashing = Boolean(current && (flashUntil[current.id] ?? 0) > Date.now())
          return <article key={barber.id} className={`display-barber-card ${isFlashing ? 'display-called-flash' : ''}`}>
            <div className="display-barber-name"><span className="display-avatar">{barber.name.slice(0, 1)}</span><strong>{barber.name}</strong></div>
            <div className="display-now-token"><span>{t('nowPrefix')}:</span><strong>{current?.token ?? '—'}</strong></div>
            <span className={`display-barber-status display-status-${barber.status.toLowerCase().replace(' ', '-')}`}>{t(barber.status === 'Free' ? 'displayFree' : barber.status === 'Busy' ? 'busy' : 'onBreak')}</span>
          </article>
        })}</div>
      </section>

      <section className="display-next-section" aria-labelledby="up-next-title"><div className="display-section-heading"><span className="display-next-mark" aria-hidden="true">↗</span><h2 id="up-next-title">{t('upNext')}</h2><span className="display-next-count">{Math.min(data?.upNext.length ?? 0, 5)}/5</span></div>
        {!data?.upNext.length ? <div className="display-empty"><span aria-hidden="true">✦</span><p>{t('noTokensWaiting')}</p></div> : <ol className="display-next-list">{data.upNext.slice(0, 5).map((entry, index) => <li className="display-next-row" key={entry.id}>
          <span className="display-next-rank">{String(index + 1).padStart(2, '0')}</span><strong className="display-next-token">{entry.token}</strong>
          <span className="display-next-services">{entry.services.map((service) => language === 'EN' ? service.nameEn : service.nameGu).join(' · ')}</span>
          <span className="display-next-wait"><small>{t('displayWait')}</small><strong>~{entry.estimatedWaitMinutes} {t('minutes')}</strong></span>
        </li>)}</ol>}
      </section>
    </div>
    <footer className="display-footer"><span>{t('salonName')}</span><span>{t('waitingQueue')}</span></footer>
  </main>
}
