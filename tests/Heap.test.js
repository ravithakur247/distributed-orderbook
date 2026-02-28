'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { BidHeap, AskHeap } = require('../src/core/Heap')

describe('BidHeap (MaxHeap — highest price first)', () => {

    test('peek returns highest price', () => {
        const h = new BidHeap()
        h.insert({ id: '1', price: 90, quantity: 1, timestamp: 1 })
        h.insert({ id: '2', price: 100, quantity: 1, timestamp: 2 })
        h.insert({ id: '3', price: 95, quantity: 1, timestamp: 3 })
        assert.strictEqual(h.peek().price, 100)
    })

    test('extractTop removes and returns highest price', () => {
        const h = new BidHeap()
        h.insert({ id: '1', price: 90, quantity: 1, timestamp: 1 })
        h.insert({ id: '2', price: 100, quantity: 1, timestamp: 2 })
        const top = h.extractTop()
        assert.strictEqual(top.price, 100)
        assert.strictEqual(h.peek().price, 90)
    })

    test('same price — earlier timestamp wins', () => {
        const h = new BidHeap()
        h.insert({ id: 'late', price: 100, quantity: 1, timestamp: 2000 })
        h.insert({ id: 'early', price: 100, quantity: 1, timestamp: 1000 })
        assert.strictEqual(h.peek().id, 'early')
    })

    test('removeById removes correct item', () => {
        const h = new BidHeap()
        h.insert({ id: 'a', price: 100, quantity: 1, timestamp: 1 })
        h.insert({ id: 'b', price: 90, quantity: 1, timestamp: 2 })
        const removed = h.removeById('a')
        assert.strictEqual(removed.id, 'a')
        assert.strictEqual(h.size, 1)
        assert.strictEqual(h.peek().id, 'b')
    })

    test('returns null for non-existent removeById', () => {
        const h = new BidHeap()
        assert.strictEqual(h.removeById('nope'), null)
    })

    test('isEmpty works correctly', () => {
        const h = new BidHeap()
        assert.ok(h.isEmpty)
        h.insert({ id: '1', price: 100, quantity: 1, timestamp: 1 })
        assert.ok(!h.isEmpty)
        h.extractTop()
        assert.ok(h.isEmpty)
    })

})

describe('AskHeap (MinHeap — lowest price first)', () => {

    test('peek returns lowest price', () => {
        const h = new AskHeap()
        h.insert({ id: '1', price: 110, quantity: 1, timestamp: 1 })
        h.insert({ id: '2', price: 100, quantity: 1, timestamp: 2 })
        h.insert({ id: '3', price: 105, quantity: 1, timestamp: 3 })
        assert.strictEqual(h.peek().price, 100)
    })

    test('extractTop removes and returns lowest price', () => {
        const h = new AskHeap()
        h.insert({ id: '1', price: 110, quantity: 1, timestamp: 1 })
        h.insert({ id: '2', price: 100, quantity: 1, timestamp: 2 })
        const top = h.extractTop()
        assert.strictEqual(top.price, 100)
        assert.strictEqual(h.peek().price, 110)
    })

    test('same price — earlier timestamp wins', () => {
        const h = new AskHeap()
        h.insert({ id: 'late', price: 100, quantity: 1, timestamp: 2000 })
        h.insert({ id: 'early', price: 100, quantity: 1, timestamp: 1000 })
        assert.strictEqual(h.peek().id, 'early')
    })

})