'use strict'

/**
 * HEAP FUNDAMENTALS
 * -----------------
 * A heap is a binary tree stored as a flat array.
 * 
 * For any node at index i:
 *   Left child  → 2i + 1
 *   Right child → 2i + 2
 *   Parent      → Math.floor((i - 1) / 2)
 *
 * MaxHeap → parent is always GREATER than children (best bid — highest price on top)
 * MinHeap → parent is always SMALLER than children (best ask — lowest price on top)
 *
 * Key operations:
 *   insert → O(log n)  — add to end, bubble UP
 *   peek   → O(1)      — just look at index [0]
 *   remove → O(log n)  — swap root with last, remove last, bubble DOWN
 */

class Heap {
    #data = []
    #comparator

    /**
     * @param {function} comparator
     *   Return negative if a should be above b (higher priority)
     *   Return positive if b should be above a
     */
    constructor(comparator) {
        this.#comparator = comparator
    }

    // ─── Public API ───────────────────────────────

    get size() { return this.#data.length }
    get isEmpty() { return this.#data.length === 0 }

    /** O(1) — peek at best item without removing */
    peek() { return this.#data[0] ?? null }

    /** O(log n) — insert new item */
    insert(item) {
        this.#data.push(item)
        this.#bubbleUp(this.#data.length - 1)
    }

    /** O(log n) — remove and return the best item */
    extractTop() {
        if (this.isEmpty) return null
        const top = this.#data[0]
        const last = this.#data.pop()
        if (this.#data.length > 0) {
            this.#data[0] = last
            this.#bubbleDown(0)
        }
        return top
    }

    /** O(n) — remove a specific item by id */
    removeById(id) {
        const idx = this.#data.findIndex(o => o.id === id)
        if (idx === -1) return null

        const removed = this.#data[idx]
        const last = this.#data.pop()

        if (idx < this.#data.length) {
            this.#data[idx] = last
            this.#bubbleUp(idx)
            this.#bubbleDown(idx)
        }
        return removed
    }

    /** Update quantity of an existing order in place — O(1) */
    updateQuantity(id, newQuantity) {
        const item = this.#data.find(o => o.id === id)
        if (item) item.quantity = newQuantity
    }

    /** Return a shallow copy of all items (for snapshots) */
    toArray() { return [...this.#data] }

    // ─── Private: Heap mechanics ──────────────────

    #bubbleUp(idx) {
        while (idx > 0) {
            const parentIdx = Math.floor((idx - 1) / 2)
            // If current item has higher priority than parent → swap
            if (this.#comparator(this.#data[idx], this.#data[parentIdx]) < 0) {
                this.#swap(idx, parentIdx)
                idx = parentIdx
            } else break
        }
    }

    #bubbleDown(idx) {
        const length = this.#data.length
        while (true) {
            let best = idx
            const left = 2 * idx + 1
            const right = 2 * idx + 2

            if (left < length && this.#comparator(this.#data[left], this.#data[best]) < 0) best = left
            if (right < length && this.#comparator(this.#data[right], this.#data[best]) < 0) best = right

            if (best !== idx) {
                this.#swap(idx, best)
                idx = best
            } else break
        }
    }

    #swap(i, j) {
        ;[this.#data[i], this.#data[j]] = [this.#data[j], this.#data[i]]
    }
}

// ─────────────────────────────────────────────────────────────
// MaxHeap for BIDS — highest price on top
// Same price → earliest timestamp wins (FIFO / time priority)
// ─────────────────────────────────────────────────────────────
class BidHeap extends Heap {
    constructor() {
        super((a, b) => {
            if (b.price !== a.price) return b.price - a.price      // higher price first
            return a.timestamp - b.timestamp                        // earlier time first
        })
    }
}

// ─────────────────────────────────────────────────────────────
// MinHeap for ASKS — lowest price on top
// Same price → earliest timestamp wins (FIFO / time priority)
// ─────────────────────────────────────────────────────────────
class AskHeap extends Heap {
    constructor() {
        super((a, b) => {
            if (a.price !== b.price) return a.price - b.price      // lower price first
            return a.timestamp - b.timestamp                        // earlier time first
        })
    }
}

module.exports = { BidHeap, AskHeap }