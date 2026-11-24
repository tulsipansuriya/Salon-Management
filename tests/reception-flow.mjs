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

const testDirectory = mkdtempSync(join(tmpdir(), 'salon-reception-test-'))
process.env.DATABASE_PATH = join(testDirectory, 'queue.sqlite')
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')])
const httpServer = createServer(app)
const socketServer = new Server(httpServer, { cors: { origin: '*' } })
app.set('io', socketServer)
socketServer.on('connection', (socket) => socket.emit('connected', { status: 'ok' }))
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`
const post = async (path, body = {}) => {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const get = async (path) => {
  const response = await fetch(`${base}${path}`)
  return { status: response.status, body: await response.json() }
}
const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = NativeDate.now() + timeoutMs
  while (!predicate()) {
    if (NativeDate.now() > deadline) throw new Error('Timed out waiting for socket update')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const waitForConnect = (socket) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 2_000)
  socket.once('connect', () => { clearTimeout(timeout); resolve() })
  socket.once('connect_error', reject)
})

const browserOne = connect(base, { transports: ['websocket'], reconnection: false })
const browserTwo = connect(base, { transports: ['websocket'], reconnection: false })
const updatesOne = []
const updatesTwo = []
browserOne.on('queue:update', (event) => updatesOne.push(event))
browserTwo.on('queue:update', (event) => updatesTwo.push(event))

try {
  await Promise.all([waitForConnect(browserOne), waitForConnect(browserTwo)])
  const addWalkIn = (name, phone, preferredBarber) => post('/api/reception/walk-ins', {
    name, phone, serviceIds: ['haircut'], preferredBarber,
  })
  const raviCustomer = await addWalkIn('Ravi Preference', '8000000001', 'Ravi')
  const anyCustomer = await addWalkIn('Any Preference', '8000000002', 'Any')
  const amitCustomer = await addWalkIn('Amit Preference', '8000000003', 'Amit')
  assert.deepEqual([raviCustomer.body.token, anyCustomer.body.token, amitCustomer.body.token], ['S-1', 'S-2', 'S-3'])

  const simultaneous = await Promise.all([
    addWalkIn('Simultaneous Imran', '8000000004', 'Imran'),
    addWalkIn('Simultaneous Any', '8000000005', 'Any'),
  ])
  assert.deepEqual(simultaneous.map((entry) => entry.body.token).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))), ['S-4', 'S-5'])
  await waitFor(() => updatesOne.length >= 5 && updatesTwo.length >= 5)

  const calledForAmit = await post('/api/barbers/Amit/call-next')
  assert.equal(calledForAmit.status, 200)
  assert.equal(calledForAmit.body.id, anyCustomer.body.id)
  assert.equal(calledForAmit.body.barberName, 'Amit')
  await waitFor(() => updatesTwo.some((event) => event.barbers.find((barber) => barber.name === 'Amit')?.status === 'Busy'))
  assert.equal((await post('/api/barbers/amit/call-next')).body.error, 'BARBER_HAS_ACTIVE_CUSTOMER')

  const reception = await get('/api/reception')
  assert.equal(reception.status, 200)
  assert.equal(reception.body.barbers.find((barber) => barber.name === 'Amit').currentCustomer.token, 'S-2')
  const longWaitRow = reception.body.waitingQueue.find((entry) => entry.id === raviCustomer.body.id)
  db.prepare('UPDATE queue_entries SET created_at = ? WHERE id = ?').run('2026-11-24 04:59:00', raviCustomer.body.id)
  const overdueReception = await get('/api/reception')
  assert.ok(overdueReception.body.waitingQueue.find((entry) => entry.id === raviCustomer.body.id).waitingSeconds > 3_600)
  assert.ok(longWaitRow)

  assert.equal((await post(`/api/queue/${anyCustomer.body.id}/transition`, { status: 'In Chair' })).status, 200)
  assert.equal((await post(`/api/queue/${anyCustomer.body.id}/transition`, { status: 'Called' })).status, 400)
  assert.equal((await post(`/api/queue/${anyCustomer.body.id}/transition`, { status: 'Done' })).status, 200)
  assert.equal((await post(`/api/queue/${anyCustomer.body.id}/transition`, { status: 'Waiting' })).status, 400)

  const calledForRavi = await post('/api/barbers/Ravi/call-next')
  assert.equal(calledForRavi.body.id, raviCustomer.body.id)
  assert.equal((await post(`/api/queue/${raviCustomer.body.id}/transition`, { status: 'No-show' })).status, 200)
  const rejoined = await addWalkIn('Ravi Rejoined', '8000000001', 'Ravi')
  assert.equal(rejoined.body.token, 'S-6')
  assert.equal((await post(`/api/queue/${amitCustomer.body.id}/transition`, { status: 'Cancelled' })).status, 200)

  db.prepare("UPDATE app_meta SET value = '0' WHERE key = 'online_queue_open'").run()
  const remoteAfterClose = await post('/api/bookings', { name: 'Remote', phone: '8000000006', serviceIds: ['haircut'] })
  assert.equal(remoteAfterClose.body.error, 'QUEUE_CLOSED')
  assert.equal((await addWalkIn('Walk-in After Close', '8000000007', 'Any')).status, 201)
  await waitFor(() => updatesOne.length >= 10 && updatesTwo.length >= 10)

  assert.ok(updatesOne.length >= 10)
  assert.ok(updatesTwo.length >= 10)
  console.log('PASS: multiple simultaneous walk-ins receive unique sequential tokens')
  console.log('PASS: Call Next skips another barber’s preference and selects the earliest eligible customer')
  console.log('PASS: one active customer per barber is enforced')
  console.log('PASS: forward-only transitions and No-show/Cancel rules are enforced')
  console.log('PASS: long waits expose elapsed seconds for the amber >60-minute row')
  console.log('PASS: No-show phone can rejoin at the end; walk-ins work while online joining is closed')
  console.log('PASS: two simultaneous Socket.IO browser sessions receive queue updates')
} finally {
  browserOne.disconnect()
  browserTwo.disconnect()
  await new Promise((resolve) => socketServer.close(resolve))
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
}
