/**
 * Manages call ringtone audio playback, custom sound blobs, and cleanup.
 */

let ringtoneAudio = null
let isPlaying = false
let currentSessionId = 0

/**
 * Stops ringtone audio playback and cleans up active audio resources.
 */
export const stopRingtone = () => {
  isPlaying = false
  currentSessionId++

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
 * Plays ringtone audio with support for custom sounds, volume sync, and graceful interruption handling.
 */
export const playRingtone = async ({ globalStore, $storage }) => {
  const $state = globalStore?.$state

  if (!$state || !$state.callSoundsEnabled || ringtoneAudio || isPlaying) {
    return
  }

  isPlaying = true
  const sessionId = ++currentSessionId
  let audioSource = '/sounds/ringtone.mp3'

  try {
    if ($storage && typeof $storage.getConfig === 'function') {
      const customSound = await $storage.getConfig('custom_call_sound')
      if (!isPlaying || sessionId !== currentSessionId) {
        return
      }
      if (customSound && customSound instanceof Blob) {
        audioSource = URL.createObjectURL(customSound)
      }
    }

    if (!isPlaying || sessionId !== currentSessionId) {
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
    isPlaying = false
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
