import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { io } from 'socket.io-client'
import { useLanguage } from '../i18n/LanguageContext'
import './admin.css'

const API_BASE = 'http://localhost:3001'

type Service = { id: string; nameEn: string; nameGu: string; durationMinutes: number; priceInr: number; enabled: number }
type Barber = { id: string; name: string; onDuty: number }
type AdminData = {
  services: Service[]; barbers: Barber[]; manualQueueOpen: boolean; onlineQueueOpen: boolean; closingCutoffReached: boolean
  stats: { customersServed: number; averageWaitMinutes: number; noShows: number }
}
type ServiceForm = { nameEn: string; nameGu: string; durationMinutes: string; priceInr: string }
const emptyService: ServiceForm = { nameEn: '', nameGu: '', durationMinutes: '', priceInr: '' }

export function AdminSettingsScreen() {
  const { t } = useLanguage()
  const [data, setData] = useState<AdminData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<ServiceForm>(emptyService)
  const [formError, setFormError] = useState(false)

  const refresh = useCallback(() => fetch(`${API_BASE}/api/admin`)
    .then((response) => { if (!response.ok) throw new Error('Request failed'); return response.json() as Promise<AdminData> })
    .then((next) => { setData(next); setLoadError(false) })
    .catch(() => setLoadError(true)), [])

  useEffect(() => {
    void refresh()
    const socket = io(API_BASE, { reconnection: true })
    socket.on('queue:update', refresh)
    const interval = window.setInterval(() => { void refresh() }, 30_000)
    return () => { window.clearInterval(interval); socket.disconnect() }
  }, [refresh])

  const send = async (path: string, method: 'POST' | 'PATCH', body: unknown) => {
    setSaving(true); setSaveError(null)
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) {
        if (result.error === 'BARBER_HAS_ACTIVE_CUSTOMER') setSaveError('barberActiveError')
        else if (result.error === 'INVALID_SERVICE') setFormError(true)
        else setSaveError('adminSaveError')
        return false
      }
      await refresh()
      return true
    } catch {
      setSaveError('adminSaveError')
      return false
    } finally { setSaving(false) }
  }

  const openNewService = () => { setEditing(null); setModalOpen(true); setForm(emptyService); setFormError(false); setSaveError(null) }
  const openEditService = (service: Service) => {
    setEditing(service)
    setModalOpen(true)
    setForm({ nameEn: service.nameEn, nameGu: service.nameGu, durationMinutes: String(service.durationMinutes), priceInr: String(service.priceInr) })
    setFormError(false); setSaveError(null)
  }
  const saveService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError(false)
    const durationMinutes = Number(form.durationMinutes)
    const priceInr = Number(form.priceInr)
    if (!form.nameEn.trim() || !form.nameGu.trim() || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(priceInr) || priceInr < 0) {
      setFormError(true); return
    }
    const ok = await send(editing ? `/api/admin/services/${editing.id}` : '/api/admin/services', editing ? 'PATCH' : 'POST', {
      nameEn: form.nameEn.trim(), nameGu: form.nameGu.trim(), durationMinutes, priceInr,
    })
    if (ok) { setEditing(null); setModalOpen(false) }
  }

  const toggleOnlineQueue = () => { if (data) void send('/api/admin/online-queue', 'PATCH', { open: !data.onlineQueueOpen }) }
  const toggleDuty = (barber: Barber) => { void send(`/api/admin/barbers/${encodeURIComponent(barber.name)}/duty`, 'PATCH', { onDuty: !Boolean(barber.onDuty) }) }
  const toggleService = (service: Service) => { void send(`/api/admin/services/${service.id}`, 'PATCH', { enabled: !Boolean(service.enabled) }) }

  return <main className="admin-page">
    <header className="admin-heading">
      <div><p className="admin-eyebrow">{t('salonName')}</p><h1>{t('admin')}</h1><p>{t('adminIntro')}</p></div>
      <span className={`admin-live-badge ${data?.onlineQueueOpen ? 'is-open' : 'is-closed'}`}><i />{data?.onlineQueueOpen ? t('openLabel') : t('closedLabel')}</span>
    </header>

    {loadError && <div className="admin-alert" role="alert">{t('adminLoadError')}</div>}
    {saveError && <div className="admin-alert" role="alert">{t(saveError as 'adminSaveError')}</div>}

    {data && <>
      <section className="admin-stats" aria-label={t('customersServed')}>
        <article className="admin-stat-card"><span className="admin-stat-icon">✓</span><span>{t('customersServed')}</span><strong>{data.stats.customersServed}</strong><small>{t('todayLabel')}</small></article>
        <article className="admin-stat-card"><span className="admin-stat-icon">◷</span><span>{t('averageWaitToday')}</span><strong>{data.stats.averageWaitMinutes}<small> {t('minutes')}</small></strong><small>{t('todayLabel')}</small></article>
        <article className="admin-stat-card"><span className="admin-stat-icon">!</span><span>{t('noShowsToday')}</span><strong>{data.stats.noShows}</strong><small>{t('todayLabel')}</small></article>
      </section>

      <section className="admin-panel online-control">
        <div className="admin-section-heading"><span className="admin-section-icon">↗</span><div><h2>{t('onlineQueue')}</h2><p>{data.closingCutoffReached ? t('cutoffReached') : data.manualQueueOpen ? t('queueOpenHelp') : t('queueClosedHelp')}</p></div></div>
        <button type="button" role="switch" aria-checked={data.onlineQueueOpen} aria-label={t('onlineQueue')} className={`admin-switch ${data.onlineQueueOpen ? 'switch-on' : ''}`} disabled={saving || data.closingCutoffReached} onClick={toggleOnlineQueue}>
          <span className="switch-track"><i /></span><strong>{data.onlineQueueOpen ? t('openLabel') : t('closedLabel')}</strong>
        </button>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-title"><div><p className="admin-eyebrow">{t('availability')}</p><h2>{t('barbersOnDuty')}</h2></div><span>{data.barbers.filter((barber) => Boolean(barber.onDuty)).length}/{data.barbers.length}</span></div>
        <div className="duty-list">{data.barbers.map((barber) => <article className="duty-row" key={barber.id}>
          <span className="admin-avatar">{barber.name.slice(0, 1)}</span><strong>{barber.name}</strong>
          <span className={`duty-state ${barber.onDuty ? 'duty-active' : ''}`}>{barber.onDuty ? t('onDutyLabel') : t('offDutyLabel')}</span>
          <button type="button" role="switch" aria-checked={Boolean(barber.onDuty)} aria-label={`${barber.name} · ${t('barbersOnDuty')}`} className={`admin-switch compact-switch ${barber.onDuty ? 'switch-on' : ''}`} disabled={saving} onClick={() => toggleDuty(barber)}><span className="switch-track"><i /></span></button>
        </article>)}</div>
      </section>

      <section className="admin-panel services-panel">
        <div className="admin-panel-title"><div><p className="admin-eyebrow">{t('services')}</p><h2>{t('servicesManager')}</h2></div><button type="button" className="admin-add-button" onClick={openNewService}><span>+</span>{t('addService')}</button></div>
        {data.services.length === 0 ? <div className="admin-empty">{t('noServices')}</div> : <div className="admin-service-list">{data.services.map((service) => <article className={`admin-service-row ${service.enabled ? '' : 'service-hidden'}`} key={service.id}>
          <div className="service-details"><strong>{service.nameEn}</strong><span>{service.nameGu}</span><small>{service.durationMinutes} {t('minutes')} <i>·</i> ₹{service.priceInr.toLocaleString('en-IN')}</small></div>
          <span className={`service-state ${service.enabled ? 'service-state-active' : ''}`}>{service.enabled ? t('activeLabel') : t('hiddenLabel')}</span>
          <button type="button" className="service-edit-button" onClick={() => openEditService(service)}>{t('editService')}</button>
          <button type="button" role="switch" aria-checked={Boolean(service.enabled)} aria-label={`${service.nameEn} · ${t('activeLabel')}`} className={`admin-switch compact-switch ${service.enabled ? 'switch-on' : ''}`} disabled={saving} onClick={() => toggleService(service)}><span className="switch-track"><i /></span></button>
        </article>)}</div>}
      </section>
    </>}

    {modalOpen && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}>
      <form className="admin-service-modal" onSubmit={saveService} noValidate aria-labelledby="service-modal-title">
        <div className="admin-modal-heading"><div><p className="admin-eyebrow">{t('servicesManager')}</p><h2 id="service-modal-title">{editing ? t('editService') : t('addService')}</h2></div><button type="button" className="admin-modal-close" aria-label={t('close')} onClick={() => setModalOpen(false)}>×</button></div>
        <label className="admin-field"><span>{t('englishName')}</span><input autoFocus value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} maxLength={80} /></label>
        <label className="admin-field"><span>{t('gujaratiName')}</span><input value={form.nameGu} onChange={(event) => setForm({ ...form, nameGu: event.target.value })} maxLength={80} /></label>
        <div className="admin-form-grid"><label className="admin-field"><span>{t('durationMinutes')}</span><input type="number" min="1" max="600" step="1" inputMode="numeric" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label>
          <label className="admin-field"><span>{t('priceRupees')}</span><input type="number" min="0" step="1" inputMode="numeric" value={form.priceInr} onChange={(event) => setForm({ ...form, priceInr: event.target.value })} /></label></div>
        {formError && <p className="admin-form-error" role="alert">{t('invalidService')}</p>}
        <div className="admin-modal-actions"><button type="button" className="admin-secondary-button" onClick={() => setModalOpen(false)}>{t('cancelAction')}</button><button type="submit" className="admin-primary-button" disabled={saving}>{t('saveChanges')}</button></div>
      </form>
    </div>}
  </main>
}
