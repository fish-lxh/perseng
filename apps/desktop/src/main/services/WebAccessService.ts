import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import * as logger from '@promptx/logger'

export interface WebAccessStatus {
  enabled: boolean
  url: string
  qrCodeDataUrl: string
  port: number
}

export class WebAccessService {
  private static readonly AUTH_COOKIE_NAME = 'perseng_web_access'
  private static readonly AUTH_MAX_AGE_SECONDS = 60 * 60 * 8
  private server: http.Server | null = null
  private port: number = 5201
  private token: string = ''
  private agentxPort: number = 5200
  private containerId: string = 'perseng-desktop'
  private lastStatus: WebAccessStatus | null = null

  setPort(port: number): void {
    this.port = port
  }

  async enable(agentxPort: number, containerId: string): Promise<WebAccessStatus> {
    if (this.server) {
      await this.disable()
    }

    this.agentxPort = agentxPort
    this.containerId = containerId
    this.token = crypto.randomBytes(16).toString('hex')

    const localIp = this.getLocalIp()
    const url = `http://${localIp}:${this.port}?containerId=${encodeURIComponent(this.containerId)}#token=${this.token}`

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })
    this.server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, '0.0.0.0', () => resolve())
      this.server!.on('error', reject)
    })

    logger.info(`Web access enabled: http://${localIp}:${this.port}`)

    const qrCodeDataUrl = await this.generateQRCode(url)
    const status: WebAccessStatus = { enabled: true, url, qrCodeDataUrl, port: this.port }
    this.lastStatus = status
    return status
  }

  async disable(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve())
      })
      this.server = null
      this.lastStatus = null
      logger.info('Web access disabled')
    }
  }

  isEnabled(): boolean {
    return this.server !== null
  }

  getLastStatus(): WebAccessStatus | null {
    return this.lastStatus
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reqUrl = new URL(req.url || '/', `http://localhost`)
    this.applySecurityHeaders(res)

    // Serve agentxjs browser bundle (no token needed - it's a public asset)
    if (reqUrl.pathname === '/agentxjs.js') {
      const bundlePath = path.join(__dirname, 'web-ui/agentxjs.js')
      if (fs.existsSync(bundlePath)) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        fs.createReadStream(bundlePath).pipe(res)
      } else {
        res.writeHead(404)
        res.end('agentxjs bundle not found')
      }
      return
    }

    if (reqUrl.pathname === '/auth') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Method Not Allowed')
        return
      }
      this.handleAuth(req, res)
      return
    }

    if (reqUrl.pathname !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }

    // Serve main web UI
    const htmlPath = path.join(__dirname, 'web-ui/index.html')
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(htmlPath).pipe(res)
    } else {
      res.writeHead(404)
      res.end('Web UI not found')
    }
  }

  private handleAuth(req: http.IncomingMessage, res: http.ServerResponse): void {
    const token = this.extractBearerToken(req)
    if (token !== this.token) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, error: 'Invalid or missing token.' }))
      return
    }

    res.setHeader(
      'Set-Cookie',
      `${WebAccessService.AUTH_COOKIE_NAME}=${this.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${WebAccessService.AUTH_MAX_AGE_SECONDS}`
    )
    res.writeHead(204)
    res.end()
  }

  private handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): void {
    const reqUrl = new URL(req.url || '/', 'http://localhost')
    if (reqUrl.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    if (!this.isAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    const proxyReq = http.request({
      host: '127.0.0.1',
      port: this.agentxPort,
      method: req.method || 'GET',
      path: '/',
      headers: {
        ...req.headers,
        host: `127.0.0.1:${this.agentxPort}`,
        cookie: undefined,
        authorization: undefined,
      },
    })

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const headerLines = Object.entries(proxyRes.headers)
        .flatMap(([key, value]) => {
          if (value === undefined) return []
          if (Array.isArray(value)) return value.map(item => `${key}: ${item}`)
          return [`${key}: ${value}`]
        })
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join('\r\n')}\r\n\r\n`)
      if (proxyHead.length > 0) {
        socket.write(proxyHead)
      }
      if (head.length > 0) {
        proxySocket.write(head)
      }
      proxySocket.pipe(socket)
      socket.pipe(proxySocket)
    })

    proxyReq.on('error', (error) => {
      logger.warn('Web access WebSocket proxy failed:', String(error))
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      socket.destroy()
    })

    proxyReq.end()
  }

  private applySecurityHeaders(res: http.ServerResponse): void {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    const cookieHeader = req.headers.cookie
    if (!cookieHeader) {
      return false
    }

    const cookies = cookieHeader
      .split(';')
      .map(cookie => cookie.trim().split('='))
      .filter(parts => parts.length >= 2)
      .reduce<Record<string, string>>((acc, [key, ...rest]) => {
        if (!key) {
          return acc
        }
        acc[key] = rest.join('=')
        return acc
      }, {})

    return cookies[WebAccessService.AUTH_COOKIE_NAME] === this.token
  }

  private extractBearerToken(req: http.IncomingMessage): string | null {
    const authorization = req.headers.authorization
    if (!authorization?.startsWith('Bearer ')) {
      return null
    }
    return authorization.slice('Bearer '.length).trim()
  }

  private getLocalIp(): string {
    // First: use routing table to find the interface with the default gateway
    try {
      if (process.platform === 'win32') {
        const output = execSync('route print 0.0.0.0 mask 0.0.0.0', { encoding: 'utf8', timeout: 3000 })
        // Line format: "  0.0.0.0   0.0.0.0   <gateway>   <interface-ip>   <metric>"
        const match = output.match(/\s+0\.0\.0\.0\s+0\.0\.0\.0\s+[\d.]+\s+([\d.]+)\s+/)
        if (match) {
          const ip = match[1]
          if (ip && !ip.startsWith('169.254.') && ip !== '127.0.0.1') return ip
        }
      }
    } catch { /* fall through to scoring */ }

    // Fallback: score-based selection
    const interfaces = os.networkInterfaces()
    const candidates: { address: string; score: number }[] = []
    for (const ifaces of Object.values(interfaces)) {
      for (const iface of (ifaces || [])) {
        if (iface.family !== 'IPv4' || iface.internal) continue
        const addr = iface.address
        if (addr.startsWith('169.254.')) continue
        let score = 0
        if (addr.startsWith('192.168.')) score = 30
        else if (addr.startsWith('10.')) score = 20
        else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score = 10
        candidates.push({ address: addr, score })
      }
    }
    if (candidates.length === 0) return '127.0.0.1'
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]?.address ?? '127.0.0.1'
  }

  private async generateQRCode(url: string): Promise<string> {
    try {
      const QRCode = require('qrcode')
      return await QRCode.toDataURL(url, { width: 256, margin: 2 })
    } catch {
      logger.warn('qrcode package not available, QR code generation skipped')
      return ''
    }
  }
}

export const webAccessService = new WebAccessService()
