import { DurableObject } from 'cloudflare:workers'

export interface Env {
  TABLE: DurableObjectNamespace<TableRoom>
}

/** One hibernating room: fan-out every table message to the other seats. */
export class TableRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue
      peer.send(message)
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code, 'done')
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/crawler-sync/info') {
      return Response.json({ origins: [url.origin] })
    }
    if (url.pathname === '/crawler-sync') {
      const room = url.searchParams.get('room')?.trim()
      if (!room) return new Response('Missing room', { status: 400 })
      return env.TABLE.get(env.TABLE.idFromName(room)).fetch(request)
    }
    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
