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
        WHEN EXISTS (SELECT 1 FROM queue_entries q WHERE (q.assigned_barber = b.name OR q.preferred_barber = b.name) AND q.status IN ('Called', 'In Chair')) THEN 'Busy'
        ELSE 'Free' END AS status
      FROM barbers b WHERE b.on_duty = 1 ORDER BY CASE b.name WHEN 'Ravi' THEN 0 WHEN 'Amit' THEN 1 WHEN 'Imran' THEN 2 ELSE 3 END`).all(),
    onlineQueueOpen: isOnlineQueueOpen(),
  }
}

const getBookingStatus = (id: string) => {
  const entry = db.prepare(`SELECT id, token, customer_name AS customerName, service_ids AS serviceIds,
    preferred_barber AS preferredBarber, assigned_barber AS assignedBarber, status, duration_minutes AS durationMinutes
    FROM queue_entries WHERE id = ?`).get(id) as {
      id: string; token: string; customerName: string; serviceIds: string; preferredBarber: string | null;
      assignedBarber: string | null; status: string; durationMinutes: number;
    } | undefined
  if (!entry) return null

  const servicesIds = JSON.parse(entry.serviceIds) as string[]
  const serviceRows = servicesIds.length
    ? db.prepare(`SELECT id, name_en AS nameEn, name_gu AS nameGu FROM services WHERE id IN (${servicesIds.map(() => '?').join(',')})`).all(...servicesIds) as { id: string; nameEn: string; nameGu: string }[]
    : []
  const serviceMap = new Map(serviceRows.map((service) => [service.id, service]))
  const services = servicesIds.map((serviceId) => serviceMap.get(serviceId)).filter((service) => service !== undefined)

  let queuePosition: number | null = null
  let estimatedWaitMinutes = 0
  if (entry.status === 'Waiting') {
    const waiting = db.prepare(`SELECT id, duration_minutes AS durationMinutes FROM queue_entries WHERE status = 'Waiting' ORDER BY token_day, token_number`).all() as { id: string; durationMinutes: number }[]
    const positionIndex = waiting.findIndex((customer) => customer.id === id)
    if (positionIndex >= 0) {
      queuePosition = positionIndex + 1
      const minutesAhead = waiting.slice(0, positionIndex).reduce((sum, customer) => sum + customer.durationMinutes, 0)
      const capacity = queueSnapshot().availableBarberCount
      const freeBarbers = queueSnapshot().barbers as { name: string; status: string }[]
      const matchingBarberIsFree = entry.preferredBarber
        ? freeBarbers.some((barber) => barber.name === entry.preferredBarber && barber.status === 'Free')
        : freeBarbers.some((barber) => barber.status === 'Free')
      estimatedWaitMinutes = matchingBarberIsFree || capacity === 0 ? 0 : Math.ceil(minutesAhead / capacity)
    }
  }
  return {
    id: entry.id,
    token: entry.token,
    customerName: entry.customerName,
    services,
    preferredBarber: entry.preferredBarber,
    barberName: entry.assignedBarber ?? entry.preferredBarber,
    status: entry.status,
    queuePosition,
    estimatedWaitMinutes,
    durationMinutes: entry.durationMinutes,
  }
}

app.get('/api/bootstrap', (_request, response) => {
  response.json({
    services: db.prepare('SELECT id, name_en AS nameEn, name_gu AS nameGu, duration_minutes AS durationMinutes, price_inr AS priceInr FROM services WHERE enabled = 1 ORDER BY rowid').all(),
    ...queueSnapshot(),
  })
})

type QueueInput = { name?: unknown; phone?: unknown; serviceIds?: unknown; preferredBarber?: unknown }
type QueueCreateResult = { status: number; body: Record<string, unknown>; created?: boolean }

const createQueueEntry = (body: QueueInput, allowClosed: boolean): QueueCreateResult => {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  const serviceIds = body.serviceIds
  const preferredBarber = body.preferredBarber == null || body.preferredBarber === 'Any' ? null : body.preferredBarber
  if (!name) return { status: 400, body: { error: 'NAME_REQUIRED' } }
  if (!/^\d{10}$/.test(phone)) return { status: 400, body: { error: 'INVALID_PHONE' } }
  if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 3 || serviceIds.some((id) => typeof id !== 'string') || new Set(serviceIds).size !== serviceIds.length) {
    return { status: 400, body: { error: 'INVALID_SERVICE_COUNT' } }
  }
  if (preferredBarber !== null && (typeof preferredBarber !== 'string' || !db.prepare('SELECT 1 FROM barbers WHERE name = ? AND on_duty = 1').get(preferredBarber))) {
    return { status: 400, body: { error: 'INVALID_BARBER' } }
  }
  const selectedServiceIds = serviceIds as string[]
  return db.transaction((): QueueCreateResult => {
    const duplicate = db.prepare(`SELECT id, token FROM queue_entries WHERE phone = ? AND status IN (?, ?, ?) ORDER BY token_day DESC, token_number DESC LIMIT 1`)
      .get(phone, ...ACTIVE_STATUSES) as { id: string; token: string } | undefined
    if (duplicate) return { status: 409, body: { error: 'DUPLICATE_ACTIVE_PHONE', existingId: duplicate.id, token: duplicate.token } }
    if (!allowClosed && !isOnlineQueueOpen()) return { status: 403, body: { error: 'QUEUE_CLOSED' } }

    const placeholders = selectedServiceIds.map(() => '?').join(',')
    const services = db.prepare(`SELECT id, duration_minutes, price_inr FROM services WHERE enabled = 1 AND id IN (${placeholders})`).all(...selectedServiceIds) as { id: string; duration_minutes: number; price_inr: number }[]
    if (services.length !== selectedServiceIds.length) return { status: 400, body: { error: 'INVALID_SERVICES' } }
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, token, today, tokenNumber, name, phone, JSON.stringify(selectedServiceIds), durationMinutes, priceInr, preferredBarber)
    return { status: 201, created: true, body: { id, token, durationMinutes, priceInr, estimatedWaitMinutes: waitMinutes } }
  })()
}

const notifyQueueUpdate = (request: express.Request) => request.app.get('io')?.emit('queue:update', queueSnapshot())

app.post('/api/bookings', (request, response) => {
  const result = createQueueEntry(request.body as QueueInput, false)
  if (result.created) notifyQueueUpdate(request)
  return response.status(result.status).json(result.body)
})

app.post('/api/reception/walk-ins', (request, response) => {
  const result = createQueueEntry(request.body as QueueInput, true)
  if (result.created) notifyQueueUpdate(request)
  return response.status(result.status).json(result.body)
})

const elapsedSeconds = (timestamp: string | null | undefined) => {
  if (!timestamp) return 0
  const normalizedTimestamp = timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`
  return Math.max(0, Math.floor((Date.now() - Date.parse(normalizedTimestamp)) / 1000))
}

