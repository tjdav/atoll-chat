import test from 'node:test'
import assert from 'node:assert/strict'
import { createCallStateMachine, CALL_STATES, isValidTransition } from '../../src/utils/call/callStateMachine.js'

test('CallStateMachine - Initial state and pure helpers', async (t) => {
  await t.test('defaults to idle state', () => {
    const fsm = createCallStateMachine()
    assert.equal(fsm.getState(), 'idle')
    assert.equal(fsm.is('idle'), true)
    assert.equal(fsm.is('outgoing'), false)
  })

  await t.test('isValidTransition pure validator', () => {
    assert.equal(isValidTransition('idle', 'outgoing'), true)
    assert.equal(isValidTransition('idle', 'incoming'), true)
    assert.equal(isValidTransition('outgoing', 'connected'), true)
    assert.equal(isValidTransition('outgoing', 'idle'), true)
    assert.equal(isValidTransition('incoming', 'connected'), true)
    assert.equal(isValidTransition('incoming', 'idle'), true)
    assert.equal(isValidTransition('connected', 'idle'), true)

    // Illegal transitions
    assert.equal(isValidTransition('idle', 'connected'), false)
    assert.equal(isValidTransition('outgoing', 'incoming'), false)
    assert.equal(isValidTransition('incoming', 'outgoing'), false)
    assert.equal(isValidTransition('connected', 'outgoing'), false)
    assert.equal(isValidTransition('connected', 'incoming'), false)
  })
})

test('CallStateMachine - Valid state transitions and callbacks', async (t) => {
  await t.test('idle -> outgoing -> connected -> idle flow', () => {
    const transitions = []
    const fsm = createCallStateMachine({
      onTransition: (newState, prevState) => {
        transitions.push(`${prevState} -> ${newState}`)
      }
    })

    fsm.transition(CALL_STATES.OUTGOING)
    assert.equal(fsm.getState(), 'outgoing')

    fsm.transition(CALL_STATES.CONNECTED)
    assert.equal(fsm.getState(), 'connected')

    fsm.transition(CALL_STATES.IDLE)
    assert.equal(fsm.getState(), 'idle')

    assert.deepEqual(transitions, [
      'idle -> outgoing',
      'outgoing -> connected',
      'connected -> idle'
    ])
  })

  await t.test('idle -> incoming -> connected -> idle flow', () => {
    const fsm = createCallStateMachine()
    fsm.transition(CALL_STATES.INCOMING)
    assert.equal(fsm.getState(), 'incoming')

    fsm.transition(CALL_STATES.CONNECTED)
    assert.equal(fsm.getState(), 'connected')

    fsm.transition(CALL_STATES.IDLE)
    assert.equal(fsm.getState(), 'idle')
  })

  await t.test('cancelling or timing out before connecting', () => {
    const fsmOutgoing = createCallStateMachine()
    fsmOutgoing.transition(CALL_STATES.OUTGOING)
    fsmOutgoing.transition(CALL_STATES.IDLE)
    assert.equal(fsmOutgoing.getState(), 'idle')

    const fsmIncoming = createCallStateMachine()
    fsmIncoming.transition(CALL_STATES.INCOMING)
    fsmIncoming.transition(CALL_STATES.IDLE)
    assert.equal(fsmIncoming.getState(), 'idle')
  })

  await t.test('subscriptions receive state updates', () => {
    const fsm = createCallStateMachine()
    const received = []
    const unsubscribe = fsm.subscribe((newState, prevState, ctx) => {
      received.push({
        newState,
        prevState,
        ctx
      })
    })

    fsm.transition(CALL_STATES.OUTGOING, { reason: 'user_call' })
    assert.equal(received.length, 1)
    assert.deepEqual(received[0], {
      newState: 'outgoing',
      prevState: 'idle',
      ctx: { reason: 'user_call' }
    })

    unsubscribe()
    fsm.transition(CALL_STATES.CONNECTED)
    assert.equal(received.length, 1) // No new updates after unsubscribe
  })
})

test('CallStateMachine - Illegal transitions throw descriptive errors', async (t) => {
  await t.test('throws on idle -> connected', () => {
    const fsm = createCallStateMachine()
    assert.throws(
      () => fsm.transition(CALL_STATES.CONNECTED),
      /Invalid call state transition from "idle" to "connected"/
    )
    assert.equal(fsm.getState(), 'idle')
  })

  await t.test('throws on outgoing -> incoming', () => {
    const fsm = createCallStateMachine()
    fsm.transition(CALL_STATES.OUTGOING)
    assert.throws(
      () => fsm.transition(CALL_STATES.INCOMING),
      /Invalid call state transition from "outgoing" to "incoming"/
    )
    assert.equal(fsm.getState(), 'outgoing')
  })

  await t.test('reset() always returns state to IDLE cleanly', () => {
    const fsm = createCallStateMachine()
    fsm.transition(CALL_STATES.OUTGOING)
    assert.equal(fsm.getState(), 'outgoing')

    fsm.reset()
    assert.equal(fsm.getState(), 'idle')

    // Idempotent reset when already idle
    fsm.reset()
    assert.equal(fsm.getState(), 'idle')
  })
})
