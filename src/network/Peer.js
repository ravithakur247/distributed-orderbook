'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const GrenacheNode = require('./GrenacheNode')
const { OrderBook, OrderSide, OrderType, OrderStatus } = require('../core/OrderBook')
const config = require('../../config/config.json')

/**
 * Peer
 *
 * The top-level node. Each running instance is one peer in the P2P network.
 *
 * Combines:
 *  - OrderBook     : local in-memory order book
 *  - GrenacheNode  : P2P broadcast / receive via DHT
 *  - HTTP Server   : REST + SSE API consumed by the React UI
 *
 * Flow when a local order is submitted:
 *  1. Add to local OrderBook (matching runs instantly)
 *  2. Broadcast to all peers via Grenache
 *  3. Each remote peer calls applyRemoteOrder on their local book
 *  4. All SSE clients (browser tabs) get a push update
 *
 * Flow when a remote order arrives:
 *  1. GrenacheNode receives it, calls onRequest
 *  2. Peer calls applyRemoteOrder on local OrderBook
 *  3. SSE push update to browser
 */
class Peer {
    #peerId
    #port
    #uiPort
    #grapeUrl
    #orderBook
    #grenache
    #sseClients   // connected browser EventSource clients

    constructor() {
        // Config from env vars (set by npm scripts) or defaults
        this.#peerId = process.env.PEER_ID || 'peer_1'
        this.#port = parseInt(process.env.PEER_PORT || '3001')
        this.#uiPort = parseInt(process.env.UI_PORT || '8081')

        // Pick a grape url — spread peers across both grapes for resilience
        const peers = config.peers
        const peerConf = peers.find(p => p.id === this.#peerId) || peers[0]
        this.#grapeUrl = peerConf.grapeUrl

        this.#sseClients = new Set()

        // Create order book with hooks wired to broadcast + SSE
        this.#orderBook = new OrderBook(config.orderbook.pair, {
            pricePrecision: config.orderbook.pricePrecision,
            quantityPrecision: config.orderbook.quantityPrecision,
            hooks: {
                onTrade: trade => this.#onTrade(trade),
                onOrderAdded: order => this.#pushSSE('order_added', order),
                onOrderRemoved: order => this.#pushSSE('order_removed', order)
            }
        })

