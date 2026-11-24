import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDirectory = mkdtempSync(join(tmpdir(), 'salon-production-serving-'))
process.env.NODE_ENV = 'production'
process.env.DATABASE_PATH = join(testDirectory, 'queue.sqlite')
const [{ app }, { db }] = await Promise.all([import('../server/app.ts'), import('../server/db.ts')])
const httpServer = createServer(app)
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${httpServer.address().port}`

try {
  const indexResponse = await fetch(`${base}/`)
  assert.equal(indexResponse.status, 200)
  assert.match(indexResponse.headers.get('content-type') ?? '', /text\/html/)
  const builtIndex = readFileSync('dist/index.html', 'utf8')
  assert.equal(await indexResponse.text(), builtIndex)

  const deepLink = await fetch(`${base}/status/production-route-check`)
  assert.equal(deepLink.status, 200)
  assert.match(deepLink.headers.get('content-type') ?? '', /text\/html/)
  assert.equal(await deepLink.text(), builtIndex)

  const health = await fetch(`${base}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok', service: 'salon-queue-api', database: 'connected' })

  const unknownApi = await fetch(`${base}/api/missing-route`)
  assert.equal(unknownApi.status, 404)
  assert.notEqual(await unknownApi.text(), builtIndex)

  console.log('PASS: production Express serves dist assets and falls back to index.html for SPA routes')
  console.log('PASS: API and health routes remain handled by Express; unknown /api routes never receive the SPA shell')
} finally {
  await new Promise((resolve) => httpServer.close(resolve))
  db.close()
  rmSync(testDirectory, { recursive: true, force: true })
}
