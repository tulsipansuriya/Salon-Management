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

const testDirectory = mkdtempSync(join(tmpdir(), 'salon-barber-display-'))
process.env.DATABASE_PATH = join(testDirectory, 'queue.sqlite')
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')])
const httpServer = createServer(app)
const socketServer = new Server(httpServer, { cors: { origin: '*' } })
app.set('io', socketServer)
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
    if (NativeDate.now() > deadline) throw new Error('Timed out waiting for socket event')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const waitForConnect = (socket) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Socket connection timed out')), 2_000)
  socket.once('connect', () => { clearTimeout(timeout); resolve() })
  socket.once('connect_error', reject)
})

const tvOne = connect(base, { transports: ['websocket'], reconnection: false })
const tvTwo = connect(base, { transports: ['websocket'], reconnection: false })
const calledOne = []
const calledTwo = []
const updatesTwo = []
tvOne.on('queue:called', (event) => calledOne.push(event))
tvTwo.on('queue:called', (event) => calledTwo.push(event))
tvTwo.on('queue:update', (event) => updatesTwo.push(event))

try {
  await Promise.all([waitForConnect(tvOne), waitForConnect(tvTwo)])
  const preferences = ['Ravi', 'Any', 'Ravi', 'Amit', 'Any', 'Imran', 'Any']
  const customers = []
  for (let index = 0; index < preferences.length; index += 1) {
    const response = await post('/api/reception/walk-ins', {
      name: `Customer ${index + 1}`, phone: `810000000${index + 1}`, serviceIds: ['haircut'], preferredBarber: preferences[index],
    })
    assert.equal(response.status, 201)
    customers.push(response.body)
  }

  assert.equal((await get('/api/barbers/amit/view')).body.nextCustomer.token, 'S-2')
  assert.equal((await get('/api/barbers/ravi/view')).body.nextCustomer.token, 'S-1')

  const breakOn = await post('/api/barbers/Ravi/break', { onBreak: true })
  assert.equal(breakOn.body.onBreak, true)
  assert.equal((await get('/api/bootstrap')).body.availableBarberCount, 2)
  assert.equal((await post('/api/barbers/Ravi/call-next')).body.error, 'BARBER_ON_BREAK')
  assert.equal((await post('/api/barbers/ravi/break', { onBreak: false })).body.onBreak, false)

  const call = await post('/api/barbers/Amit/call-next')
  assert.equal(call.status, 200)
  assert.equal(call.body.id, customers[1].id)
  assert.equal(call.body.barberName, 'Amit')
  await waitFor(() => calledOne.length === 1 && calledTwo.length === 1)
  assert.equal(calledOne[0].id, customers[1].id)
  assert.equal(calledOne[0].durationMs, 5_000)
  assert.equal((await post('/api/barbers/amit/call-next')).body.error, 'BARBER_HAS_ACTIVE_CUSTOMER')
  assert.equal((await post(`/api/barbers/Ravi/queue/${customers[1].id}/transition`, { status: 'In Chair' })).status, 409)

  let display = (await get('/api/display')).body
  assert.equal(display.barbers.find((barber) => barber.name === 'Amit').currentCustomer.token, 'S-2')
  assert.equal(Date.parse(display.barbers.find((barber) => barber.name === 'Amit').currentCustomer.flashUntil) - Date.parse(display.barbers.find((barber) => barber.name === 'Amit').currentCustomer.calledAt), 5_000)
  assert.deepEqual(display.upNext.map((entry) => entry.token), ['S-1', 'S-3', 'S-4', 'S-5', 'S-6'])

  assert.equal((await post(`/api/barbers/Amit/queue/${customers[1].id}/transition`, { status: 'In Chair' })).status, 200)
  now = '2026-11-24T06:01:30.000Z'
  let barberView = (await get('/api/barbers/amit/view')).body
  assert.equal(barberView.currentCustomer.status, 'In Chair')
  assert.equal(barberView.currentCustomer.elapsedSeconds, 90)
  assert.equal((await post(`/api/barbers/amit/queue/${customers[1].id}/transition`, { status: 'Done' })).status, 200)
  display = (await get('/api/display')).body
  assert.equal(display.barbers.find((barber) => barber.name === 'Amit').currentCustomer, null)
  assert.ok(!display.upNext.some((entry) => entry.id === customers[1].id))

  const nextAmit = await post('/api/barbers/amit/call-next')
  assert.equal(nextAmit.body.id, customers[3].id)
  await waitFor(() => calledOne.length === 2 && calledTwo.length === 2)
  assert.ok(updatesTwo.length >= 10)
  console.log('PASS: barber preview skips customers who chose a different barber')
  console.log('PASS: break toggle persists and removes the barber from wait capacity')
  console.log('PASS: Call Next emits the called token with a five-second flash duration to two clients')
  console.log('PASS: barber current service timer advances and Start/Done transitions update the TV snapshot')
  console.log('PASS: TV snapshot lists the next five FCFS tokens and removes completed customers')
} finally {
  tvOne.disconnect()
  tvTwo.disconnect()
  await new Promise((resolve) => socketServer.close(resolve))
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
}