app.get('/api/reception', (_request, response) => {
  const barbers = db.prepare('SELECT id, name, on_break AS onBreak FROM barbers WHERE on_duty = 1 ORDER BY CASE name WHEN \'Ravi\' THEN 0 WHEN \'Amit\' THEN 1 WHEN \'Imran\' THEN 2 ELSE 3 END').all() as { id: string; name: string; onBreak: number }[]
  const activeRows = db.prepare(`SELECT id, token, customer_name AS customerName, status, preferred_barber AS preferredBarber,
    COALESCE(assigned_barber, preferred_barber) AS assignedBarber, called_at AS calledAt, service_started_at AS serviceStartedAt
    FROM queue_entries WHERE status IN ('Called', 'In Chair') ORDER BY token_day, token_number`).all() as {
      id: string; token: string; customerName: string; status: string; preferredBarber: string | null;
      assignedBarber: string | null; calledAt: string | null; serviceStartedAt: string | null;
    }[]
  const queueRows = db.prepare(`SELECT id, token, customer_name AS customerName, phone, service_ids AS serviceIds,
    preferred_barber AS preferredBarber, assigned_barber AS assignedBarber, status, created_at AS createdAt,
    called_at AS calledAt FROM queue_entries WHERE status IN ('Waiting', 'Called') ORDER BY token_day, token_number`).all() as {
      id: string; token: string; customerName: string; phone: string; serviceIds: string; preferredBarber: string | null;
      assignedBarber: string | null; status: string; createdAt: string; calledAt: string | null;
    }[]
  const servicesFor = (idsJson: string) => {
    const ids = JSON.parse(idsJson) as string[]
    if (!ids.length) return []
    const rows = db.prepare(`SELECT id, name_en AS nameEn, name_gu AS nameGu FROM services WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; nameEn: string; nameGu: string }[]
    const byId = new Map(rows.map((service) => [service.id, service]))
    return ids.map((id) => byId.get(id)).filter((service) => service !== undefined)
  }
  const activeByBarber = new Map(activeRows.map((entry) => [entry.assignedBarber, entry]))
  response.json({
    barbers: barbers.map((barber) => {
      const active = activeByBarber.get(barber.name)
      const startedAt = active?.status === 'In Chair' ? active.serviceStartedAt : null
      return {
        id: barber.id, name: barber.name,
        status: barber.onBreak ? 'On Break' : active ? 'Busy' : 'Free',
        currentCustomer: active ? { id: active.id, token: active.token, name: active.customerName, status: active.status, elapsedSeconds: elapsedSeconds(startedAt) } : null,
      }
    }),
    waitingQueue: queueRows.map((entry) => ({
      id: entry.id, token: entry.token, customerName: entry.customerName, phone: entry.phone,
      services: servicesFor(entry.serviceIds), preferredBarber: entry.preferredBarber,
      assignedBarber: entry.assignedBarber, status: entry.status,
      waitingSeconds: elapsedSeconds(entry.createdAt),
    })),
  })
})

const callNextTransaction = db.transaction((barberName: string): { status: number; body: Record<string, unknown> } => {
  const barber = db.prepare('SELECT id, on_duty AS onDuty, on_break AS onBreak FROM barbers WHERE name = ?').get(barberName) as { id: string; onDuty: number; onBreak: number } | undefined
  if (!barber || !barber.onDuty) return { status: 404, body: { error: 'BARBER_NOT_AVAILABLE' } }
  if (barber.onBreak) return { status: 409, body: { error: 'BARBER_ON_BREAK' } }
  const active = db.prepare("SELECT 1 FROM queue_entries WHERE (assigned_barber = ? OR (assigned_barber IS NULL AND preferred_barber = ?)) AND status IN ('Called', 'In Chair')").get(barberName, barberName)
  if (active) return { status: 409, body: { error: 'BARBER_HAS_ACTIVE_CUSTOMER' } }
  const next = db.prepare(`SELECT id FROM queue_entries WHERE status = 'Waiting'
    AND (preferred_barber IS NULL OR preferred_barber = ?) ORDER BY token_day, token_number LIMIT 1`).get(barberName) as { id: string } | undefined
  if (!next) return { status: 404, body: { error: 'NO_ELIGIBLE_CUSTOMER' } }
  db.prepare("UPDATE queue_entries SET status = 'Called', assigned_barber = ?, called_at = ? WHERE id = ? AND status = 'Waiting'")
    .run(barberName, new Date().toISOString(), next.id)
  return { status: 200, body: getBookingStatus(next.id)! }
})

app.post('/api/barbers/:name/call-next', (request, response) => {
  const barberName = String(request.params.name).replace(/^./, (letter) => letter.toUpperCase())
  const result = callNextTransaction(barberName)
  if (result.status === 200) {
    notifyQueueUpdate(request)
    const called = result.body as { id: string; token: string; barberName: string | null }
    request.app.get('io')?.emit('queue:called', { id: called.id, token: called.token, barberName: called.barberName, durationMs: 5_000 })
  }
  return response.status(result.status).json(result.body)
})

const findBarber = (name: string) => db.prepare('SELECT id, name, on_break AS onBreak, on_duty AS onDuty FROM barbers WHERE lower(name) = lower(?)').get(name) as {
  id: string; name: string; onBreak: number; onDuty: number;
} | undefined
const servicesForIds = (idsJson: string) => {
  const ids = JSON.parse(idsJson) as string[]
  if (!ids.length) return []
  const rows = db.prepare(`SELECT id, name_en AS nameEn, name_gu AS nameGu FROM services WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string; nameEn: string; nameGu: string }[]
  const byId = new Map(rows.map((service) => [service.id, service]))
  return ids.map((id) => byId.get(id)).filter((service) => service !== undefined)
}

app.get('/api/barbers/:name/view', (request, response) => {
  const barber = findBarber(request.params.name)
  if (!barber || !barber.onDuty) return response.status(404).json({ error: 'BARBER_NOT_AVAILABLE' })
  const current = db.prepare(`SELECT id, token, customer_name AS customerName, service_ids AS serviceIds,
    preferred_barber AS preferredBarber, assigned_barber AS assignedBarber, status,
    service_started_at AS serviceStartedAt FROM queue_entries
    WHERE status IN ('Called', 'In Chair') AND COALESCE(assigned_barber, preferred_barber) = ?
    ORDER BY token_day, token_number LIMIT 1`).get(barber.name) as {
      id: string; token: string; customerName: string; serviceIds: string; preferredBarber: string | null;
      assignedBarber: string | null; status: 'Called' | 'In Chair'; serviceStartedAt: string | null;
    } | undefined
  const next = db.prepare(`SELECT id, token, customer_name AS customerName, service_ids AS serviceIds
    FROM queue_entries WHERE status = 'Waiting' AND (preferred_barber IS NULL OR preferred_barber = ?)
    ORDER BY token_day, token_number LIMIT 1`).get(barber.name) as {
      id: string; token: string; customerName: string; serviceIds: string;
    } | undefined
  return response.json({
    barber: { id: barber.id, name: barber.name, onBreak: Boolean(barber.onBreak), status: barber.onBreak ? 'On Break' : current ? 'Busy' : 'Free' },
    currentCustomer: current ? {
      id: current.id, token: current.token, customerName: current.customerName, status: current.status,
      services: servicesForIds(current.serviceIds), elapsedSeconds: current.status === 'In Chair' ? elapsedSeconds(current.serviceStartedAt) : 0,
    } : null,
    nextCustomer: next ? { id: next.id, token: next.token, customerName: next.customerName, services: servicesForIds(next.serviceIds) } : null,
  })
})

app.post('/api/barbers/:name/break', (request, response) => {
  const barber = findBarber(request.params.name)
  if (!barber || !barber.onDuty) return response.status(404).json({ error: 'BARBER_NOT_AVAILABLE' })
  const onBreak = (request.body as { onBreak?: unknown }).onBreak
  if (typeof onBreak !== 'boolean') return response.status(400).json({ error: 'INVALID_BREAK_STATUS' })
  db.prepare('UPDATE barbers SET on_break = ? WHERE id = ?').run(Number(onBreak), barber.id)
  notifyQueueUpdate(request)
  return response.json({ id: barber.id, name: barber.name, onBreak, status: onBreak ? 'On Break' : 'Available' })
})

app.get('/api/display', (_request, response) => {
  const snapshot = queueSnapshot()
  const activeRows = db.prepare(`SELECT id, token, customer_name AS customerName, status, COALESCE(assigned_barber, preferred_barber) AS assignedBarber,
    called_at AS calledAt, service_started_at AS serviceStartedAt FROM queue_entries
    WHERE status IN ('Called', 'In Chair') ORDER BY token_day, token_number`).all() as {
      id: string; token: string; customerName: string; status: 'Called' | 'In Chair'; assignedBarber: string | null;
      calledAt: string | null; serviceStartedAt: string | null;
    }[]
  const activeByBarber = new Map(activeRows.map((entry) => [entry.assignedBarber, entry]))
  const barbers = db.prepare('SELECT id, name, on_break AS onBreak FROM barbers WHERE on_duty = 1 ORDER BY CASE name WHEN \'Ravi\' THEN 0 WHEN \'Amit\' THEN 1 WHEN \'Imran\' THEN 2 ELSE 3 END').all() as { id: string; name: string; onBreak: number }[]
  const waiting = db.prepare(`SELECT id, token, customer_name AS customerName, service_ids AS serviceIds, preferred_barber AS preferredBarber,
    duration_minutes AS durationMinutes FROM queue_entries WHERE status = 'Waiting' ORDER BY token_day, token_number`).all() as {
      id: string; token: string; customerName: string; serviceIds: string; preferredBarber: string | null; durationMinutes: number;
    }[]
  let minutesAhead = 0
  const upNext = waiting.slice(0, 5).map((entry) => {
    const matchingBarberIsFree = entry.preferredBarber
      ? snapshot.barbers.some((barber) => (barber as { name: string; status: string }).name === entry.preferredBarber && (barber as { status: string }).status === 'Free')
      : snapshot.barbers.some((barber) => (barber as { status: string }).status === 'Free')
    const estimatedWaitMinutes = matchingBarberIsFree ? 0 : snapshot.availableBarberCount === 0
      ? minutesAhead : Math.ceil(minutesAhead / snapshot.availableBarberCount)
    const row = { id: entry.id, token: entry.token, customerName: entry.customerName, services: servicesForIds(entry.serviceIds), estimatedWaitMinutes }
    minutesAhead += entry.durationMinutes
    return row
  })
  response.json({
    barbers: barbers.map((barber) => {
      const current = activeByBarber.get(barber.name)
      return {
        id: barber.id, name: barber.name, status: barber.onBreak ? 'On Break' : current ? 'Busy' : 'Free',
        currentCustomer: current ? {
          id: current.id, token: current.token, customerName: current.customerName, status: current.status,
          calledAt: current.calledAt, flashUntil: current.status === 'Called' && current.calledAt
            ? new Date(new Date(current.calledAt).getTime() + 5_000).toISOString() : null,
        } : null,
      }
    }),
    upNext,
    waitingCount: waiting.length,
  })
})

const allowedTransitions: Record<string, string[]> = {
  Waiting: ['Cancelled'], Called: ['In Chair', 'No-show'], 'In Chair': ['Done'],
}
const transitionColumn: Record<string, string> = {
  'In Chair': 'service_started_at', Done: 'finished_at', 'No-show': 'no_show_at', Cancelled: 'cancelled_at',
}

app.post('/api/queue/:id/transition', (request, response) => {
  const nextStatus = (request.body as { status?: unknown }).status
  if (typeof nextStatus !== 'string' || !transitionColumn[nextStatus]) return response.status(400).json({ error: 'INVALID_TRANSITION' })
  const result = db.transaction(() => {
    const current = db.prepare('SELECT status FROM queue_entries WHERE id = ?').get(request.params.id) as { status: string } | undefined
    if (!current) return { status: 404, body: { error: 'BOOKING_NOT_FOUND' } }
    if (!allowedTransitions[current.status]?.includes(nextStatus)) return { status: 400, body: { error: 'INVALID_TRANSITION', from: current.status, to: nextStatus } }
    const column = transitionColumn[nextStatus]
    db.prepare(`UPDATE queue_entries SET status = ?, ${column} = ? WHERE id = ? AND status = ?`)
      .run(nextStatus, new Date().toISOString(), request.params.id, current.status)
    return { status: 200, body: getBookingStatus(request.params.id)! }
  })()
  if (result.status === 200) notifyQueueUpdate(request)
  return response.status(result.status).json(result.body)
})

app.post('/api/barbers/:name/queue/:id/transition', (request, response) => {
  const barber = findBarber(request.params.name)
  if (!barber || !barber.onDuty) return response.status(404).json({ error: 'BARBER_NOT_AVAILABLE' })
  const nextStatus = (request.body as { status?: unknown }).status
  if (nextStatus !== 'In Chair' && nextStatus !== 'Done') return response.status(400).json({ error: 'INVALID_TRANSITION' })
  const result = db.transaction(() => {
    const current = db.prepare(`SELECT status, COALESCE(assigned_barber, preferred_barber) AS assignedBarber
      FROM queue_entries WHERE id = ?`).get(request.params.id) as { status: string; assignedBarber: string | null } | undefined
    if (!current) return { status: 404, body: { error: 'BOOKING_NOT_FOUND' } }
    if (current.assignedBarber !== barber.name) return { status: 409, body: { error: 'CUSTOMER_NOT_ASSIGNED_TO_BARBER' } }
    if (!allowedTransitions[current.status]?.includes(nextStatus)) return { status: 400, body: { error: 'INVALID_TRANSITION', from: current.status, to: nextStatus } }
    const column = transitionColumn[nextStatus]
    db.prepare(`UPDATE queue_entries SET status = ?, ${column} = ? WHERE id = ? AND status = ?`)
      .run(nextStatus, new Date().toISOString(), request.params.id, current.status)
    return { status: 200, body: getBookingStatus(request.params.id)! }
  })()
  if (result.status === 200) notifyQueueUpdate(request)
  return response.status(result.status).json(result.body)
})

app.get('/api/bookings/:id', (request, response) => {
  const booking = getBookingStatus(request.params.id)
  if (!booking) return response.status(404).json({ error: 'BOOKING_NOT_FOUND' })
  return response.json(booking)
})

app.post('/api/bookings/:id/cancel', (request, response) => {
  const booking = db.prepare('SELECT status FROM queue_entries WHERE id = ?').get(request.params.id) as { status: string } | undefined
  if (!booking) return response.status(404).json({ error: 'BOOKING_NOT_FOUND' })
  if (booking.status !== 'Waiting') return response.status(400).json({ error: 'CANCELLATION_NOT_ALLOWED' })
  db.prepare("UPDATE queue_entries SET status = 'Cancelled', cancelled_at = ? WHERE id = ? AND status = 'Waiting'").run(new Date().toISOString(), request.params.id)
  const updatedBooking = getBookingStatus(request.params.id)
  request.app.get('io')?.emit('queue:update', queueSnapshot())
  return response.json(updatedBooking)
})

app.get('/api/health', (_request, response) => {
  const database = db.prepare('SELECT 1 AS ok').get() as { ok: number }
  response.json({ status: 'ok', service: 'salon-queue-api', database: database.ok === 1 ? 'connected' : 'unavailable' })
})
