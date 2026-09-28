import { networkInterfaces } from 'node:os'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Plugin, ViteDevServer } from 'vite'
import { WebSocketServer, type WebSocket } from 'ws'

const PATH = '/crawler-sync'
const INFO = '/crawler-sync/info'

interface Client {
  id: string
  role: string
  room: string
  socket: WebSocket
}

export function tableRelay(): Plugin {
  const rooms = new Map<string, Set<Client>>()
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? PATH, 'http://localhost')
    const room = url.searchParams.get('room')?.trim() ?? ''
    const id = url.searchParams.get('id')?.trim() || crypto.randomUUID()
    const role = url.searchParams.get('role')?.trim() || 'guest'
    if (!room) {
      socket.close()
      return
    }
    const client: Client = { id, role, room, socket }
    const members = rooms.get(room) ?? new Set()
    members.add(client)
    rooms.set(room, members)

    socket.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString()
      for (const other of members) {
        if (other === client || other.socket.readyState !== other.socket.OPEN) continue
        other.socket.send(text)
      }
    })

    socket.on('close', () => {
      members.delete(client)
      if (members.size === 0) rooms.delete(room)
    })
  })

  function origins(port: number): string[] {
    const found = new Set<string>([`http://localhost:${port}`])
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.internal || net.family !== 'IPv4') continue
        found.add(`http://${net.address}:${port}`)
      }
    }
    return [...found]
  }

  function attach(server: ViteDevServer['httpServer']): void {
    if (!server || (server as { __crawlerRelay?: boolean }).__crawlerRelay) return
    ;(server as { __crawlerRelay?: boolean }).__crawlerRelay = true
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '', 'http://localhost')
      if (url.pathname !== PATH) return
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    })
  }

  function infoMiddleware(server: ViteDevServer): void {
    server.middlewares.use(INFO, (_req, res) => {
      const address = server.httpServer?.address()
      const port = typeof address === 'object' && address ? address.port : 5173
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ port, origins: origins(port) }))
    })
  }

  return {
    name: 'crawler-table-relay',
    configureServer(server) {
      infoMiddleware(server)
      attach(server.httpServer)
      server.httpServer?.once('listening', () => attach(server.httpServer))
    },
    configurePreviewServer(server) {
      infoMiddleware(server as unknown as ViteDevServer)
      if (server.httpServer) attach(server.httpServer)
    },
  }
}
