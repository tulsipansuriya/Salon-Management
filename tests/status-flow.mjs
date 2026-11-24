import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let now = '2026-11-24T06:00:00.000Z'
const NativeDate = Date
class TestDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])) }
  static now() { return new NativeDate(now).getTime() }
}
globalThis.Date = TestDate

const testDirectory = mkdtempSync(join(tmpdir(), 'salon-status-test-'))
process.env.DATABASE_PATH = join(testDirectory, 'queue.sqlite')
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')])
const queueEvents = []
app.set('io', { emit: (...event) => queueEvents.push(event) })
const server = app.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const getBooking = async (id) => {
  const response = await fetch(`${base}/api/bookings/${id}`)
  return { status: response.status, body: await response.json() }
}

try {
  assert.equal((await post('/api/bookings', { name: '  ', phone: '1234567890', serviceIds: ['haircut'] })).body.error, 'NAME_REQUIRED')
  assert.equal((await post('/api/bookings', { name: 'A', phone: '123456789', serviceIds: ['haircut'] })).body.error, 'INVALID_PHONE')
  assert.equal((await post('/api/bookings', { name: 'A', phone: '1234567890', serviceIds: [] })).body.error, 'INVALID_SERVICE_COUNT')
  assert.equal((await post('/api/bookings', { name: 'A', phone: '1234567890', serviceIds: ['haircut', 'beard-trim', 'hair-spa', 'hair-color'] })).body.error, 'INVALID_SERVICE_COUNT')
  assert.equal((await post('/api/bookings', { name: 'A', phone: '1234567890', serviceIds: ['haircut'], preferredBarber: 'Unknown' })).body.error, 'INVALID_BARBER')

  const payload = { name: 'Kunal Shah', phone: '9876543210', serviceIds: ['haircut', 'beard-trim'], preferredBarber: 'Any' }
  const concurrent = await Promise.all([post('/api/bookings', payload), post('/api/bookings', payload)])
  const created = concurrent.find((result) => result.status === 201)
  const duplicate = concurrent.find((result) => result.status === 409)
  assert.ok(created && duplicate)
  assert.equal(created.body.token, 'S-1')
  assert.equal(created.body.durationMinutes, 45)
  assert.equal(created.body.priceInr, 230)
  assert.equal(duplicate.body.existingId, created.body.id)

  const second = await post('/api/bookings', { name: 'Meera Patel', phone: '9876543211', serviceIds: ['haircut'], preferredBarber: 'Any' })
  assert.equal(second.body.token, 'S-2')
  const firstView = await getBooking(second.body.id)
  const refreshedView = await getBooking(second.body.id)
  assert.equal(firstView.status, 200)
  assert.deepEqual(refreshedView.body, firstView.body)
  assert.equal(refreshedView.body.status, 'Waiting')
  assert.equal(refreshedView.body.queuePosition, 2)

  for (const [index, barber] of ['Ravi', 'Amit', 'Imran'].entries()) {
    db.prepare(`INSERT INTO queue_entries (id, token, token_day, token_number, customer_name, phone, service_ids, duration_minutes, price_inr, preferred_barber, assigned_barber, status)
      VALUES (?, ?, '2026-11-24', ?, ?, ?, '[]', 0, 0, ?, ?, 'Called')`)
      .run(`called-${index}`, `C-${index + 1}`, index + 1, `Active ${barber}`, `900000000${index}`, barber, barber)
  }
  assert.equal((await getBooking(second.body.id)).body.estimatedWaitMinutes, 15)
  assert.equal(queueEvents.filter((event) => event[0] === 'queue:update').length, 2)

  const cancelled = await post(`/api/bookings/${second.body.id}/cancel`)
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.body.status, 'Cancelled')
  assert.equal(cancelled.body.queuePosition, null)
  assert.equal((await getBooking(created.body.id)).body.queuePosition, 1)
  assert.equal((await post('/api/bookings/called-0/cancel')).status, 400)
  assert.equal((await getBooking('missing-id')).status, 404)

  now = '2026-11-25T06:00:00.000Z'
  const nextDay = await post('/api/bookings', { name: 'Riya Shah', phone: '9876543212', serviceIds: ['beard-trim'] })
  assert.equal(nextDay.body.token, 'S-1')
  assert.equal((await getBooking(nextDay.body.id)).body.status, 'Waiting')

  db.prepare("UPDATE queue_entries SET status = 'Called', assigned_barber = 'Ravi' WHERE id = ?").run(created.body.id)
  const calledStatus = await getBooking(created.body.id)
  assert.equal(calledStatus.body.status, 'Called')
  assert.equal(calledStatus.body.barberName, 'Ravi')

  console.log('PASS: invalid phone, service count, and barber input are rejected')
  console.log('PASS: duplicate concurrent requests return the existing active spot')
  console.log('PASS: repeated status fetch returns the persisted Waiting booking and queue position')
  console.log('PASS: backend wait estimate uses FCFS waiting minutes and active barber capacity')
  console.log('PASS: cancellation is allowed only while Waiting and updates queue state')
  console.log('PASS: Called status returns the barber name for the takeover screen')
  console.log('PASS: daily token counter resets to S-1 on the next salon-local date')
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
}