        // Create grenache node with our RPC handler
        this.#grenache = new GrenacheNode({
            peerId: this.#peerId,
            grapeUrl: this.#grapeUrl,
            port: this.#port,
            onRequest: payload => this.#handleRemoteMessage(payload)
        })
    }

    // ─── Lifecycle ────────────────────────────────────

    async start() {
        await this.#grenache.start()
        this.#startHttpServer()
        console.log(`[${this.#peerId}] ✅ Peer ready`)
        console.log(`[${this.#peerId}] 🖥  UI available at http://localhost:${this.#uiPort}`)
    }

    // ─── Order Submission (local) ─────────────────────

    /**
     * Submit a new order from THIS peer's UI.
     * 1. Add locally, 2. Broadcast to all peers.
     */
    async submitOrder({ side, type, price, quantity }) {
        const order = {
            id: randomUUID(),
            side,
            type: type || OrderType.LIMIT,
            price: parseFloat(price),
            quantity: parseFloat(quantity),
            peerId: this.#peerId,
            timestamp: Date.now()
        }

        // Step 1 — apply locally
        const result = this.#orderBook.addOrder(order)

        // Step 2 — broadcast to all other peers
        // We send the original order, not the result, so others can run their own matching
        await this.#grenache.broadcast({
            type: 'NEW_ORDER',
            order: order
        }).catch(err => {
            // Non-fatal — log but don't crash
            console.warn(`[${this.#peerId}] Broadcast failed: ${err.message}`)
        })

        return result
    }

    // ─── Remote Message Handler ───────────────────────

    /**
     * Called by GrenacheNode when a message arrives from another peer.
     */
    #handleRemoteMessage(payload) {
        if (!payload?.type) return null

        switch (payload.type) {

            case 'NEW_ORDER': {
                // Don't re-apply our own orders (we already applied them locally)
                if (payload.order.peerId === this.#peerId) return null

                console.log(`[${this.#peerId}] 📨 Remote order from ${payload.order.peerId}`)
                return this.#orderBook.applyRemoteOrder(payload.order)
            }

            case 'SNAPSHOT_REQUEST': {
                // A new peer is asking for our current book state
                console.log(`[${this.#peerId}] 📸 Snapshot requested`)
                return this.#orderBook.getSnapshot()
            }

            default:
                return null
        }
    }

    // ─── Event Hooks ──────────────────────────────────

    #onTrade(trade) {
        console.log(`[${this.#peerId}] 💰 TRADE: ${trade.quantity} @ ${trade.price}`)
        this.#pushSSE('trade', trade)
    }

    // ─── HTTP Server (REST + SSE for React UI) ────────

    #startHttpServer() {
        const server = http.createServer((req, res) => {
            // CORS headers — allow React dev server to connect
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

            if (req.method === 'OPTIONS') {
                res.writeHead(204)
                res.end()
                return
            }

            const url = new URL(req.url, `http://localhost:${this.#uiPort}`)

            // ── GET /state — full book snapshot ─────────
            if (req.method === 'GET' && url.pathname === '/state') {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    peerId: this.#peerId,
                    pair: config.orderbook.pair,
                    ...this.#orderBook.getSnapshot(),
                    trades: this.#orderBook.getTrades().slice(-20) // last 20 trades
                }))
                return
            }

            // ── POST /order — submit a new order ─────────
            if (req.method === 'POST' && url.pathname === '/order') {
                let body = ''
                req.on('data', chunk => body += chunk)
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body)
                        const result = await this.submitOrder(data)
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ ok: true, ...result }))
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ ok: false, error: err.message }))
                    }
                })
                return
            }

            // ── DELETE /order/:id — cancel an order ──────
            if (req.method === 'DELETE' && url.pathname.startsWith('/order/')) {
                const orderId = url.pathname.replace('/order/', '')
                const cancelled = this.#orderBook.cancelOrder(orderId)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: !!cancelled, cancelled }))
                return
            }

            // ── GET /events — SSE stream for React UI ────
            if (req.method === 'GET' && url.pathname === '/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                })

                // Send initial state immediately on connect
                const snapshot = this.#orderBook.getSnapshot()
                res.write(`data: ${JSON.stringify({ type: 'snapshot', payload: snapshot })}\n\n`)

                this.#sseClients.add(res)
                console.log(`[${this.#peerId}] 🔌 UI connected (${this.#sseClients.size} clients)`)

                req.on('close', () => {
                    this.#sseClients.delete(res)
                    console.log(`[${this.#peerId}] 🔌 UI disconnected`)
                })
                return
            }


            // ── GET / — serve React UI ───────────────────
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                const uiPath = path.join(__dirname, '../ui/index.html')
                fs.readFile(uiPath, (err, data) => {
                    if (err) { res.writeHead(404); res.end('UI not found'); return }
                    res.writeHead(200, { 'Content-Type': 'text/html' })
                    res.end(data)
                })
                return
            }

            res.writeHead(404)
            res.end('Not found')
        })

        server.listen(this.#uiPort, () => {
            console.log(`[${this.#peerId}] 🌍 HTTP API on port ${this.#uiPort}`)
        })
    }

    // ─── SSE Push ─────────────────────────────────────

    /**
     * Push a real-time event to all connected browser clients.
     * Also sends a fresh snapshot so the UI is always in sync.
     */
    #pushSSE(eventType, data) {
        if (this.#sseClients.size === 0) return

        const snapshot = this.#orderBook.getSnapshot()
        const message = JSON.stringify({
            type: eventType,
            payload: data,
            snapshot: snapshot,
            trades: this.#orderBook.getTrades().slice(-20)
        })

        this.#sseClients.forEach(client => {
            try {
                client.write(`data: ${message}\n\n`)
            } catch (e) {
                this.#sseClients.delete(client)
            }
        })
    }
}

// ─── Bootstrap ────────────────────────────────────────

const peer = new Peer()
peer.start().catch(err => {
    console.error('Failed to start peer:', err)
    process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down peer...')
    process.exit(0)
})