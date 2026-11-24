import express from 'express'
import cors from 'cors'
import { db } from './db'
import { randomUUID } from 'node:crypto'

export const app = express()
app.use(cors())
app.use(express.json())

const ACTIVE_STATUSES = ['Waiting', 'Called', 'In Chair']
const isOnlineQueueOpen = () => {
  const manual = db.prepare("SELECT value FROM app_meta WHERE key = 'online_queue_open'").get() as { value: string } | undefined
  const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  return manual?.value === '1' && currentTime < '20:30'
}
const queueSnapshot = () => {
  const waiting = db.prepare("SELECT duration_minutes FROM queue_entries WHERE status = 'Waiting'").all() as { duration_minutes: number }[]
  const capacity = db.prepare('SELECT COUNT(*) AS count FROM barbers WHERE on_duty = 1 AND on_break = 0').get() as { count: number }
  const waitingMinutes = waiting.reduce((total, row) => total + row.duration_minutes, 0)
  return {
    waitingCount: waiting.length,
    waitingTotalMinutes: waitingMinutes,
    availableBarberCount: capacity.count,
    estimatedWaitMinutes: waiting.length === 0 || capacity.count === 0 ? 0 : Math.ceil(waitingMinutes / capacity.count),
    barbers: db.prepare(`SELECT b.id, b.name,
      CASE WHEN b.on_break = 1 THEN 'On Break'
        WHEN EXISTS (SELECT 1 FROM queue_entries q WHERE q.preferred_barber = b.name AND q.status IN ('Called', 'In Chair')) THEN 'Busy'
        ELSE 'Free' END AS status
      FROM barbers b WHERE b.on_duty = 1 ORDER BY b.name`).all(),
    onlineQueueOpen: isOnlineQueueOpen(),
  }
}

app.get('/api/bootstrap', (_request, response) => {
  response.json({
    services: db.prepare('SELECT id, name_en AS nameEn, name_gu AS nameGu, duration_minutes AS durationMinutes, price_inr AS priceInr FROM services WHERE enabled = 1 ORDER BY rowid').all(),
    ...queueSnapshot(),
  })
})

app.post('/api/bookings', (request, response) => {
  const body = request.body as { name?: unknown; phone?: unknown; serviceIds?: unknown; preferredBarber?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const serviceIds = body.serviceIds
  const preferredBarber = body.preferredBarber === 'Any' ? null : body.preferredBarber
  if (!name) return response.status(400).json({ error: 'NAME_REQUIRED' })
  if (!/^\d{10}$/.test(phone)) return response.status(400).json({ error: 'INVALID_PHONE' })
  if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 3 || serviceIds.some((id) => typeof id !== 'string') || new Set(serviceIds).size !== serviceIds.length) {
    return response.status(400).json({ error: 'INVALID_SERVICE_COUNT' })
  }
  if (preferredBarber !== null && (typeof preferredBarber !== 'string' || !db.prepare('SELECT 1 FROM barbers WHERE name = ? AND on_duty = 1').get(preferredBarber))) {
    return response.status(400).json({ error: 'INVALID_BARBER' })
  }
  if (!isOnlineQueueOpen()) return response.status(403).json({ error: 'QUEUE_CLOSED' })

  const duplicate = db.prepare(`SELECT id, token FROM queue_entries WHERE phone = ? AND status IN (?, ?, ?) ORDER BY token_day DESC, token_number DESC LIMIT 1`)
    .get(phone, ...ACTIVE_STATUSES) as { id: string; token: string } | undefined
  if (duplicate) return response.status(409).json({ error: 'DUPLICATE_ACTIVE_PHONE', existingId: duplicate.id, token: duplicate.token })

  const placeholders = serviceIds.map(() => '?').join(',')
  const services = db.prepare(`SELECT id, duration_minutes, price_inr FROM services WHERE enabled = 1 AND id IN (${placeholders})`).all(...serviceIds) as { id: string; duration_minutes: number; price_inr: number }[]
  if (services.length !== serviceIds.length) return response.status(400).json({ error: 'INVALID_SERVICES' })
  const durationMinutes = services.reduce((sum, service) => sum + service.duration_minutes, 0)
  const priceInr = services.reduce((sum, service) => sum + service.price_inr, 0)
  const snapshot = queueSnapshot()
  const selectedBarber = preferredBarber ? snapshot.barbers.find((barber) => (barber as { name: string }).name === preferredBarber) as { status: string } | undefined : undefined
  const waitMinutes = preferredBarber
    ? (selectedBarber?.status === 'Free' ? 0 : snapshot.waitingTotalMinutes)
    : snapshot.estimatedWaitMinutes
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const lastToken = db.prepare('SELECT MAX(token_number) AS number FROM queue_entries WHERE token_day = ?').get(today) as { number: number | null }
  const tokenNumber = (lastToken.number ?? 0) + 1
  const id = randomUUID()
  const token = `S-${tokenNumber}`
  db.prepare(`INSERT INTO queue_entries (id, token, token_day, token_number, customer_name, phone, service_ids, duration_minutes, price_inr, preferred_barber)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, token, today, tokenNumber, name, phone, JSON.stringify(serviceIds), durationMinutes, priceInr, preferredBarber)
  request.app.get('io')?.emit('queue:update', queueSnapshot())
  return response.status(201).json({ id, token, durationMinutes, priceInr, estimatedWaitMinutes: waitMinutes })
})

app.get('/api/health', (_request, response) => {
  const database = db.prepare('SELECT 1 AS ok').get() as { ok: number }
  response.json({ status: 'ok', service: 'salon-queue-api', database: database.ok === 1 ? 'connected' : 'unavailable' })
})
