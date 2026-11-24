import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server } from 'socket.io'
import { io as connect } from 'socket.io-client'

let now = '2026-11-24T06:00:00.000Z'
const NativeDate = Date
class TestDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])) }
  static now() { return new NativeDate(now).getTime() }
}
globalThis.Date = TestDate

const testDirectory = mkdtempSync(join(tmpdir(), 'salon-admin-'))
process.env.DATABASE_PATH = join(testDirectory, 'queue.sqlite')
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')])
const httpServer = createServer(app)
const socketServer = new Server(httpServer, { cors: { origin: '*' } })
app.set('io', socketServer)
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}
const waitForConnect = (socket) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 2_000)
  socket.once('connect', () => { clearTimeout(timeout); resolve() })
  socket.once('connect_error', reject)
})
const waitFor = async (predicate) => {
  const deadline = NativeDate.now() + 2_000
  while (!predicate()) {
    if (NativeDate.now() > deadline) throw new Error('Timed out waiting for socket event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const clientOne = connect(base, { transports: ['websocket'], reconnection: false })
const clientTwo = connect(base, { transports: ['websocket'], reconnection: false })
const clientOneUpdates = []
const clientTwoUpdates = []
clientOne.on('queue:update', (event) => clientOneUpdates.push(event))
clientTwo.on('queue:update', (event) => clientTwoUpdates.push(event))

try {
  await Promise.all([waitForConnect(clientOne), waitForConnect(clientTwo)])
  const initial = await request('/api/admin')
  assert.equal(initial.body.services.length, 6)
  assert.equal(initial.body.barbers.length, 3)
  assert.equal(initial.body.manualQueueOpen, true)
  assert.deepEqual(initial.body.stats, { customersServed: 0, averageWaitMinutes: 0, noShows: 0 })

  const added = await request('/api/admin/services', 'POST', { nameEn: 'Scalp Treatment', nameGu: 'સ્કાલ્પ ટ્રીટમેન્ટ', durationMinutes: 25, priceInr: 280 })
  assert.equal(added.status, 201)
  assert.equal((await request('/api/admin/services', 'POST', { nameEn: '', nameGu: '', durationMinutes: -1, priceInr: -5 })).status, 400)
  assert.equal((await request(`/api/admin/services/${added.body.id}`, 'PATCH', { durationMinutes: 35, priceInr: 320 })).status, 200)
  assert.equal((await request(`/api/admin/services/${added.body.id}`, 'PATCH', { enabled: false })).status, 200)
  let bootstrap = (await request('/api/bootstrap')).body
  assert.ok(!bootstrap.services.some((service) => service.id === added.body.id))
  assert.equal((await request(`/api/admin/services/${added.body.id}`, 'PATCH', { enabled: true })).status, 200)
  assert.ok((await request('/api/bootstrap')).body.services.some((service) => service.id === added.body.id))

  assert.equal((await request('/api/admin/barbers/amit/duty', 'PATCH', { onDuty: false })).status, 200)
  bootstrap = (await request('/api/bootstrap')).body
  assert.equal(bootstrap.availableBarberCount, 2)
  assert.equal((await request('/api/bookings', 'POST', { name: 'Specific Barber', phone: '8200000001', serviceIds: ['haircut'], preferredBarber: 'Amit' })).body.error, 'INVALID_BARBER')
  assert.equal((await request('/api/admin/barbers/amit/duty', 'PATCH', { onDuty: true })).status, 200)

  const raviBooking = await request('/api/reception/walk-ins', 'POST', { name: 'Ravi Client', phone: '8200000002', serviceIds: ['haircut'], preferredBarber: 'Ravi' })
  assert.equal(raviBooking.status, 201)
  assert.equal((await request('/api/barbers/ravi/call-next', 'POST', {})).status, 200)
  const unavailable = await request('/api/admin/barbers/ravi/duty', 'PATCH', { onDuty: false })
  assert.equal(unavailable.status, 409)
  assert.equal(unavailable.body.error, 'BARBER_HAS_ACTIVE_CUSTOMER')
  assert.equal((await request(`/api/queue/${raviBooking.body.id}/transition`, 'POST', { status: 'No-show' })).status, 200)
  assert.equal((await request('/api/admin')).body.stats.noShows, 1)

  const servedBooking = await request('/api/reception/walk-ins', 'POST', { name: 'Served Client', phone: '8200000003', serviceIds: ['beard-trim'] })
  assert.equal((await request('/api/barbers/amit/call-next', 'POST', {})).status, 200)
  assert.equal((await request(`/api/barbers/amit/queue/${servedBooking.body.id}/transition`, 'POST', { status: 'In Chair' })).status, 200)
  assert.equal((await request(`/api/barbers/amit/queue/${servedBooking.body.id}/transition`, 'POST', { status: 'Done' })).status, 200)
  const stats = (await request('/api/admin')).body.stats
  assert.equal(stats.customersServed, 1)
  assert.equal(stats.noShows, 1)

  assert.equal((await request('/api/admin/online-queue', 'PATCH', { open: false })).body.onlineQueueOpen, false)
  assert.equal((await request('/api/bookings', 'POST', { name: 'Online Closed', phone: '8200000004', serviceIds: ['haircut'], preferredBarber: 'Any' })).status, 403)
  assert.equal((await request('/api/reception/walk-ins', 'POST', { name: 'Walk In Open', phone: '8200000005', serviceIds: ['haircut'], preferredBarber: 'Any' })).status, 201)
  await waitFor(() => clientOneUpdates.length > 0 && clientTwoUpdates.length > 0)
  assert.equal((await request('/api/admin')).body.manualQueueOpen, false)
  assert.equal((await request('/api/admin/online-queue', 'PATCH', { open: true })).body.onlineQueueOpen, true)

  now = '2026-11-24T15:00:00.000Z'
  const cutoff = (await request('/api/admin')).body
  assert.equal(cutoff.closingCutoffReached, true)
  assert.equal(cutoff.onlineQueueOpen, false)
  assert.equal((await request('/api/bookings', 'POST', { name: 'After Cutoff', phone: '8200000006', serviceIds: ['haircut'], preferredBarber: 'Any' })).status, 403)
  assert.equal((await request('/api/reception/walk-ins', 'POST', { name: 'Late Walk In', phone: '8200000007', serviceIds: ['haircut'], preferredBarber: 'Any' })).status, 201)

  assert.ok(clientOneUpdates.length >= 5)
  assert.equal(clientOneUpdates.at(-1).onlineQueueOpen, false)
  assert.ok(clientTwoUpdates.length >= 5)
  console.log('PASS: services add/edit/hide persist and only active services appear in customer booking data')
  console.log('PASS: barber duty settings update queue capacity and protect assigned active customers')
  console.log('PASS: daily served, average wait, and no-show summaries use today’s queue activity')
  console.log('PASS: manual close and the 8:30 PM cutoff block online bookings while walk-ins remain enabled')
  console.log('PASS: settings and queue changes broadcast across two Socket.IO clients')
} finally {
  clientOne.disconnect()
  clientTwo.disconnect()
  await new Promise((resolve) => socketServer.close(resolve))
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
}
