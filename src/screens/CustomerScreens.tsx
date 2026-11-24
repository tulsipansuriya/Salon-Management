import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { useLanguage } from '../i18n/LanguageContext'
import { API_BASE } from '../lib/api'
import './customer.css'

type Service = { id: string; nameEn: string; nameGu: string; durationMinutes: number; priceInr: number }
type Barber = { id: string; name: string; status: 'Free' | 'Busy' | 'On Break' }
type QueueData = {
  services: Service[]
  barbers: Barber[]
  waitingCount: number
  waitingTotalMinutes: number
  estimatedWaitMinutes: number
  availableBarberCount: number
  onlineQueueOpen: boolean
}

function useQueueData() {
  const [data, setData] = useState<QueueData | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let mounted = true
    const refresh = () => fetch(`${API_BASE}/api/bootstrap`)
      .then((response) => { if (!response.ok) throw new Error('Request failed'); return response.json() as Promise<QueueData> })
      .then((next) => { if (mounted) { setData(next); setFailed(false) } })
      .catch(() => { if (mounted) setFailed(true) })
    void refresh()
    const socket = io(API_BASE, { reconnection: true })
    socket.on('queue:update', refresh)
    const refreshTimer = window.setInterval(refresh, 30_000)
    return () => { mounted = false; window.clearInterval(refreshTimer); socket.disconnect() }
  }, [])
  return { data, failed }
}

