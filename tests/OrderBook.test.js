'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { OrderBook, OrderSide, OrderType, OrderStatus } = require('../src/core/OrderBook')

// ─────────────────────────────────────────────
describe('OrderBook — Constructor', () => {

    test('creates with valid pair', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.strictEqual(ob.pair, 'BTC/USDT')
    })

    test('throws if no pair provided', () => {
        assert.throws(() => new OrderBook(), /requires a trading pair/)
    })

    test('starts with empty bids and asks', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.deepStrictEqual(ob.getBids(), [])
        assert.deepStrictEqual(ob.getAsks(), [])
    })

    test('bestBid and bestAsk are null when empty', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.strictEqual(ob.bestBid(), null)
        assert.strictEqual(ob.bestAsk(), null)
        assert.strictEqual(ob.spread(), null)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — addOrder validation', () => {

    test('throws if no id', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.throws(() => ob.addOrder({ side: OrderSide.BUY, price: 100, quantity: 1 }), /must have an id/)
    })

    test('throws on invalid side', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.throws(() => ob.addOrder({ id: '1', side: 'byu', price: 100, quantity: 1 }), /side must be/)
    })

    test('throws on invalid type', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.throws(() => ob.addOrder({ id: '1', side: OrderSide.BUY, type: 'fake', price: 100, quantity: 1 }), /type must be/)
    })

    test('throws on missing price for limit order', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.throws(() => ob.addOrder({ id: '1', side: OrderSide.BUY, quantity: 1 }), /positive price/)
    })

    test('throws on zero quantity', () => {
        const ob = new OrderBook('BTC/USDT')
        assert.throws(() => ob.addOrder({ id: '1', side: OrderSide.BUY, price: 100, quantity: 0 }), /quantity must be positive/)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Limit Order Insertion', () => {

    test('buy order sits in bids when no match', () => {
        const ob = new OrderBook('BTC/USDT')
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        assert.strictEqual(ob.getBids().length, 1)
        assert.strictEqual(r.trades.length, 0)
        assert.strictEqual(r.status, OrderStatus.OPEN)
    })

    test('sell order sits in asks when no match', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 100, quantity: 1 })
        assert.strictEqual(ob.getAsks().length, 1)
    })

    test('bestBid always returns highest price regardless of insertion order', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 90, quantity: 1 })
        ob.addOrder({ id: 'b2', side: OrderSide.BUY, price: 100, quantity: 1 })
        ob.addOrder({ id: 'b3', side: OrderSide.BUY, price: 95, quantity: 1 })
        // Heap guarantees: peek() is always the max — not that the full array is sorted
        assert.strictEqual(ob.bestBid().price, 100)
        assert.strictEqual(ob.getBids().length, 3)
    })

    test('asks sorted low to high', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 110, quantity: 1 })
        ob.addOrder({ id: 'a2', side: OrderSide.SELL, price: 100, quantity: 1 })
        ob.addOrder({ id: 'a3', side: OrderSide.SELL, price: 105, quantity: 1 })
        assert.strictEqual(ob.bestAsk().price, 100)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Matching Engine', () => {

    test('exact match — both orders fully filled', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 's1', side: OrderSide.SELL, price: 100, quantity: 1 })
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })

        assert.strictEqual(r.trades.length, 1)
        assert.strictEqual(r.trades[0].quantity, 1)
        assert.strictEqual(r.trades[0].price, 100)
        assert.strictEqual(r.status, OrderStatus.FILLED)
        assert.strictEqual(ob.getAsks().length, 0)
        assert.strictEqual(ob.getBids().length, 0)
    })

    test('buyer pays more — trade at seller price (price improvement)', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 's1', side: OrderSide.SELL, price: 5, quantity: 10 })
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 10, quantity: 2 })

        assert.strictEqual(r.trades[0].price, 5)       // at seller's price, not buyer's
        assert.strictEqual(r.trades[0].quantity, 2)
        assert.strictEqual(ob.getAsks()[0].quantity, 8) // 10 - 2 = 8 remaining
    })

    test('partial fill — buyer wants more than available', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 's1', side: OrderSide.SELL, price: 100, quantity: 2 })
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 10 })

        assert.strictEqual(r.trades[0].quantity, 2)
        assert.strictEqual(r.status, OrderStatus.PARTIALLY_FILLED)
        assert.strictEqual(r.remainder.quantity, 8)
        assert.strictEqual(ob.getBids()[0].quantity, 8) // remainder sits in book
    })

    test('partial fill — seller has more than buyer wants', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 's1', side: OrderSide.SELL, price: 100, quantity: 10 })
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 3 })

        assert.strictEqual(r.trades[0].quantity, 3)
        assert.strictEqual(r.status, OrderStatus.FILLED)
        assert.strictEqual(ob.getAsks()[0].quantity, 7) // 10 - 3 = 7 remaining in ask
        assert.strictEqual(ob.getBids().length, 0)       // buyer fully filled
    })

    test('no match when prices dont cross', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 's1', side: OrderSide.SELL, price: 110, quantity: 1 })
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })

        assert.strictEqual(r.trades.length, 0)
        assert.strictEqual(ob.getAsks().length, 1)
        assert.strictEqual(ob.getBids().length, 1)
    })

    test('market order sweeps multiple price levels', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 100, quantity: 1 })
        ob.addOrder({ id: 'a2', side: OrderSide.SELL, price: 110, quantity: 2 })
        const r = ob.addOrder({ id: 'm1', side: OrderSide.BUY, type: OrderType.MARKET, quantity: 2.5 })

        assert.strictEqual(r.trades.length, 2)
        assert.strictEqual(r.trades[0].price, 100) // cheapest first
        assert.strictEqual(r.trades[1].price, 110)
        assert.strictEqual(r.status, OrderStatus.FILLED)
    })

    test('market order does not sit in book if unfilled', () => {
        const ob = new OrderBook('BTC/USDT')
        // No asks at all
        const r = ob.addOrder({ id: 'm1', side: OrderSide.BUY, type: OrderType.MARKET, quantity: 1 })
        assert.strictEqual(ob.getBids().length, 0) // market orders never sit in book
        assert.strictEqual(r.trades.length, 0)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Price-Time Priority', () => {

    test('same price — earlier order matched first', () => {
        const ob = new OrderBook('BTC/USDT')
        const t1 = Date.now()
        const t2 = t1 + 1000

        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 100, quantity: 1, timestamp: t1 })
        ob.addOrder({ id: 'a2', side: OrderSide.SELL, price: 100, quantity: 1, timestamp: t2 })

        // Buy 1 — should match a1 (earlier)
        const r = ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        assert.strictEqual(r.trades[0].sellOrderId, 'a1')
        assert.strictEqual(ob.getAsks()[0].id, 'a2') // a2 still in book
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Cancel Order', () => {

    test('cancels existing order', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        const cancelled = ob.cancelOrder('b1')

        assert.strictEqual(cancelled.id, 'b1')
        assert.strictEqual(cancelled.status, OrderStatus.CANCELLED)
        assert.strictEqual(ob.getBids().length, 0)
    })

    test('returns null for non-existent order', () => {
        const ob = new OrderBook('BTC/USDT')
        const r = ob.cancelOrder('doesnt_exist')
        assert.strictEqual(r, null)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Spread', () => {

    test('calculates correct spread', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 105, quantity: 1 })
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        assert.strictEqual(ob.spread(), 5)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Snapshot (P2P Sync)', () => {

    test('snapshot contains all book state', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 110, quantity: 1 })
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })

        const snap = ob.getSnapshot()
        assert.strictEqual(snap.pair, 'BTC/USDT')
        assert.strictEqual(snap.asks.length, 1)
        assert.strictEqual(snap.bids.length, 1)
        assert.ok(snap.timestamp)
    })

    test('loadSnapshot restores book state correctly', () => {
        const ob1 = new OrderBook('BTC/USDT')
        ob1.addOrder({ id: 'a1', side: OrderSide.SELL, price: 110, quantity: 1.5 })
        ob1.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 2.0 })

        const ob2 = new OrderBook('BTC/USDT')
        ob2.loadSnapshot(ob1.getSnapshot())

        assert.strictEqual(ob2.bestAsk().price, 110)
        assert.strictEqual(ob2.bestBid().price, 100)
        assert.strictEqual(ob2.getAsks()[0].quantity, 1.5)
    })

    test('loadSnapshot throws on pair mismatch', () => {
        const ob1 = new OrderBook('BTC/USDT')
        const ob2 = new OrderBook('ETH/USDT')
        assert.throws(() => ob2.loadSnapshot(ob1.getSnapshot()), /Pair mismatch/)
    })

    test('applyRemoteOrder processes remote order correctly', () => {
        const ob = new OrderBook('BTC/USDT')
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 100, quantity: 1 })

        const r = ob.applyRemoteOrder({ id: 'r1', side: OrderSide.BUY, price: 100, quantity: 1, peerId: 'peer_B' })
        assert.strictEqual(r.trades.length, 1)
    })

})

// ─────────────────────────────────────────────
describe('OrderBook — Hooks (Event System)', () => {

    test('onTrade fires when trade executes', () => {
        let fired = false
        const ob = new OrderBook('BTC/USDT', { hooks: { onTrade: () => { fired = true } } })
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 100, quantity: 1 })
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        assert.ok(fired)
    })

    test('onOrderAdded fires when order sits in book', () => {
        let added = null
        const ob = new OrderBook('BTC/USDT', { hooks: { onOrderAdded: o => { added = o } } })
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        assert.strictEqual(added.id, 'b1')
    })

    test('onOrderRemoved fires when order fully filled', () => {
        let removed = null
        const ob = new OrderBook('BTC/USDT', { hooks: { onOrderRemoved: o => { removed = o } } })
        ob.addOrder({ id: 'a1', side: OrderSide.SELL, price: 100, quantity: 1 })
        ob.addOrder({ id: 'b1', side: OrderSide.BUY, price: 100, quantity: 1 })
        assert.strictEqual(removed.id, 'a1')
    })

})