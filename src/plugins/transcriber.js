import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'transcribe-plugin',
  client: {
    imports: [
      {
        specifier: '@transcribe/transcriber',
        namedExports: ['FileTranscriber']
      }
    ],
    helpers: {
      transcribeAudio: (globalContext) => {
        const { FileTranscriber } = globalContext.imports

        let transcriberInstance = null
        let isInitializing = false

        const initTranscriber = async () => {
          if (transcriberInstance) {
            return transcriberInstance
          }

          if (isInitializing) {
            while (isInitializing) {
              await new Promise(r => setTimeout(r, 100))
            }
            return transcriberInstance
          }

          isInitializing = true
          try {
            // Dynamically import the WASM module we copied via staticAssetPlugin
            const shoutModule = await import('/assets/transcribe/shout.wasm.js')
            const createModule = shoutModule.default || shoutModule.createModule

            transcriberInstance = new FileTranscriber({
              createModule,
              model: '/assets/models/whisper/ggml-tiny-q5_1.bin'
            })
            await transcriberInstance.init()
          } finally {
            isInitializing = false
          }

          return transcriberInstance
        }

        return (localContext) => async (audioUrlOrBlob, lang = 'en') => {
          const transcriber = await initTranscriber()
          const result = await transcriber.transcribe(audioUrlOrBlob, { lang })

          // Combine the transcribed segments into a single string
          return result.transcription.map(t => t.text).join(' ').trim()
        }
      }
    }
  }
})
