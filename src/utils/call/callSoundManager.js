/**
 * Manages call ringtone and ringback audio playback, custom sound blobs, and cleanup.
 */

let ringtoneAudio = null
let ringbackAudio = null
let isRingtonePlaying = false
let isRingbackPlaying = false
let currentRingtoneSessionId = 0
let currentRingbackSessionId = 0

/**
 * Stops incoming ringtone audio playback and cleans up active audio resources.
 */
export const stopRingtone = () => {
  isRingtonePlaying = false
  currentRingtoneSessionId++

  if (ringtoneAudio) {
    const audio = ringtoneAudio
    ringtoneAudio = null

    try {
      audio.pause()
      audio.currentTime = 0
    } catch {
      // Ignored: Teardown on unmounted element
    }

    if (audio.src && audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(audio.src)
    }
  }
}

/**
 * Stops outgoing ringback audio playback and cleans up active audio resources.
 */
export const stopRingback = () => {
  isRingbackPlaying = false
  currentRingbackSessionId++

  if (ringbackAudio) {
    const audio = ringbackAudio
    ringbackAudio = null

    try {
      audio.pause()
      audio.currentTime = 0
    } catch {
      // Ignored: Teardown on unmounted element
    }

    if (audio.src && audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(audio.src)
    }
  }
}

/**
 * Stops all active call audio playback (both ringtone and ringback).
 */
export const stopAll = () => {
  stopRingtone()
  stopRingback()
}

/**
 * Plays incoming call ringtone audio with support for custom sounds, volume sync, and graceful interruption handling.
 */
export const playRingtone = async ({ globalStore, $storage }) => {
  const $state = globalStore?.$state

  if (!$state || !$state.callSoundsEnabled || ringtoneAudio || isRingtonePlaying) {
    return
  }

  isRingtonePlaying = true
  const sessionId = ++currentRingtoneSessionId
  let audioSource = '/sounds/ringtone.mp3'

  try {
    if ($storage && typeof $storage.getConfig === 'function') {
      const customSound = await $storage.getConfig('custom_call_sound')
      if (!isRingtonePlaying || sessionId !== currentRingtoneSessionId) {
        return
      }
      if (customSound && customSound instanceof Blob) {
        audioSource = URL.createObjectURL(customSound)
      }
    }

    if (!isRingtonePlaying || sessionId !== currentRingtoneSessionId) {
      if (audioSource.startsWith('blob:')) {
        URL.revokeObjectURL(audioSource)
      }
      return
    }

    const audio = new Audio(audioSource)
    audio.loop = true
    audio.volume = $state.mediaVolume || 1.0
    ringtoneAudio = audio

    await audio.play()
  } catch (err) {
    isRingtonePlaying = false
    ringtoneAudio = null

    if (audioSource.startsWith('blob:')) {
      URL.revokeObjectURL(audioSource)
    }

    if (err instanceof Error) {
      const isExpectedMediaError =
        err.name === 'AbortError' ||
        err.name === 'NotAllowedError' ||
        err.message.includes('aborted') ||
        err.message.includes('interrupted') ||
        err.message.includes('user gesture')

      if (isExpectedMediaError) {
        return
      }
    }
    console.error('[call-sound-manager] Failed to play ringtone:', err)
  }
}

/**
 * Plays outgoing call ringback audio with support for custom sounds, volume sync, and graceful interruption handling.
 */
export const playRingback = async ({ globalStore, $storage }) => {
  const $state = globalStore?.$state

  if (!$state || !$state.callSoundsEnabled || ringbackAudio || isRingbackPlaying) {
    return
  }

  isRingbackPlaying = true
  const sessionId = ++currentRingbackSessionId
  let audioSource = '/sounds/ringtone.mp3'

  try {
    if ($storage && typeof $storage.getConfig === 'function') {
      const customSound = await $storage.getConfig('custom_call_sound')
      if (!isRingbackPlaying || sessionId !== currentRingbackSessionId) {
        return
      }
      if (customSound && customSound instanceof Blob) {
        audioSource = URL.createObjectURL(customSound)
      }
    }

    if (!isRingbackPlaying || sessionId !== currentRingbackSessionId) {
      if (audioSource.startsWith('blob:')) {
        URL.revokeObjectURL(audioSource)
      }
      return
    }

    const audio = new Audio(audioSource)
    audio.loop = true
    audio.volume = $state.mediaVolume || 1.0
    ringbackAudio = audio

    await audio.play()
  } catch (err) {
    isRingbackPlaying = false
    ringbackAudio = null

    if (audioSource.startsWith('blob:')) {
      URL.revokeObjectURL(audioSource)
    }

    if (err instanceof Error) {
      const isExpectedMediaError =
        err.name === 'AbortError' ||
        err.name === 'NotAllowedError' ||
        err.message.includes('aborted') ||
        err.message.includes('interrupted') ||
        err.message.includes('user gesture')

      if (isExpectedMediaError) {
        return
      }
    }
    console.error('[call-sound-manager] Failed to play ringback:', err)
  }
}
