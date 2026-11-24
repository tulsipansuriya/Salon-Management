import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { app } from './app'

const port = Number(process.env.PORT ?? 3001)
const httpServer = createServer(app)
export const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' } })

io.on('connection', (socket) => {
  socket.emit('connected', { status: 'ok' })
})

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Salon Queue API listening on http://localhost:${port}`)
})
