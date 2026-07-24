/**
 * Manages call ringtone audio playback, custom sound blobs, and cleanup.
 */

let ringtoneAudio = null

export const stopRingtone = () => {
  if (ringtoneAudio) {
    ringtoneAudio.pause()
    ringtoneAudio.currentTime = 0
    if (ringtoneAudio.src && ringtoneAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(ringtoneAudio.src)
    }
    ringtoneAudio = null
  }
}

export const playRingtone = async ({ globalStore, $storage }) => {
  const $state = globalStore?.$state

  if (!$state || !$state.callSoundsEnabled || ringtoneAudio) {
    return
  }

  try {
    let audioSource = '/sounds/ringtone.mp3'
    if ($storage && typeof $storage.getConfig === 'function') {
      const customSound = await $storage.getConfig('custom_call_sound')
      if (customSound && customSound instanceof Blob) {
        audioSource = URL.createObjectURL(customSound)
      }
    }

    ringtoneAudio = new Audio(audioSource)
    ringtoneAudio.loop = true
    ringtoneAudio.volume = $state.mediaVolume || 1.0
    await ringtoneAudio.play()
  } catch (err) {
    console.error('[call-sound-manager] Failed to play ringtone:', err)
  }
}
