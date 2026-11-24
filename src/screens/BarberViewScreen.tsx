import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { useLanguage } from '../i18n/LanguageContext'
import { API_BASE } from '../lib/api'
import type { TranslationKey } from '../i18n/translations'
import './barber.css'
type Service = { id: string; nameEn: string; nameGu: string }
type BarberViewData = {
  barber: { id: string; name: string; onBreak: boolean; status: string }
  currentCustomer: null | { id: string; token: string; customerName: string; status: 'Called' | 'In Chair'; services: Service[]; elapsedSeconds: number }
  nextCustomer: null | { id: string; token: string; customerName: string; services: Service[] }
  receivedAt: number
}

function formatElapsed(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`
}

export function BarberViewScreen() {
  const { name = '' } = useParams()
  const { t, language } = useLanguage()
  const [data, setData] = useState<BarberViewData | null>(null)
  const [tick, setTick] = useState(Date.now())
  const [error, setError] = useState<TranslationKey | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/barbers/${encodeURIComponent(name)}/view`)
      if (!response.ok) throw new Error('Barber load failed')
      const result = await response.json() as Omit<BarberViewData, 'receivedAt'>
      setData({ ...result, receivedAt: Date.now() })
      setError(null)
    } catch { setError('barberLoadError') }
  }

  useEffect(() => {
    setData(null)
    void refresh()
    const socket = io(API_BASE, { reconnection: true })
    socket.on('queue:update', () => { void refresh() })
    const poll = window.setInterval(() => { void refresh() }, 30_000)
    const clock = window.setInterval(() => setTick(Date.now()), 1_000)
    return () => { socket.disconnect(); window.clearInterval(poll); window.clearInterval(clock) }
  }, [name])

  const toggleBreak = async () => {
    if (!data || busy) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/barbers/${encodeURIComponent(data.barber.name)}/break`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onBreak: !data.barber.onBreak }),
      })
      if (!response.ok) throw new Error('Availability update failed')
      await refresh()
    } catch { setError('receptionActionFailed') } finally { setBusy(false) }
  }

  const transition = async (status: 'In Chair' | 'Done') => {
    if (!data?.currentCustomer || busy) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/barbers/${encodeURIComponent(data.barber.name)}/queue/${encodeURIComponent(data.currentCustomer.id)}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error('Service transition failed')
      await refresh()
    } catch { setError('receptionActionFailed') } finally { setBusy(false) }
  }

  const current = data?.currentCustomer
  const elapsed = current?.status === 'In Chair'
    ? current.elapsedSeconds + Math.floor((tick - (data?.receivedAt ?? tick)) / 1_000) : 0

  return <main className="barber-page">
    <div className="barber-page-heading"><div><p className="customer-eyebrow">{t('salonName')}</p><h1>{data?.barber.name ?? name}</h1><p>{t('barber')}</p></div>
      {data && <div className="availability-control"><span>{t('availability')}</span><button className={`availability-switch ${data.barber.onBreak ? 'switch-break' : 'switch-available'}`} type="button" role="switch" aria-label={t('availability')} aria-checked={!data.barber.onBreak} disabled={busy} onClick={() => void toggleBreak()}><i /><strong>{data.barber.onBreak ? t('onBreak') : t('availableLabel')}</strong></button></div>}
    </div>
    {error && <div className="reception-alert" role="alert">{t(error)}</div>}

    {!data ? <section className="barber-current-card barber-empty-card"><div className="barber-loader" aria-hidden="true">…</div><p>{t('loading')}</p></section> : <div className="barber-view-layout">
      <section className={`barber-current-card ${current?.status === 'Called' ? 'customer-called-card' : ''}`}>
        <div className="barber-card-heading"><div><p className="customer-eyebrow">{t('currentCustomer')}</p><h2>{current ? current.token : t('noCurrentCustomer')}</h2></div>
          {current && <span className={`booking-state state-${current.status.toLowerCase().replace(' ', '-')}`}><i />{t(current.status === 'Called' ? 'calledState' : 'inChairState')}</span>}
        </div>
        {current ? <>
          <p className="barber-customer-name">{current.customerName}</p>
          <div className="barber-services">{current.services.map((service) => <span key={service.id}>{language === 'EN' ? service.nameEn : service.nameGu}</span>)}</div>
          <div className="barber-timer"><span>{t('elapsedService')}</span><strong>{formatElapsed(elapsed)}</strong></div>
          {current.status === 'Called' && <button type="button" className="barber-action-button start-service-button" disabled={busy} onClick={() => void transition('In Chair')}>{t('startService')}<span aria-hidden="true">→</span></button>}
          {current.status === 'In Chair' && <button type="button" className="barber-action-button done-service-button" disabled={busy} onClick={() => void transition('Done')}>{t('doneAction')}<span aria-hidden="true">✓</span></button>}
        </> : <div className="barber-no-current"><span aria-hidden="true">✦</span><p>{t('noCurrentCustomer')}</p></div>}
      </section>

      <section className="barber-next-card"><div className="next-card-heading"><span aria-hidden="true">↗</span><h2>{t('nextForYou')}</h2></div>
        {data.nextCustomer ? <div className="next-customer-preview"><strong>{data.nextCustomer.token}</strong><span>{data.nextCustomer.customerName}</span><p>{data.nextCustomer.services.map((service) => language === 'EN' ? service.nameEn : service.nameGu).join(' · ')}</p></div>
          : <p className="next-empty">{t('noNextCustomer')}</p>}
      </section>
    </div>}
  </main>
}
