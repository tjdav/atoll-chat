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

  const getAudioContext = () => {
    if (!audioCtx || audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass()
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch((err) => console.warn('[audioSpeakerDetector] Failed to resume AudioContext:', err))
    }
    return audioCtx
  }

  const attachStream = (stream, participantId = 'local') => {
    if (!stream || !stream.getAudioTracks || stream.getAudioTracks().length === 0) {
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

        const isAudioActive = stream.getAudioTracks().some(t => t.enabled && t.readyState === 'live')
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
      console.error('[audioSpeakerDetector] Error attaching stream:', err)
      return null
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
      monitor.source.disconnect()
    } catch {
      /* Safe ignore */
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