function money(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

function waitEstimate(queue: QueueData | null, preferredBarber: string) {
  if (!queue) return 0
  if (preferredBarber !== 'Any' && queue.barbers.find((barber) => barber.name === preferredBarber)?.status === 'Free') return 0
  if (queue.availableBarberCount < 1) return queue.waitingTotalMinutes
  return Math.ceil(queue.waitingTotalMinutes / queue.availableBarberCount)
}

export function HomeScreen() {
  const { t } = useLanguage()
  const { data, failed } = useQueueData()
  const statusLabel = (status: Barber['status']) => status === 'Free' ? t('free') : status === 'Busy' ? t('busy') : t('onBreak')
  return <main className="customer-page home-page">
    <section className="home-hero">
      <div className="home-heading">
        <div><p className="customer-eyebrow">{t('welcome')}</p><h1>{t('salonName')}</h1></div>
        <span className={`queue-status ${data?.onlineQueueOpen ? 'is-open' : 'is-closed'}`}><span className="status-dot" />{data ? (data.onlineQueueOpen ? t('openCloses') : t('queueClosed')) : '…'}</span>
      </div>
      <div className="wait-card" aria-live="polite">
        <div className="wait-icon" aria-hidden="true">✦</div>
        <div>{!data ? <p className="wait-primary">{failed ? t('connectionError') : t('loading')}</p> : data.waitingCount === 0
          ? <><p className="wait-primary">{t('noWaiting')}</p><p className="wait-secondary">~0 {t('minutes')}</p></>
          : <><p className="wait-primary"><strong>{data.waitingCount}</strong> {t('peopleWaiting')}</p><p className="wait-secondary">~{data.estimatedWaitMinutes} {t('minuteWait')}</p></>}</div>
      </div>
      <section className="barber-section" aria-labelledby="barber-heading">
        <div className="section-heading"><h2 id="barber-heading">{t('barberLabel')}</h2><span>{data?.barbers.length ?? 3}</span></div>
        <div className="barber-chips">{(data?.barbers ?? [{ id: 'ravi', name: 'Ravi', status: 'Free' as const }, { id: 'amit', name: 'Amit', status: 'Free' as const }, { id: 'imran', name: 'Imran', status: 'Free' as const }]).map((barber) => <div className="barber-chip" key={barber.id}>
          <span className={`barber-avatar ${barber.status === 'On Break' ? 'avatar-break' : ''}`}>{barber.name.slice(0, 1)}</span>
          <span className="barber-chip-name">{barber.name}</span>
          <span className={`barber-state state-${barber.status.toLowerCase().replace(' ', '-')}`}><i />{statusLabel(barber.status)}</span>
        </div>)}</div>
      </section>
      {data && !data.onlineQueueOpen ? <div className="closed-message" role="status">{t('queueClosedMessage')}</div> : <Link className="primary-cta" to="/join">{t('join')}<span aria-hidden="true">→</span></Link>}
    </section>
    <p className="home-footnote">{t('homeDescription')}</p>
  </main>
}

export function JoinQueueScreen() {
  const { t, language } = useLanguage()
  const { data, failed } = useQueueData()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [preferredBarber, setPreferredBarber] = useState('Any')
  const [error, setError] = useState<string | null>(null)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const chosenServices = useMemo(() => data?.services.filter((service) => selectedServices.includes(service.id)) ?? [], [data, selectedServices])
  const duration = chosenServices.reduce((sum, service) => sum + service.durationMinutes, 0)
  const price = chosenServices.reduce((sum, service) => sum + service.priceInr, 0)
  const wait = waitEstimate(data, preferredBarber)
  const selectedBarberInfo = data?.barbers.find((barber) => barber.name === preferredBarber)

  const toggleService = (serviceId: string) => {
    setError(null); setDuplicateId(null)
    setSelectedServices((current) => current.includes(serviceId)
      ? current.filter((id) => id !== serviceId)
      : current.length < 3 ? [...current, serviceId] : current)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); setDuplicateId(null)
    if (!name.trim()) { setError('nameRequired'); return }
    if (!/^\d{10}$/.test(phone)) { setError('phoneInvalid'); return }
    if (selectedServices.length < 1) { setError('chooseServiceError'); return }
    if (!data?.onlineQueueOpen) { setError('queueClosedMessage'); return }
    setSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/api/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone, serviceIds: selectedServices, preferredBarber }),
      })
      const result = await response.json() as { id?: string; error?: string; existingId?: string }
      if (response.status === 201 && result.id) { navigate(`/status/${result.id}`); return }
      if (response.status === 409 && result.existingId) { setError('duplicatePhone'); setDuplicateId(result.existingId); return }
      if (result.error === 'QUEUE_CLOSED') setError('queueClosedMessage')
      else if (result.error === 'INVALID_PHONE') setError('phoneInvalid')
      else if (result.error === 'INVALID_SERVICE_COUNT' || result.error === 'INVALID_SERVICES') setError('chooseServiceError')
      else setError('bookingFailed')
    } catch { setError('bookingFailed') } finally { setSubmitting(false) }
  }

  return <main className="customer-page join-page">
    <div className="join-intro"><Link to="/" className="back-link"><span aria-hidden="true">←</span> {t('home')}</Link><p className="customer-eyebrow">{t('salonName')}</p><h1>{t('join')}</h1><p className="join-subtitle">{t('joinSubtitle')}</p></div>
    {!data && <div className="inline-notice" role="status">{failed ? t('connectionError') : t('loading')}</div>}
    {data && !data.onlineQueueOpen && <div className="inline-notice notice-warning" role="alert">{t('queueClosedMessage')}</div>}
    <form className="join-form" onSubmit={submit} noValidate>
      <div className="field-grid">
        <label className="form-field"><span>{t('customerName')} <b>*</b></span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('customerName')} required /></label>
        <label className="form-field"><span>{t('phoneNumber')} <b>*</b></span><input autoComplete="tel-national" inputMode="numeric" type="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} maxLength={10} placeholder={t('tenDigits')} required /><small>{phone.length}/10</small></label>
      </div>

      <section className="selection-section" aria-labelledby="services-heading">
        <div className="section-heading"><div><h2 id="services-heading">{t('services')}</h2><p>{t('selectServicesHelp')}</p></div><span>{selectedServices.length}/3</span></div>
        <div className="service-grid">{data?.services.map((service) => {
          const selected = selectedServices.includes(service.id)
          const atLimit = selectedServices.length === 3 && !selected
          return <button className={`service-card ${selected ? 'service-selected' : ''}`} type="button" key={service.id} aria-pressed={selected} disabled={atLimit} onClick={() => toggleService(service.id)}>
            <span className="service-check" aria-hidden="true">{selected ? '✓' : '+'}</span>
            <span className="service-name">{language === 'EN' ? service.nameEn : service.nameGu}</span>
            <span className="service-meta">{service.durationMinutes} {t('minutes')} <b>·</b> {money(service.priceInr)}</span>
          </button>
        })}</div>
        {selectedServices.length === 3 && <p className="limit-hint">{t('maxServices')}</p>}
      </section>

      <section className="selection-section barber-picker" aria-labelledby="barber-select-heading">
        <div className="section-heading"><div><h2 id="barber-select-heading">{t('barberPreference')}</h2></div></div>
        <div className="barber-options">
          <button type="button" className={`barber-option ${preferredBarber === 'Any' ? 'option-selected' : ''}`} aria-pressed={preferredBarber === 'Any'} onClick={() => setPreferredBarber('Any')}><span className="any-icon">✦</span><span>{t('anyBarber')}</span><span className="radio-mark" /></button>
          {data?.barbers.map((barber) => <button type="button" className={`barber-option ${preferredBarber === barber.name ? 'option-selected' : ''}`} key={barber.id} aria-pressed={preferredBarber === barber.name} onClick={() => setPreferredBarber(barber.name)}><span className="barber-avatar">{barber.name.slice(0, 1)}</span><span>{barber.name}<small className={`option-status state-${barber.status.toLowerCase().replace(' ', '-')}`}>{barber.status === 'Free' ? t('free') : barber.status === 'Busy' ? t('busy') : t('onBreak')}</small></span><span className="radio-mark" /></button>)}
        </div>
        {selectedBarberInfo?.status === 'On Break' && <p className="break-warning" role="status"><span aria-hidden="true">!</span><strong>{selectedBarberInfo.name}</strong> {t('breakWarning')}</p>}
      </section>

      {error && <div className="form-error" role="alert">{t(error as 'nameRequired')}{duplicateId && <Link to={`/status/${duplicateId}`}>{t('viewExistingSpot')}</Link>}</div>}
      {failed && <p className="connection-note">{t('connectionError')}</p>}
      <div className="form-bottom-space" />
      <aside className="booking-summary" aria-label={t('estimatedWait')}>
        <div className="summary-metrics"><div><span>{t('duration')}</span><strong>{duration} {t('minutes')}</strong></div><div><span>{t('price')}</span><strong>{money(price)}</strong></div><div><span>{t('estimatedWait')}</span><strong>~{wait} {t('minutes')}</strong></div></div>
        <button type="submit" className="primary-cta submit-cta" disabled={submitting || !data?.onlineQueueOpen}>{submitting ? t('loading') : t('confirmToken')}<span aria-hidden="true">→</span></button>
      </aside>
    </form>
  </main>
}
