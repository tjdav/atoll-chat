import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('video-grid Component - Call Waiting Spinner & Status Indicators', () => {
  let element
  let container

  const listeners = new Map()
  const subscribers = new Map()

  const stateProps = {
    callStatus: 'outgoing',
    activeCallRoomId: 'room-1',
    currentUser: {
      id: 'local-user',
      name: 'Local User',
      username: 'local'
    },
    isAudioEnabled: true,
    isVideoEnabled: true,
    remoteStream: null,
    localStream: null,
    isLocalSpeaking: false,
    isRemoteSpeaking: false,
    hasRemoteVideo: false,
    activeCallId: 'call-1'
  }

  const eventBusMock = {
    $bus: {
      on: (event, handler) => {
        if (!listeners.has(event)) {
          listeners.set(event, [])
        }
        listeners.get(event).push(handler)
      },
      emit: (event, payload) => {
        const list = listeners.get(event)
        if (list) {
          list.forEach(fn => fn(payload))
        }
      }
    }
  }

  const globalStoreMock = {
    $state: {
      ...stateProps,
      subscribe: (key, fn) => {
        if (!subscribers.has(key)) {
          subscribers.set(key, [])
        }
        subscribers.get(key).push(fn)
        fn(stateProps[key])
        return () => {
          const arr = subscribers.get(key)
          if (arr) {
            const idx = arr.indexOf(fn)
            if (idx !== -1) {
              arr.splice(idx, 1)
            }
          }
        }
      },
      set: (key, val) => {
        stateProps[key] = val
        globalStoreMock.$state[key] = val
        const arr = subscribers.get(key)
        if (arr) {
          arr.forEach(fn => fn(val))
        }
      }
    }
  }

  const storageMock = {
    $storage: {
      getRoom: async () => ({
        id: 'room-1',
        participants: [
          {
            id: 'local-user',
            name: 'Local User',
            username: 'local'
          },
          {
            id: 'remote-1',
            name: 'Remote Alice',
            username: 'alice'
          }
        ]
      })
    }
  }

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)

    stateProps.callStatus = 'outgoing'
    stateProps.activeCallRoomId = 'room-1'
    stateProps.remoteStream = null
    stateProps.localStream = null
    stateProps.isLocalSpeaking = false
    stateProps.isRemoteSpeaking = false
    stateProps.hasRemoteVideo = false
    stateProps.activeCallId = 'call-1'

    Object.assign(globalStoreMock.$state, stateProps)

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-profile')
    const tagName = await loadComponent('video-grid', {
      globalStore: globalStoreMock,
      eventBus: eventBusMock,
      storage: storageMock
    })

    element = document.createElement(tagName)
    container.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  it('renders waiting spinner ring and Calling... subtext for remote participant in outgoing state', async () => {
    const remoteTile = element.querySelector('[data-participant-id="remote-1"]') || element.querySelector('[data-participant-id="remote-user"]')
    assert.ok(remoteTile, 'Remote participant tile should exist in the grid')

    const spinnerWrapper = remoteTile.querySelector('.calling-spinner-wrapper')
    assert.ok(spinnerWrapper, 'Remote tile should render calling-spinner-wrapper')
    assert.equal(spinnerWrapper.classList.contains('d-none'), false, 'Spinner wrapper should be visible for remote user')

    const subtext = remoteTile.querySelector('.tile-status-subtext')
    assert.ok(subtext, 'Remote tile should render tile-status-subtext')
    assert.ok(subtext.textContent.includes('Calling…'), 'Subtext should display "Calling…"')

    const badge = remoteTile.querySelector('.participant-status-badge')
    assert.ok(badge, 'Remote tile should render participant-status-badge')
    assert.equal(badge.textContent.trim(), 'Calling…')
  })

  it('does not render waiting spinner for local participant tile', async () => {
    const localTile = element.querySelector('[data-participant-id="local-user"]')
    assert.ok(localTile, 'Local participant tile should exist')

    const spinnerWrapper = localTile.querySelector('.calling-spinner-wrapper')
    assert.ok(spinnerWrapper, 'Local tile should render calling-spinner-wrapper container')
    assert.equal(spinnerWrapper.classList.contains('d-none'), true, 'Spinner wrapper should be hidden for local participant')

    const subtext = localTile.querySelector('.tile-status-subtext')
    assert.equal(subtext, null, 'Local tile should not render status subtext')
  })

  it('hides waiting spinner and calling badge in-place when connected and answered', async () => {
    const fakeStream = Object.create(window.MediaStream ? window.MediaStream.prototype : {})
    fakeStream.getAudioTracks = () => [{ enabled: true }]
    fakeStream.getVideoTracks = () => [{ enabled: true }]
    fakeStream.getTracks = () => []

    globalStoreMock.$state.set('callStatus', 'connected')
    globalStoreMock.$state.set('remoteStream', fakeStream)

    await new Promise(resolve => setTimeout(resolve, 100))

    const remoteTile = element.querySelector('[data-participant-id="remote-1"]') || element.querySelector('[data-participant-id="remote-user"]')
    assert.ok(remoteTile, 'Remote participant tile should exist')

    const spinnerWrapper = remoteTile.querySelector('.calling-spinner-wrapper')
    assert.ok(spinnerWrapper.classList.contains('d-none'), 'Spinner wrapper should be hidden when answered')

    const badge = remoteTile.querySelector('.participant-status-badge')
    if (badge) {
      assert.ok(badge.classList.contains('d-none'), 'Status badge should be hidden when answered')
    }
  })

  it('renders Declined status badge when call:participant_declined event is received', async () => {
    eventBusMock.$bus.emit('call:participant_declined', {
      participant_id: 'remote-1',
      reason: 'busy'
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    const remoteTile = element.querySelector('[data-participant-id="remote-1"]') || element.querySelector('[data-participant-id="remote-user"]')
    assert.ok(remoteTile, 'Remote participant tile should remain during decline grace period')

    const subtext = remoteTile.querySelector('.tile-status-subtext')
    assert.ok(subtext, 'Status subtext should exist')
    assert.ok(subtext.textContent.includes('Declined'), 'Status subtext should show "Declined"')

    const badge = remoteTile.querySelector('.participant-status-badge')
    assert.ok(badge, 'Status badge should exist')
    assert.equal(badge.textContent.trim(), 'Declined')
  })
})
