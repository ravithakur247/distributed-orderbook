'use strict'

/**
 * Enums for OrderBook
 * 
 * Object.freeze() makes these truly immutable —
 * nobody can accidentally do OrderSide.BUY = 'something_else'
 */

/** Which side of the book the order is on */
const OrderSide = Object.freeze({
    BUY: 'buy',
    SELL: 'sell'
})

/** How the order should be executed */
const OrderType = Object.freeze({
    LIMIT: 'limit',   // wait until my price is met
    MARKET: 'market'   // fill immediately at best available price
})

/** What happened to an order */
const OrderStatus = Object.freeze({
    OPEN: 'open',             // sitting in the book, waiting
    FILLED: 'filled',           // completely filled
    PARTIALLY_FILLED: 'partially_filled', // some filled, remainder in book
    CANCELLED: 'cancelled'         // manually cancelled
})

/** Events fired by the order book — use these as keys */
const OrderBookEvent = Object.freeze({
    TRADE: 'trade',
    ORDER_ADDED: 'order_added',
    ORDER_REMOVED: 'order_removed'
})

module.exports = { OrderSide, OrderType, OrderStatus, OrderBookEvent }