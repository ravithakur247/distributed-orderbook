'use strict'

const { BidHeap, AskHeap } = require('./Heap')
const { OrderSide, OrderType, OrderStatus, OrderBookEvent } = require('./enums')

/**
 * OrderBook — Generic, plug-and-play order book
 *
 * Improvements over v1:
 *  ✅ MinHeap / MaxHeap instead of sorted arrays → O(log n) inserts
 *  ✅ # private fields instead of _ convention   → truly private
 *  ✅ Enums instead of hardcoded strings          → typo-safe
 *  ✅ P2P ready: getSnapshot, loadSnapshot, applyRemoteOrder
 *
 * Works for any asset pair: BTC/USDT, GOLD/USD, EUR/GBP etc.
 */
class OrderBook {

    // ─── Private fields ──────────────────────────────
    #pair
    #pricePrecision
    #quantityPrecision
    #bids       // BidHeap  — MaxHeap, highest price on top
    #asks       // AskHeap  — MinHeap, lowest price on top
    #trades     // trade history array
    #hooks      // event hooks map

    /**
     * @param {string} pair       - e.g. 'BTC/USDT', 'GOLD/USD'
     * @param {object} [options]
     * @param {number} [options.pricePrecision=2]
     * @param {number} [options.quantityPrecision=8]
     * @param {object} [options.hooks]                  - Event hooks
     * @param {function} [options.hooks.onTrade]        - Called on every trade
     * @param {function} [options.hooks.onOrderAdded]   - Called when order added to book
     * @param {function} [options.hooks.onOrderRemoved] - Called when order removed
     */
    constructor(pair, options = {}) {
        if (!pair) throw new Error('OrderBook requires a trading pair e.g. "BTC/USDT"')

        this.#pair = pair
        this.#pricePrecision = options.pricePrecision ?? 2
        this.#quantityPrecision = options.quantityPrecision ?? 8
        this.#bids = new BidHeap()
        this.#asks = new AskHeap()
        this.#trades = []

        // Hooks — plug your Grenache P2P broadcast logic here
        this.#hooks = {
            [OrderBookEvent.TRADE]: options.hooks?.onTrade || null,
            [OrderBookEvent.ORDER_ADDED]: options.hooks?.onOrderAdded || null,
            [OrderBookEvent.ORDER_REMOVED]: options.hooks?.onOrderRemoved || null,
        }
    }

    // ─── Public API ───────────────────────────────────

    /** Expose pair as read-only */
    get pair() { return this.#pair }

    /**
     * Add a new order. Runs matching automatically.
     *
     * @param {object} order
     * @param {string}  order.id
     * @param {string}  order.side      - Use OrderSide.BUY or OrderSide.SELL
     * @param {string}  [order.type]    - Use OrderType.LIMIT or OrderType.MARKET (default: LIMIT)
     * @param {number}  order.price     - Not needed for MARKET orders
     * @param {number}  order.quantity
     * @param {string}  [order.peerId]  - Which P2P peer submitted this
     * @param {number}  [order.timestamp]
     *
     * @returns {{ trades: array, remainder: object|null, status: string }}
     */
    addOrder(order) {
        this.#validateOrder(order)

        const normalised = {
            id: order.id,
            side: order.side,
            type: order.type || OrderType.LIMIT,
            price: order.type === OrderType.MARKET
                ? null
                : this.#round(order.price, this.#pricePrecision),
            quantity: this.#round(order.quantity, this.#quantityPrecision),
            peerId: order.peerId || null,
            timestamp: order.timestamp || Date.now(),
            status: OrderStatus.OPEN
        }

        const { trades, remainder } = this.#match(normalised)

        // ⚠️  Push trades to history FIRST before any hooks fire.
        // Hooks trigger SSE which calls getTrades() — if we push after,
        // the new trade is missing from the browser update. Bug fixed here.
        this.#trades.push(...trades)

        // Now emit TRADE hooks — trades are in this.#trades so getTrades() is up to date
        trades.forEach(trade => this.#emit(OrderBookEvent.TRADE, trade))

        // Determine final status
        if (remainder && remainder.quantity > 0) {
            remainder.status = trades.length > 0
                ? OrderStatus.PARTIALLY_FILLED
                : OrderStatus.OPEN

            // Only limit orders sit in the book — market orders vanish
            if (remainder.type === OrderType.LIMIT) {
                this.#insertOrder(remainder)
                this.#emit(OrderBookEvent.ORDER_ADDED, remainder)
            }
        }


        return {
            trades,
            remainder: remainder?.quantity > 0 ? remainder : null,
            status: remainder?.quantity > 0
                ? remainder.status
                : OrderStatus.FILLED
        }
    }

    /**
     * Cancel an order by ID.
     * @param {string} orderId
     * @returns {object|null}
     */
    cancelOrder(orderId) {
        // Try bids first, then asks
        let cancelled = this.#bids.removeById(orderId)
            ?? this.#asks.removeById(orderId)

        if (cancelled) {
            cancelled.status = OrderStatus.CANCELLED
            this.#emit(OrderBookEvent.ORDER_REMOVED, cancelled)
        }
        return cancelled
    }

    /**
     * Apply an order received from a remote peer via P2P.
     * Call this inside your Grenache RPC handler.
     * @param {object} order
     */
    applyRemoteOrder(order) {
        return this.addOrder({ ...order, remote: true })
    }

    /**
     * Export full book state as a plain object.
     * Use this to sync state to a new peer joining the network.
     * @returns {object}
     */
    getSnapshot() {
        return {
            pair: this.#pair,
            timestamp: Date.now(),
            bids: this.#bids.toArray().map(o => ({ ...o })),
            asks: this.#asks.toArray().map(o => ({ ...o })),
            bestBid: this.bestBid(),
            bestAsk: this.bestAsk(),
            spread: this.spread()
        }
    }

    /**
     * Load a snapshot from another peer.
     * @param {object} snapshot - Result of getSnapshot() from another peer
     */
    loadSnapshot(snapshot) {
        if (snapshot.pair !== this.#pair) {
            throw new Error(`Pair mismatch: expected ${this.#pair}, got ${snapshot.pair}`)
        }
        // Rebuild heaps from snapshot arrays
        this.#bids = new BidHeap()
        this.#asks = new AskHeap()
        snapshot.bids.forEach(o => this.#bids.insert(o))
        snapshot.asks.forEach(o => this.#asks.insert(o))
    }

    // ─── Book Queries ─────────────────────────────────

    /** Best bid — highest buy price. O(1) */
    bestBid() { return this.#bids.peek() }

    /** Best ask — lowest sell price. O(1) */
    bestAsk() { return this.#asks.peek() }

    /** Spread between best ask and best bid */
    spread() {
        if (!this.bestBid() || !this.bestAsk()) return null
        return this.#round(this.bestAsk().price - this.bestBid().price, this.#pricePrecision)
    }

    getBids() { return this.#bids.toArray() }
    getAsks() { return this.#asks.toArray() }
    getTrades() { return [...this.#trades] }

    // ─── Matching Engine (private) ────────────────────

    #match(order) {
        const trades = []
        const remainder = { ...order }

        const opposingHeap = order.side === OrderSide.BUY
            ? this.#asks   // buyer matches against sellers
            : this.#bids   // seller matches against buyers

        while (remainder.quantity > 0 && !opposingHeap.isEmpty) {
            const best = opposingHeap.peek()

            const priceMatches = order.type === OrderType.MARKET
                ? true
                : order.side === OrderSide.BUY
                    ? remainder.price >= best.price   // buyer pays >= seller asks
                    : remainder.price <= best.price   // seller asks <= buyer pays

            if (!priceMatches) break

            const tradedQty = this.#round(Math.min(remainder.quantity, best.quantity), this.#quantityPrecision)
            const tradePrice = best.price // always at resting order's price

            const trade = {
                id: `${remainder.id}_${best.id}_${Date.now()}`,
                pair: this.#pair,
                price: tradePrice,
                quantity: tradedQty,
                buyOrderId: order.side === OrderSide.BUY ? remainder.id : best.id,
                sellOrderId: order.side === OrderSide.SELL ? remainder.id : best.id,
                buyPeerId: order.side === OrderSide.BUY ? remainder.peerId : best.peerId,
                sellPeerId: order.side === OrderSide.SELL ? remainder.peerId : best.peerId,
                timestamp: Date.now()
            }

            trades.push(trade)

            remainder.quantity = this.#round(remainder.quantity - tradedQty, this.#quantityPrecision)
            best.quantity = this.#round(best.quantity - tradedQty, this.#quantityPrecision)

            if (best.quantity === 0) {
                opposingHeap.extractTop()   // O(log n) — remove fulfilled order
                this.#emit(OrderBookEvent.ORDER_REMOVED, best)
            } else {
                // Partially filled resting order — update in place O(1)
                opposingHeap.updateQuantity(best.id, best.quantity)
            }
        }

        return { trades, remainder }
    }

    // ─── Insert (private) ─────────────────────────────

    #insertOrder(order) {
        if (order.side === OrderSide.BUY) {
            this.#bids.insert(order)   // O(log n)
        } else {
            this.#asks.insert(order)   // O(log n)
        }
    }

    // ─── Validation (private) ─────────────────────────

    #validateOrder(order) {
        if (!order.id)
            throw new Error('Order must have an id')

        if (!Object.values(OrderSide).includes(order.side))
            throw new Error(`Order side must be one of: ${Object.values(OrderSide).join(', ')}`)

        if (order.type && !Object.values(OrderType).includes(order.type))
            throw new Error(`Order type must be one of: ${Object.values(OrderType).join(', ')}`)

        if (order.type !== OrderType.MARKET && (order.price == null || order.price <= 0))
            throw new Error('Limit order must have a positive price')

        if (!order.quantity || order.quantity <= 0)
            throw new Error('Order quantity must be positive')
    }

    // ─── Event emitter (private) ──────────────────────

    #emit(event, data) {
        const hook = this.#hooks[event]
        if (hook) hook(data)
    }

    // ─── Utilities (private) ──────────────────────────

    #round(value, decimals) {
        return parseFloat(value.toFixed(decimals))
    }
}

module.exports = { OrderBook, OrderSide, OrderType, OrderStatus, OrderBookEvent }