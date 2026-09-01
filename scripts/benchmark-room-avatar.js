import { createRoomAvatar, getParsedAvatar } from '../src/utils/room-avatar.js'

const createMockRooms = () => Array.from({ length: 100 }, (_, i) => ({
  id: `room_${i}`,
  is_group: true,
  name: `Room ${i}`,
  avatar: JSON.stringify({
    media_id: `media_${i}`,
    key: 'dGVzdGtleTEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNA==',
    nonce: 'dGVzdG5vbmNlMTIzNDU2Nzg5MDEyMzQ='
  }),
  participants: [
    { id: 'user_1', name: 'User 1' },
    { id: 'user_2', name: 'User 2' }
  ]
}))

const ITERATIONS = 100000

// Test 1: Direct JSON.parse on every call (Uncached Baseline)
const roomsBaseline = createMockRooms()
for (let i = 0; i < 1000; i++) {
  JSON.parse(roomsBaseline[i % roomsBaseline.length].avatar)
}

const startUncached = performance.now()
for (let i = 0; i < ITERATIONS; i++) {
  const room = roomsBaseline[i % roomsBaseline.length]
  const avatarData = JSON.parse(room.avatar)
}
const endUncached = performance.now()
const uncachedTime = endUncached - startUncached
const uncachedOpsSec = (ITERATIONS / uncachedTime) * 1000

// Test 2: getParsedAvatar with WeakMap Caching
const roomsCached = createMockRooms()
for (let i = 0; i < 1000; i++) {
  getParsedAvatar(roomsCached[i % roomsCached.length])
}

const startCached = performance.now()
for (let i = 0; i < ITERATIONS; i++) {
  const room = roomsCached[i % roomsCached.length]
  const avatarData = getParsedAvatar(room)
}
const endCached = performance.now()
const cachedTime = endCached - startCached
const cachedOpsSec = (ITERATIONS / cachedTime) * 1000

// Test 3: Full createRoomAvatar call benchmark (with cached parsing)
for (let i = 0; i < 1000; i++) {
  createRoomAvatar(roomsCached[i % roomsCached.length])
}
const startFull = performance.now()
for (let i = 0; i < ITERATIONS; i++) {
  createRoomAvatar(roomsCached[i % roomsCached.length])
}
const endFull = performance.now()
const fullTime = endFull - startFull
const fullOpsSec = (ITERATIONS / fullTime) * 1000

const speedupFactor = (uncachedTime / cachedTime).toFixed(2)

console.log(`=== Avatar Parsing Performance Benchmark (${ITERATIONS.toLocaleString()} iterations) ===\n`)
console.log(`1. Uncached JSON.parse Parsing:`)
console.log(`   - Time: ${uncachedTime.toFixed(2)} ms`)
console.log(`   - Ops/sec: ${uncachedOpsSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`)
console.log(`\n2. WeakMap Cached getParsedAvatar:`)
console.log(`   - Time: ${cachedTime.toFixed(2)} ms`)
console.log(`   - Ops/sec: ${cachedOpsSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`)
console.log(`\n3. Full createRoomAvatar (with cached parsing):`)
console.log(`   - Time: ${fullTime.toFixed(2)} ms`)
console.log(`   - Ops/sec: ${fullOpsSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} ops/sec`)
console.log(`\n🚀 Speedup Factor for Avatar Parsing: ${speedupFactor}x faster!`)
