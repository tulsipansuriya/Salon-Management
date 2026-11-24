import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { app } from './app'
import { allowedClientOrigins } from './cors'

const port = Number(process.env.PORT ?? 3001)
const httpServer = createServer(app)
export const io = new Server(httpServer, {
  cors: { origin: allowedClientOrigins, methods: ['GET', 'POST'] },
  allowRequest: (request, callback) => {
    const requestOrigin = request.headers.origin?.replace(/\/$/, '')
    callback(null, !requestOrigin || allowedClientOrigins.includes(requestOrigin))
  },
})
app.set('io', io)

io.on('connection', (socket) => {
  socket.emit('connected', { status: 'ok' })
})

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Salon Queue API listening on port ${port}`)
})
