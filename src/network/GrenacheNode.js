'use strict'

const { PeerRPCServer, PeerRPCClient } = require('grenache-nodejs-http')
const Link = require('grenache-nodejs-link')
const config = require('../../config/config.json')

/**
 * GrenacheNode
 *
 * Wraps all Grenache/DHT logic in one place.
 * The Peer class only calls this — it never touches Grenache directly.
 *
 * Responsibilities:
 *  - Connect to the DHT via Grape
 *  - Announce this peer's service so others can find it
 *  - Send orders to ALL other peers (broadcast via peer.map)
 *  - Receive orders from other peers (via RPC server)
 */
class GrenacheNode {
    #link
    #server
    #client
    #service
    #peerId
    #grapeUrl
    #port
    #serviceName
    #announceInterval
    #onRequest   // callback: called when a remote peer sends us an order

    /**
     * @param {object} opts
     * @param {string} opts.peerId
     * @param {string} opts.grapeUrl  - e.g. 'http://127.0.0.1:30001'
     * @param {number} opts.port      - Port this peer's RPC server listens on
     * @param {function} opts.onRequest - Called with (payload) when remote order arrives
     */
    constructor({ peerId, grapeUrl, port, onRequest }) {
        this.#peerId = peerId
        this.#grapeUrl = grapeUrl
        this.#port = port
        this.#onRequest = onRequest
        this.#serviceName = config.orderbook.serviceName
        this.#announceInterval = config.orderbook.announceInterval
    }

    // ─── Lifecycle ────────────────────────────────────

    /**
     * Start the DHT link, RPC server, and begin announcing.
     * Returns a Promise that resolves when the server is ready.
     */
    start() {
        return new Promise((resolve, reject) => {
            // 1. Create link to the Grape DHT
            this.#link = new Link({ grape: this.#grapeUrl })
            this.#link.start()

            // 2. Start RPC server — this peer's "inbox"
            this.#server = new PeerRPCServer(this.#link, { timeout: 300000 })
            this.#server.init()

            this.#service = this.#server.transport('server')
            this.#service.listen(this.#port)

            // 3. Start RPC client — used to broadcast to others
            this.#client = new PeerRPCClient(this.#link, {})
            this.#client.init()

            // 4. Announce ourselves to the DHT every second
            // Other peers discover us by looking up this.#serviceName
            const announcer = setInterval(() => {
                this.#link.announce(this.#serviceName, this.#service.port, {})
            }, this.#announceInterval)

            // 5. Listen for incoming RPC requests from other peers
            this.#service.on('request', (rid, key, payload, handler) => {
                try {
                    const result = this.#onRequest(payload)
                    handler.reply(null, { ok: true, result })
                } catch (err) {
                    handler.reply(err.message, null)
                }
            })

            this.#service.on('error', reject)

            // Give DHT a moment to register before resolving
            setTimeout(() => {
                console.log(`[${this.#peerId}] 🌐 Connected to DHT at ${this.#grapeUrl}`)
                console.log(`[${this.#peerId}] 📡 Listening on port ${this.#port}`)
                resolve()
            }, 500)
        })
    }

    /**
     * Broadcast an order to ALL peers on the network.
     * Uses peer.map() — sends to every peer announcing this.#serviceName.
     *
     * @param {object} payload
     * @returns {Promise<array>} results from all peers
     */
    broadcast(payload) {
        return new Promise((resolve) => {
            this.#client.map(
                this.#serviceName,
                payload,
                { timeout: 10000 },
                (err, results) => {
                    if (err && err.message !== 'ERR_GRAPE_LOOKUP_NOT_FOUND') {
                        // Partial failures are okay in P2P — some peers may be offline
                        console.warn(`[${this.#peerId}] Broadcast partial error: ${err.message}`)
                    }
                    resolve(results || [])
                }
            )
        })
    }

    stop() {
        try {
            this.#client?.stop()
            this.#service?.stop()
            this.#server?.stop()
            this.#link?.stop()
        } catch (e) {
            // ignore stop errors
        }
    }
}

module.exports = GrenacheNode