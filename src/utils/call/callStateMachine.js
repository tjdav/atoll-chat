/**
 * Centralized Finite State Machine (FSM) for WebRTC Call Lifecycle.
 * Enforces strict, deterministic state transitions and prevents invalid call states.
 */

export const CALL_STATES = Object.freeze({
  IDLE: 'idle',
  OUTGOING: 'outgoing',
  INCOMING: 'incoming',
  CONNECTED: 'connected'
})

const VALID_TRANSITIONS = Object.freeze({
  [CALL_STATES.IDLE]: [CALL_STATES.OUTGOING, CALL_STATES.INCOMING],
  [CALL_STATES.OUTGOING]: [CALL_STATES.CONNECTED, CALL_STATES.IDLE],
  [CALL_STATES.INCOMING]: [CALL_STATES.CONNECTED, CALL_STATES.IDLE],
  [CALL_STATES.CONNECTED]: [CALL_STATES.IDLE]
})

/**
 * Validates whether a transition from `fromState` to `toState` is permitted.
 *
 * @param {string} fromState - The current state.
 * @param {string} toState - The requested target state.
 * @returns {boolean} True if transition is valid, false otherwise.
 */
export const isValidTransition = (fromState, toState) => {
  if (fromState === toState) {
    return true
  }
  const allowed = VALID_TRANSITIONS[fromState]
  return Array.isArray(allowed) && allowed.includes(toState)
}

/**
 * Creates an instance of the WebRTC Call Finite State Machine.
 *
 * @param {Object} [options={}] - Options object.
 * @param {string} [options.initialState=CALL_STATES.IDLE] - Initial state.
 * @param {Function} [options.onTransition] - Global callback invoked on state transition.
 * @returns {Object} State machine interface.
 */
export const createCallStateMachine = ({
  initialState = CALL_STATES.IDLE,
  onTransition
} = {}) => {
  let currentState = Object.values(CALL_STATES).includes(initialState)
    ? initialState
    : CALL_STATES.IDLE

  const listeners = new Set()

  return {
    /**
     * Gets the current call state.
     * @returns {string}
     */
    getState: () => currentState,

    /**
     * Checks if current state matches target state.
     * @param {string} state
     * @returns {boolean}
     */
    is: (state) => currentState === state,

    /**
     * Checks if transitioning from current state to target state is valid.
     * @param {string} targetState
     * @returns {boolean}
     */
    canTransitionTo: (targetState) => isValidTransition(currentState, targetState),

    /**
     * Transitions state machine to target state if transition is valid.
     *
     * @param {string} targetState - Target state to transition into.
     * @param {Object} [context={}] - Optional metadata context for the transition.
     * @returns {string} The new state string.
     * @throws {Error} Throws if transition is illegal.
     */
    transition: (targetState, context = {}) => {
      if (!isValidTransition(currentState, targetState)) {
        throw new Error(`Invalid call state transition from "${currentState}" to "${targetState}"`)
      }

      if (currentState === targetState) {
        return currentState
      }

      const prevState = currentState
      currentState = targetState

      if (typeof onTransition === 'function') {
        try {
          onTransition(currentState, prevState, context)
        } catch (err) {
          console.error('[call-state-machine] Transition callback error:', err)
        }
      }

      listeners.forEach((listener) => {
        try {
          listener(currentState, prevState, context)
        } catch (err) {
          console.error('[call-state-machine] Subscriber listener error:', err)
        }
      })

      return currentState
    },

    /**
     * Resets state machine back to IDLE cleanly.
     *
     * @param {Object} [context={}] - Optional metadata context.
     * @returns {string} State string after reset ('idle').
     */
    reset: (context = {}) => {
      if (currentState === CALL_STATES.IDLE) {
        return CALL_STATES.IDLE
      }

      const prevState = currentState
      currentState = CALL_STATES.IDLE

      if (typeof onTransition === 'function') {
        try {
          onTransition(currentState, prevState, context)
        } catch (err) {
          console.error('[call-state-machine] Reset callback error:', err)
        }
      }

      listeners.forEach((listener) => {
        try {
          listener(currentState, prevState, context)
        } catch (err) {
          console.error('[call-state-machine] Reset listener error:', err)
        }
      })

      return currentState
    },

    /**
     * Subscribes a listener function to state transitions.
     *
     * @param {Function} listener - Function receiving (newState, prevState, context).
     * @returns {Function} Unsubscribe function.
     */
    subscribe: (listener) => {
      if (typeof listener === 'function') {
        listeners.add(listener)
      }
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
