# P2P Order Book — Grenache DHT

A distributed P2P order book built with Grenache (Bitfinex's DHT microservice framework).
Each peer holds its own local order book. Orders are broadcast to all peers via the DHT.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Grape DHT Network                  │
│   grape:20001 ←──────────────────→ grape:20002     │
└───────────┬──────────────────────────────┬──────────┘
            │ DHT lookup & announce        │
     ┌──────▼──────┐               ┌──────▼──────┐
     │   Peer 1    │               │   Peer 2    │
     │  port:3001  │◄─── RPC ─────►│  port:3002  │
     │  ui:8081    │   (Grenache)   │  ui:8082    │
     │  OrderBook  │               │  OrderBook  │
     └─────────────┘               └─────────────┘
           ↕ SSE                         ↕ SSE
     Browser Tab 1               Browser Tab 2
```

### Flow: Submitting an Order

1. User submits order in browser → POST /order
2. Peer adds to **local** OrderBook (matching runs instantly)
3. Peer broadcasts the order via `peer.map()` to all peers on DHT
4. Each remote peer receives it, applies it to **their** local OrderBook
5. All browsers get a real-time SSE push with the updated book state

### Key Design Decisions

**Why does each peer have its own OrderBook copy?**
This is the P2P model. There's no central server. Every node is authoritative for orders it receives. Eventual consistency is achieved by broadcasting every order.

**Why `peer.map()` for broadcast?**
`peer.map()` sends to ALL peers announcing the service name on the DHT. `peer.request()` only picks ONE. For order broadcast we need everyone to get the message.

**Known Limitations (by design for this scope)**
- Race conditions: two peers submitting crossing orders simultaneously may result in duplicate matches. In production, a consensus mechanism (e.g. RAFT, sequence numbers) would solve this.
- No persistence: order book is in-memory only. On restart, state is lost.
- No order authentication: any peer can submit any order.

---

## Project Structure

```
p2p-orderbook/
├── config/
│   └── config.json          # Grape ports, peer ports, orderbook config
├── scripts/
│   └── start-grapes.js      # Spawns both Grape DHT nodes
├── src/
│   ├── core/
│   │   ├── enums.js          # OrderSide, OrderType, OrderStatus, OrderBookEvent
│   │   ├── Heap.js           # MinHeap, MaxHeap, BidHeap, AskHeap
│   │   └── OrderBook.js      # Core order book logic (pure, no network)
│   ├── network/
│   │   ├── GrenacheNode.js   # DHT connection, announce, broadcast, receive
│   │   └── Peer.js           # Top-level: combines OrderBook + Grenache + HTTP
│   └── ui/
│       └── index.html        # React UI (no build step needed)
└── tests/
    ├── Heap.test.js
    └── OrderBook.test.js
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install -g grenache-grape
npm install
```

### 2. Start the DHT network (Terminal 1)

```bash
npm run grapes
```

Wait for: `✅ Grapes running`

### 3. Start peers (separate terminals)

```bash
# Terminal 2
npm run peer:1

# Terminal 3
npm run peer:2

# Terminal 4
npm run peer:3
```

### 4. Open the UIs

Each peer has its own UI:

| Peer | UI URL |
|------|--------|
| peer_1 | http://localhost:8081 |
| peer_2 | http://localhost:8082 |
| peer_3 | http://localhost:8083 |

Open all three in different browser tabs. Submit a buy order in one, submit a matching sell in another — watch the trade execute across all three in real time.

---

## Run Tests

```bash
npm test
```

Tests use Node's built-in test runner (no jest/mocha needed).

---

## REST API (per peer)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | React UI |
| GET | `/state` | Full order book snapshot as JSON |
| POST | `/order` | Submit new order |
| DELETE | `/order/:id` | Cancel order by ID |
| GET | `/events` | SSE stream for real-time updates |

### POST /order body

```json
{
  "side": "buy",
  "type": "limit",
  "price": 50000,
  "quantity": 0.5
}
```

---

## Technology Choices

| Component | Choice | Why |
|-----------|--------|-----|
| P2P comms | `grenache-nodejs-http` | Required by Bitfinex challenge |
| DHT | Grenache Grape | Kademlia DHT, same as BitTorrent |
| Order book data structure | MinHeap/MaxHeap | O(log n) insert vs O(n log n) for sorted array |
| Real-time UI updates | Server-Sent Events (SSE) | Simpler than WebSocket for one-way push |
| UI | React (CDN, no build) | Fast to set up, no webpack needed |
| Tests | Node built-in `node:test` | Zero dependencies |


