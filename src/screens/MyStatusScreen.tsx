import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { useLanguage } from '../i18n/LanguageContext'
import { API_BASE } from '../lib/api'
import type { TranslationKey } from '../i18n/translations'
import './status.css'

type BookingStatus = {
  id: string
  token: string
  customerName: string
  services: { id: string; nameEn: string; nameGu: string }[]
  preferredBarber: string | null
  barberName: string | null
  status: 'Waiting' | 'Called' | 'In Chair' | 'Done' | 'Cancelled' | 'No-show'
  queuePosition: number | null
  estimatedWaitMinutes: number
  durationMinutes: number
}

function stateLabel(status: BookingStatus['status'], t: (key: TranslationKey) => string) {
  const keys: Record<BookingStatus['status'], TranslationKey> = {
    Waiting: 'waitingState', Called: 'calledState', 'In Chair': 'inChairState',
    Done: 'doneState', Cancelled: 'cancelledState', 'No-show': 'cancelledState',
  }
  return t(keys[status])
}

export function MyStatusScreen() {
  const { id = '' } = useParams()
  const { t, language } = useLanguage()
  const [booking, setBooking] = useState<BookingStatus | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [initialSeconds, setInitialSeconds] = useState(0)
  const lastServerEstimate = useRef<number | null>(null)
  const [error, setError] = useState<'statusNotFound' | 'statusLoadFailed' | 'cancelFailed' | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let mounted = true
    setBooking(null)
    setError(null)
    lastServerEstimate.current = null
    const refresh = () => fetch(`${API_BASE}/api/bookings/${encodeURIComponent(id)}`)
      .then(async (response) => ({ response, data: await response.json() as BookingStatus & { error?: string } }))
      .then(({ response, data }) => {
        if (!mounted) return
        if (!response.ok) {
          setError(response.status === 404 ? 'statusNotFound' : 'statusLoadFailed')
          return
        }
        setBooking(data)
        setError(null)
        if (lastServerEstimate.current !== data.estimatedWaitMinutes) {
          lastServerEstimate.current = data.estimatedWaitMinutes
          const seconds = Math.max(0, data.estimatedWaitMinutes * 60)
          setInitialSeconds(seconds)
          setRemainingSeconds(seconds)
        }
      })
      .catch(() => { if (mounted) setError('statusLoadFailed') })
    void refresh()
    const socket = io(API_BASE, { reconnection: true })
    socket.on('queue:update', refresh)
    const refreshTimer = window.setInterval(refresh, 30_000)
    return () => { mounted = false; window.clearInterval(refreshTimer); socket.disconnect() }
  }, [id])

  useEffect(() => {
    const timer = window.setInterval(() => setRemainingSeconds((seconds) => Math.max(0, seconds - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (booking?.status === 'Called' && typeof navigator.vibrate === 'function') navigator.vibrate([250, 120, 250])
  }, [booking?.status])

  const cancelSpot = async () => {
    if (!booking || booking.status !== 'Waiting') return
    setCancelling(true)
    try {
      const response = await fetch(`${API_BASE}/api/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
      if (!response.ok) throw new Error('Cancellation failed')
      const updated = await response.json() as BookingStatus
      setBooking(updated)
      lastServerEstimate.current = updated.estimatedWaitMinutes
      setInitialSeconds(updated.estimatedWaitMinutes * 60)
      setRemainingSeconds(updated.estimatedWaitMinutes * 60)
      setConfirmingCancel(false)
      setError(null)
    } catch { setError('cancelFailed') } finally { setCancelling(false) }
  }

  if (booking?.status === 'Called') return <main className="called-takeover" role="status" aria-live="assertive">
    <div className="called-pulse" aria-hidden="true"><span>✦</span></div>
    <p className="called-eyebrow">{t('salonName')}</p>
    <h1>{t('yourTurn')}</h1>
    <p className="called-destination">{t('goToBarber')} <strong>{booking.barberName ?? t('salonName')}</strong></p>
    <div className="called-token">{booking.token}</div>
  </main>

  if (!booking) return <main className="status-page">
    <section className="status-card status-message-card" role={error ? 'alert' : 'status'}>
      <div className="status-loader" aria-hidden="true">{error ? '!' : '…'}</div>
      <h1>{error ? t(error) : t('loading')}</h1>
      {error === 'statusNotFound' && <Link className="status-home-link" to="/">{t('home')}</Link>}
    </section>
  </main>

  const countdownMinutes = Math.ceil(remainingSeconds / 60)
  const progress = initialSeconds > 0 ? Math.min(1, remainingSeconds / initialSeconds) : 0
  const circumference = 2 * Math.PI * 68
  const barberName = booking.barberName ?? booking.preferredBarber ?? t('anyBarberStatus')

  return <main className="status-page">
    {error && <p className="status-error" role="alert">{t(error)}</p>}
    <section className="status-card">
      <div className="status-card-top"><div><p className="customer-eyebrow">{t('salonName')}</p><h1>{t('status')}</h1><p className="status-greeting">{booking.customerName}</p></div><span className={`booking-state state-${booking.status.toLowerCase().replace(' ', '-')}`}><i />{stateLabel(booking.status, t)}</span></div>

      <div className="status-main-grid">
        <div className="token-panel"><span className="token-caption">{t('tokenLabel')}</span><strong className="token-number">{booking.token}</strong>
          {booking.queuePosition !== null && <div className="queue-position"><strong>{booking.queuePosition}</strong><span>{t('inLine')}<small>{t('queuePosition')}</small></span></div>}
        </div>
        <div className="countdown-panel" aria-live="polite" aria-label={`${t('estimatedWait')}: ${countdownMinutes} ${t('minutes')}`}>
          <div className="countdown-circle"><svg viewBox="0 0 160 160" aria-hidden="true"><circle className="countdown-track" cx="80" cy="80" r="68" /><circle className="countdown-progress" cx="80" cy="80" r="68" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }} /></svg>
            <div className="countdown-center"><strong>~{countdownMinutes}</strong><span>{t('minutes')}</span></div>
          </div><span className="countdown-label">{t('estimatedWait')}</span>
        </div>
      </div>

      {booking.status === 'Waiting' && booking.queuePosition === 2 && <div className="almost-up-banner" role="status"><span aria-hidden="true">✦</span><div><strong>{t('almostUp')}</strong><p>{t('startHeading')}</p></div></div>}

      <div className="booking-details">
        <section className="detail-block"><h2>{t('selectedServices')}</h2><ul>{booking.services.map((service) => <li key={service.id}>{language === 'EN' ? service.nameEn : service.nameGu}</li>)}</ul></section>
        <section className="detail-block barber-detail"><h2>{t('preferredBarberLabel')}</h2><p><span className="barber-avatar">{barberName.slice(0, 1)}</span>{barberName}</p></section>
      </div>

      {booking.status === 'Waiting' && <button type="button" className="cancel-spot-button" onClick={() => setConfirmingCancel(true)}>{t('cancelSpot')}</button>}
    </section>

    {confirmingCancel && <div className="status-modal-backdrop"><section className="status-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title" aria-describedby="cancel-description">
      <div className="dialog-symbol" aria-hidden="true">?</div><h2 id="cancel-title">{t('cancelSpot')}</h2><p id="cancel-description">{t('cancelPrompt')}</p>
      <div className="dialog-actions"><button type="button" className="keep-spot-button" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>{t('keepSpot')}</button><button type="button" className="confirm-cancel-button" onClick={() => void cancelSpot()} disabled={cancelling}>{cancelling ? t('cancelling') : t('confirmCancel')}</button></div>
    </section></div>}
  </main>
}
