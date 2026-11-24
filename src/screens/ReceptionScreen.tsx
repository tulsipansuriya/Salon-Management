import { useEffect, useState, type FormEvent } from 'react'
import { io } from 'socket.io-client'
import { useLanguage } from '../i18n/LanguageContext'
import { API_BASE } from '../lib/api'
import type { TranslationKey } from '../i18n/translations'
import './reception.css'
type Service = { id: string; nameEn: string; nameGu: string; durationMinutes: number; priceInr: number }
type BarberCard = { id: string; name: string; status: 'Free' | 'Busy' | 'On Break'; currentCustomer: null | { id: string; token: string; name: string; status: string; elapsedSeconds: number } }
type QueueRow = { id: string; token: string; customerName: string; phone: string; services: Service[]; preferredBarber: string | null; assignedBarber: string | null; status: 'Waiting' | 'Called'; waitingSeconds: number }
type ReceptionData = { barbers: BarberCard[]; waitingQueue: QueueRow[]; receivedAt: number }

function statusKey(status: string): TranslationKey {
  if (status === 'Free') return 'free'
  if (status === 'Busy') return 'busy'
  if (status === 'On Break') return 'onBreak'
  return status === 'Called' ? 'calledState' : status === 'Waiting' ? 'waitingState' : 'inChairState'
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remaining = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

export function ReceptionScreen() {
  const { t, language } = useLanguage()
  const [services, setServices] = useState<Service[]>([])
  const [data, setData] = useState<ReceptionData | null>(null)
  const [tick, setTick] = useState(Date.now())
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<TranslationKey | null>(null)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [preferredBarber, setPreferredBarber] = useState('Any')
  const [formError, setFormError] = useState<TranslationKey | null>(null)
  const [savingWalkIn, setSavingWalkIn] = useState(false)

  const refresh = async () => {
    try {
      const [bootstrapResponse, receptionResponse] = await Promise.all([
        fetch(`${API_BASE}/api/bootstrap`), fetch(`${API_BASE}/api/reception`),
      ])
      if (!bootstrapResponse.ok || !receptionResponse.ok) throw new Error('Unable to load reception')
      const bootstrap = await bootstrapResponse.json() as { services: Service[] }
      const reception = await receptionResponse.json() as Omit<ReceptionData, 'receivedAt'>
      setServices(bootstrap.services)
      setData({ ...reception, receivedAt: Date.now() })
      setLoadError(false)
    } catch { setLoadError(true) }
  }

  useEffect(() => {
    void refresh()
    const socket = io(API_BASE, { reconnection: true })
    socket.on('queue:update', () => { void refresh() })
    const poll = window.setInterval(() => { void refresh() }, 30_000)
    const clock = window.setInterval(() => setTick(Date.now()), 1_000)
    return () => { socket.disconnect(); window.clearInterval(poll); window.clearInterval(clock) }
  }, [])

  const selectedBarber = data?.barbers.find((barber) => barber.name === preferredBarber)

  const toggleService = (serviceId: string) => {
    setFormError(null)
    setServiceIds((current) => current.includes(serviceId) ? current.filter((id) => id !== serviceId) : current.length < 3 ? [...current, serviceId] : current)
  }

  const createWalkIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError(null)
    if (!name.trim()) { setFormError('nameRequired'); return }
    if (!/^\d{10}$/.test(phone)) { setFormError('phoneInvalid'); return }
    if (serviceIds.length < 1 || serviceIds.length > 3) { setFormError('chooseServiceError'); return }
    setSavingWalkIn(true)
    try {
      const response = await fetch(`${API_BASE}/api/reception/walk-ins`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone, serviceIds, preferredBarber }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) {
        if (result.error === 'INVALID_PHONE') setFormError('phoneInvalid')
        else if (result.error === 'INVALID_SERVICE_COUNT' || result.error === 'INVALID_SERVICES') setFormError('chooseServiceError')
        else if (result.error === 'DUPLICATE_ACTIVE_PHONE') setFormError('duplicatePhone')
        else setFormError('receptionActionFailed')
        return
      }
      setWalkInOpen(false); setName(''); setPhone(''); setServiceIds([]); setPreferredBarber('Any')
      setFormError(null); setActionError(null); void refresh()
    } catch { setFormError('receptionActionFailed') } finally { setSavingWalkIn(false) }
  }

  const callNext = async (barber: string) => {
    setActionError(null)
    try {
      const response = await fetch(`${API_BASE}/api/barbers/${encodeURIComponent(barber)}/call-next`, { method: 'POST' })
      const result = await response.json() as { error?: string }
      if (!response.ok) {
        const errors: Record<string, TranslationKey> = {
          BARBER_NOT_AVAILABLE: 'barberNotAvailable', BARBER_ON_BREAK: 'barberOnBreakError',
          BARBER_HAS_ACTIVE_CUSTOMER: 'barberAlreadyServing', NO_ELIGIBLE_CUSTOMER: 'noEligibleCustomer',
        }
        setActionError(errors[result.error ?? ''] ?? 'receptionActionFailed')
      }
      void refresh()
    } catch { setActionError('receptionActionFailed') }
  }

  const transition = async (id: string, status: 'No-show' | 'Cancelled') => {
    setActionError(null)
    try {
      const response = await fetch(`${API_BASE}/api/queue/${encodeURIComponent(id)}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error('Queue transition failed')
      void refresh()
    } catch { setActionError('receptionActionFailed') }
  }

  return <main className="reception-page">
    <div className="reception-topbar"><div><p className="customer-eyebrow">{t('salonName')}</p><h1>{t('reception')}</h1><p>{t('receptionIntro')}</p></div>
      <button type="button" className="add-walkin-button" onClick={() => { setWalkInOpen(true); setFormError(null) }}>{t('addWalkIn')}</button>
    </div>
    {actionError && <div className="reception-alert" role="alert">{t(actionError)}</div>}
    {loadError && <div className="reception-alert" role="alert">{t('connectionError')}</div>}

    <div className="reception-layout">
      <section className="barber-panel" aria-labelledby="barber-cards-title"><div className="panel-heading"><div><h2 id="barber-cards-title">{t('barberLabel')}</h2></div><span>{data?.barbers.length ?? 3}</span></div>
        <div className="barber-card-list">{(data?.barbers ?? []).map((barber) => {
          const current = barber.currentCustomer
          const elapsed = current ? current.elapsedSeconds + Math.floor((tick - (data?.receivedAt ?? tick)) / 1000) : 0
          return <article className={`reception-barber-card ${barber.status === 'On Break' ? 'reception-break' : ''}`} key={barber.id}>
            <div className="reception-barber-head"><span className="barber-avatar">{barber.name.slice(0, 1)}</span><div className="reception-barber-name"><strong>{barber.name}</strong><span className={`barber-state state-${barber.status.toLowerCase().replace(' ', '-')}`}><i />{t(statusKey(barber.status))}</span></div></div>
            {current ? <div className="reception-current"><div><span>{t('currentCustomer')}</span><strong>{current.token} · {current.name}</strong></div><div className="elapsed-value"><span>{t('elapsedService')}</span><strong>{formatTime(elapsed)}</strong></div></div>
              : <p className="no-current-customer">{t('noCurrentCustomer')}</p>}
            <button type="button" className="call-next-button" disabled={!data || barber.status !== 'Free'} onClick={() => void callNext(barber.name)}>{t('callNextAction')}<span aria-hidden="true">→</span></button>
          </article>
        })}</div>
      </section>

      <section className="queue-panel" aria-labelledby="waiting-queue-title"><div className="panel-heading"><div><h2 id="waiting-queue-title">{t('waitingQueue')}</h2></div><span>{data?.waitingQueue.filter((row) => row.status === 'Waiting').length ?? 0}</span></div>
        {!data?.waitingQueue.length ? <div className="queue-empty"><span aria-hidden="true">✦</span><p>{t('queueEmpty')}</p></div> : <div className="reception-table-wrap"><table className="reception-table"><thead><tr><th>{t('tokenHeading')}</th><th>{t('customerNameLabel')}</th><th>{t('phoneNumber')}</th><th>{t('services')}</th><th>{t('preferredBarber')}</th><th>{t('waitingTime')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead>
          <tbody>{data.waitingQueue.map((row) => {
            const seconds = row.waitingSeconds + Math.floor((tick - data.receivedAt) / 1000)
            const barberText = row.preferredBarber ?? t('anyBarberStatus')
            return <tr key={row.id} className={`${row.status === 'Waiting' && seconds > 3600 ? 'long-wait-row' : ''} ${row.status === 'Called' ? 'called-row' : ''}`}>
              <td><strong className="queue-token">{row.token}</strong>{row.status === 'Called' && <small className="row-status">{t('calledState')}</small>}</td>
              <td><strong>{row.customerName}</strong></td><td>{row.phone}</td>
              <td><div className="queue-service-list">{row.services.map((service) => <span key={service.id}>{language === 'EN' ? service.nameEn : service.nameGu}</span>)}</div></td>
              <td>{barberText}</td><td><span className="waiting-time-value">{Math.floor(seconds / 60)} {t('minutesAgo')}</span></td>
              <td><div className="queue-row-actions">{row.status === 'Called' ? <button type="button" className="no-show-button" onClick={() => void transition(row.id, 'No-show')}>{t('noShowAction')}</button> : <button type="button" className="cancel-queue-button" onClick={() => void transition(row.id, 'Cancelled')}>{t('cancelAction')}</button>}</div></td>
            </tr>
          })}</tbody></table></div>}
      </section>
    </div>

    {walkInOpen && <div className="walkin-backdrop"><section className="walkin-modal" role="dialog" aria-modal="true" aria-labelledby="walkin-title">
      <div className="walkin-modal-heading"><div><p className="customer-eyebrow">{t('reception')}</p><h2 id="walkin-title">{t('walkInTitle')}</h2></div><button className="walkin-close" type="button" aria-label={t('close')} onClick={() => setWalkInOpen(false)}>×</button></div>
      <form onSubmit={(event) => void createWalkIn(event)} noValidate>
        <div className="walkin-fields"><label className="form-field"><span>{t('customerNameLabel')} <b>*</b></span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('customerNameLabel')} /></label>
          <label className="form-field"><span>{t('phoneNumber')} <b>*</b></span><input autoComplete="tel-national" inputMode="numeric" type="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} maxLength={10} placeholder={t('tenDigits')} /></label></div>
        <section className="walkin-section"><div className="panel-heading"><div><h3>{t('services')}</h3><p>{t('selectServicesHelp')}</p></div><span>{serviceIds.length}/3</span></div><div className="walkin-service-grid">{services.map((service) => {
          const selected = serviceIds.includes(service.id)
          const disabled = serviceIds.length >= 3 && !selected
          return <button type="button" key={service.id} className={`walkin-service ${selected ? 'walkin-service-selected' : ''}`} disabled={disabled} aria-pressed={selected} onClick={() => toggleService(service.id)}><span>{language === 'EN' ? service.nameEn : service.nameGu}</span><small>{service.durationMinutes} {t('minutes')} · ₹{service.priceInr}</small><i>{selected ? '✓' : '+'}</i></button>
        })}</div></section>
        <section className="walkin-section"><label className="form-field"><span>{t('preferredBarberLabel')}</span><select value={preferredBarber} onChange={(event) => { setPreferredBarber(event.target.value); setFormError(null) }}><option value="Any">{t('anyBarber')}</option>{(data?.barbers ?? []).map((barber) => <option key={barber.id} value={barber.name}>{barber.name} · {t(statusKey(barber.status))}</option>)}</select></label>
          {selectedBarber?.status === 'On Break' && <p className="break-warning"><span>!</span><strong>{selectedBarber.name}</strong> {t('breakWarning')}</p>}</section>
        {formError && <div className="form-error" role="alert">{t(formError)}</div>}
        <div className="walkin-actions"><button type="button" className="keep-spot-button" onClick={() => setWalkInOpen(false)} disabled={savingWalkIn}>{t('close')}</button><button type="submit" className="save-walkin-button" disabled={savingWalkIn}>{savingWalkIn ? t('loading') : t('walkInTitle')}</button></div>
      </form>
    </section></div>}
  </main>
}
