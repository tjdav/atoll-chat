/**
 * Audio Speaker Detector utility using Web Audio API AnalyserNode.
 * Monitors local and remote MediaStreams for volume thresholds and hangover delays.
 */
export function createAudioSpeakerDetector ({
  threshold = 0.003,
  hangoverMs = 300,
  onSpeakingChange
} = {}) {
  let audioCtx = null
  const activeMonitors = new Map()

  const isExpectedAudioException = (err) => {
    if (!err) {
      return false
    }

    const name = err.name || ''
    return err instanceof DOMException ||
      name === 'InvalidStateError' ||
      name === 'NotSupportedError' ||
      name === 'InvalidAccessError' ||
      name === 'SecurityError'
  }

  const getAudioContext = () => {
    if (typeof window === 'undefined') {
      return null
    }
    if (!audioCtx || audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext
      if (AudioCtxClass) {
        try {
          audioCtx = new AudioCtxClass()
        } catch (err) {
          if (isExpectedAudioException(err)) {
            return null
          }
          throw err
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {
        // Safe return as resume is a secondary promise state operation and can fail closed
      })
    }
    return audioCtx
  }

  const attachStream = (stream, participantId = 'local') => {
    if (!stream || typeof stream.getAudioTracks !== 'function') {
      return null
    }
    const tracks = stream.getAudioTracks()
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return null
    }

    const streamId = stream.id || `stream_${participantId}`
    if (activeMonitors.has(streamId)) {
      detachStream(streamId)
    }

    const ctx = getAudioContext()
    if (!ctx) {
      return null
    }

    try {
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)

      const pcmData = new Float32Array(analyser.fftSize)
      const monitor = {
        streamId,
        participantId,
        stream,
        source,
        analyser,
        pcmData,
        isSpeaking: false,
        hangoverTimer: null,
        animFrameId: null
      }

      const sampleVolume = () => {
        if (!activeMonitors.has(streamId)) {
          return
        }

        analyser.getFloatTimeDomainData(pcmData)
        let sum = 0
        for (let i = 0; i < pcmData.length; i++) {
          sum += pcmData[i] * pcmData[i]
        }
        const rms = Math.sqrt(sum / pcmData.length)

        const currentTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : []
        const isAudioActive = Array.isArray(currentTracks) && currentTracks.some(t => t && t.enabled && t.readyState === 'live')
        const rawSpeaking = isAudioActive && rms >= threshold

        if (rawSpeaking) {
          if (monitor.hangoverTimer) {
            clearTimeout(monitor.hangoverTimer)
            monitor.hangoverTimer = null
          }

          if (!monitor.isSpeaking) {
            monitor.isSpeaking = true
            if (onSpeakingChange) {
              onSpeakingChange({
                isSpeaking: true,
                streamId,
                participantId,
                rms
              })
            }
          }
        } else if (monitor.isSpeaking && !monitor.hangoverTimer) {
          monitor.hangoverTimer = setTimeout(() => {
            monitor.isSpeaking = false
            monitor.hangoverTimer = null
            if (onSpeakingChange) {
              onSpeakingChange({
                isSpeaking: false,
                streamId,
                participantId,
                rms: 0
              })
            }
          }, hangoverMs)
        }

        monitor.animFrameId = requestAnimationFrame(sampleVolume)
      }

      activeMonitors.set(streamId, monitor)
      sampleVolume()
      return streamId
    } catch (err) {
      if (isExpectedAudioException(err)) {
        return null
      }
      throw err
    }
  }

  const detachStream = (streamId) => {
    if (!streamId || !activeMonitors.has(streamId)) {
      return
    }

    const monitor = activeMonitors.get(streamId)
    if (monitor.animFrameId) {
      cancelAnimationFrame(monitor.animFrameId)
    }

    if (monitor.hangoverTimer) {
      clearTimeout(monitor.hangoverTimer)
    }

    try {
      if (monitor.source && typeof monitor.source.disconnect === 'function') {
        monitor.source.disconnect()
      }
    } catch (err) {
      if (!isExpectedAudioException(err)) {
        throw err
      }
    }

    if (monitor.isSpeaking && onSpeakingChange) {
      onSpeakingChange({
        isSpeaking: false,
        streamId,
        participantId: monitor.participantId,
        rms: 0
      })
    }

    activeMonitors.delete(streamId)
  }

  const destroy = () => {
    activeMonitors.forEach((_, streamId) => detachStream(streamId))
    activeMonitors.clear()

    if (audioCtx) {
      audioCtx.close().catch(() => {
        // Safe return on teardown
      })
      audioCtx = null
    }
  }

  return {
    attachStream,
    detachStream,
    destroy,
    getAudioContext
  }
}
