import { createPlugin } from 'coralite'
export default createPlugin({
  name: 'tts-plugin',
  client: {
    imports: [{
      specifier: 'https://esm.sh/onnxruntime-web@1.17.0',
      namedExports: ['env', 'InferenceSession', 'Tensor']
    }],
    helpers: {
      ttsGenerate: async globalContext => {
        const { env, InferenceSession, Tensor } = globalContext.imports
        env.wasm.wasmPaths = 'https://esm.sh/onnxruntime-web@1.17.0/dist/'
        let configurations = null
        let textProcessor = null
        let durationPredictorOrt = null
        let textEncoderOrt = null
        let vectorEstimatorOrt = null
        let vocoderOrt = null

        // Unicode Processor

        /**
         *
         */
        class UnicodeProcessor {
          constructor (indexer) {
            this.indexer = indexer
          }
          call (textList, langList) {
            const processedTexts = textList.map((text, i) => this.preprocessText(text, langList[i]))
            const textIdsLengths = processedTexts.map(text => text.length)
            const maximumLength = Math.max(...textIdsLengths)
            const textIds = processedTexts.map(text => {
              const row = new Array(maximumLength).fill(0)
              for (let j = 0; j < text.length; j++) {
                const codePoint = text.codePointAt(j)
                row[j] = codePoint < this.indexer.length ? this.indexer[codePoint] : -1
              }
              return row
            })
            const textMask = this.getTextMask(textIdsLengths)
            return {
              textIds,
              textMask
            }
          }
          preprocessText (text, lang) {
            text = text.normalize('NFKD')
            const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu
            text = text.replace(emojiPattern, '')
            const replacements = {
              '–': '-',
              '‑': '-',
              '—': '-',
              _: ' ',
              '\u201C': '"',
              '\u201D': '"',
              '\u2018': "'",
              '\u2019': "'",
              '´': "'",
              '`': "'",
              '[': ' ',
              ']': ' ',
              '|': ' ',
              '/': ' ',
              '#': ' ',
              '→': ' ',
              '←': ' '
            }
            for (const [k, v] of Object.entries(replacements)) {
              text = text.replaceAll(k, v)
            }
            text = text.replace(/[♥☆♡©\\]/g, '')
            const exprReplacements = {
              '@': ' at ',
              'e.g.,': 'for example, ',
              'i.e.,': 'that is, '
            }
            for (const [k, v] of Object.entries(exprReplacements)) {
              text = text.replaceAll(k, v)
            }
            text = text.replace(/ ,/g, ',')
            text = text.replace(/ \./g, '.')
            text = text.replace(/ !/g, '!')
            text = text.replace(/ \?/g, '?')
            text = text.replace(/ ;/g, ';')
            text = text.replace(/ :/g, ':')
            text = text.replace(/ '/g, "'")
            while (text.includes('""')) {
              text = text.replace('""', '"')
            }
            while (text.includes("''")) {
              text = text.replace("''", "'")
            }
            while (text.includes('``')) {
              text = text.replace('``', '`')
            }
            text = text.trim()
            if (text.length > 0 && !['.', '!', '?'].includes(text[text.length - 1])) {
              text += '.'
            }
            if (lang === 'en') {
              text = `<EN>${text}</EN>`
            } else if (lang === 'ko') {
              text = `<KO>${text}</KO>`
            } else if (lang === 'es') {
              text = `<ES>${text}</ES>`
            } else if (lang === 'pt') {
              text = `<PT>${text}</PT>`
            } else if (lang === 'fr') {
              text = `<FR>${text}</FR>`
            }
            return text
          }
          getTextMask (lengths) {
            const maximumLength = Math.max(...lengths)
            return lengths.map(length => {
              const row = new Array(maximumLength).fill(0)
              for (let j = 0; j < length; j++) {
                row[j] = 1
              }
              return row
            })
          }
        }

        // Chunking text

        function chunkText (text, maximumLength = 300) {
          const paragraphs = text.trim().split(/\n\s*\n+/).filter(p => p.trim())
          const chunks = []
          for (let paragraph of paragraphs) {
            paragraph = paragraph.trim()
            if (!paragraph) {
              continue
            }
            const sentences = paragraph.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/)
            let currentChunk = ''
            for (let sentence of sentences) {
              if (currentChunk.length + sentence.length + 1 <= maximumLength) {
                currentChunk += (currentChunk ? ' ' : '') + sentence
              } else {
                if (currentChunk) {
                  chunks.push(currentChunk.trim())
                }
                currentChunk = sentence
              }
            }
            if (currentChunk) {
              chunks.push(currentChunk.trim())
            }
          }
          return chunks
        }
        /**
         *
         */
        class TextToSpeech {
          constructor (configurations, textProcessor, durationPredictorOrt, textEncoderOrt, vectorEstimatorOrt, vocoderOrt) {
            this.cfgs = configurations
            this.textProcessor = textProcessor
            this.dpOrt = durationPredictorOrt
            this.textEncOrt = textEncoderOrt
            this.vectorEstOrt = vectorEstimatorOrt
            this.vocoderOrt = vocoderOrt
            this.sampleRate = configurations.ae.sample_rate
          }
          sampleNoisyLatent (duration, sampleRate, baseChunkSize, chunkCompress, latentDimension) {
            const batchSize = duration.length
            const maximumDuration = Math.max(...duration)
            const waveLengthMaximum = Math.floor(maximumDuration * sampleRate)
            const wavLengths = duration.map(d => Math.floor(d * sampleRate))
            const chunkSize = baseChunkSize * chunkCompress
            const latentLength = Math.floor(((waveLengthMaximum + chunkSize) - 1) / chunkSize)
            const latentDimensionValue = latentDimension * chunkCompress
            const noisyLatent = []
            for (let b = 0; b < batchSize; b++) {
              const batch = []
              for (let d = 0; d < latentDimensionValue; d++) {
                const row = []
                for (let t = 0; t < latentLength; t++) {
                  const uniformRandom1 = Math.max(0.0001, Math.random())
                  const uniformRandom2 = Math.random()
                  const value = Math.sqrt(-2.0 * Math.log(uniformRandom1)) * Math.cos(2.0 * Math.PI * uniformRandom2)
                  row.push(value)
                }
                batch.push(row)
              }
              noisyLatent.push(batch)
            }
            const latentLengths = wavLengths.map(length => Math.floor(((length + chunkSize) - 1) / chunkSize))
            const latentMask = this.lengthToMask(latentLengths, latentLength)
            for (let b = 0; b < batchSize; b++) {
              for (let d = 0; d < latentDimensionValue; d++) {
                for (let t = 0; t < latentLength; t++) {
                  noisyLatent[b][d][t] *= latentMask[b][0][t]
                }
              }
            }
            return {
              xt: noisyLatent,
              latentMask
            }
          }
          lengthToMask (lengths, maximumLength = null) {
            const actualMaxLen = maximumLength || Math.max(...lengths)
            return lengths.map(length => {
              const row = new Array(actualMaxLen).fill(0.0)
              for (let j = 0; j < Math.min(length, actualMaxLen); j++) {
                row[j] = 1.0
              }
              return [row]
            })
          }
          async _infer (textList, langList, style, totalStep, speed = 1.05) {
            const batchSize = textList.length
            const {
              textIds,
              textMask
            } = this.textProcessor.call(textList, langList)
            const textIdsFlat = new BigInt64Array(textIds.flat().map(x => BigInt(x)))
            const textIdsShape = [batchSize, textIds[0].length]
            const textIdsTensor = new Tensor('int64', textIdsFlat, textIdsShape)
            const textMaskFlat = new Float32Array(textMask.flat(2))
            const textMaskShape = [batchSize, 1, textMask[0][0].length]
            const textMaskTensor = new Tensor('float32', textMaskFlat, textMaskShape)

            // Style tensors
            let styleDurationPredictorTensor = style.style_dp
            let styleTextToLatentTensor = style.style_ttl

            if (batchSize > 1) {
              const styleDurationPredictorDimensions = style.style_dp.dims
              const styleDurationPredictorFlat = new Float32Array(batchSize * styleDurationPredictorDimensions[1] * styleDurationPredictorDimensions[2])
              const singleDpFlat = style.style_dp.data
              for (let i = 0; i < batchSize; i++) {
                styleDurationPredictorFlat.set(singleDpFlat, i * singleDpFlat.length)
              }
              styleDurationPredictorTensor = new Tensor('float32', styleDurationPredictorFlat, [batchSize, styleDurationPredictorDimensions[1], styleDurationPredictorDimensions[2]])

              const styleTextToLatentDimensions = style.style_ttl.dims
              const styleTextToLatentFlat = new Float32Array(batchSize * styleTextToLatentDimensions[1] * styleTextToLatentDimensions[2])
              const singleTtlFlat = style.style_ttl.data
              for (let i = 0; i < batchSize; i++) {
                styleTextToLatentFlat.set(singleTtlFlat, i * singleTtlFlat.length)
              }
              styleTextToLatentTensor = new Tensor('float32', styleTextToLatentFlat, [batchSize, styleTextToLatentDimensions[1], styleTextToLatentDimensions[2]])
            }

            const durationPredictorOutputs = await this.dpOrt.run({
              text_ids: textIdsTensor,
              style_dp: styleDurationPredictorTensor,
              text_mask: textMaskTensor
            })
            let durationData
            if (durationPredictorOutputs.duration.data instanceof Float32Array) {
              durationData = Array.from(durationPredictorOutputs.duration.data)
            } else if (durationPredictorOutputs.duration.data instanceof BigInt64Array) {
              durationData = Array.from(durationPredictorOutputs.duration.data).map(Number)
            } else {
              durationData = Array.from(durationPredictorOutputs.duration.data)
            }
            const duration = durationData
            for (let i = 0; i < duration.length; i++) {
              duration[i] /= speed
            }
            const textEncoderOutputs = await this.textEncOrt.run({
              text_ids: textIdsTensor,
              style_ttl: styleTextToLatentTensor,
              text_mask: textMaskTensor
            })
            const textEmbedding = textEncoderOutputs.text_emb
            let {
              xt: noisyLatent,
              latentMask
            } = this.sampleNoisyLatent(duration, this.sampleRate, this.cfgs.ae.base_chunk_size, this.cfgs.ttl.chunk_compress_factor, this.cfgs.ttl.latent_dim)
            const latentMaskFlat = new Float32Array(latentMask.flat(2))
            const latentMaskShape = [batchSize, 1, latentMask[0][0].length]
            const latentMaskTensor = new Tensor('float32', latentMaskFlat, latentMaskShape)
            const totalStepArray = new Float32Array(batchSize).fill(totalStep)
            const totalStepTensor = new Tensor('float32', totalStepArray, [batchSize])
            for (let step = 0; step < totalStep; step++) {
              const currentStepArray = new Float32Array(batchSize).fill(step)
              const currentStepTensor = new Tensor('float32', currentStepArray, [batchSize])
              const xtFlat = new Float32Array(noisyLatent.flat(2))
              const xtShape = [batchSize, noisyLatent[0].length, noisyLatent[0][0].length]
              const xtTensor = new Tensor('float32', xtFlat, xtShape)
              const vectorEstimatorOutputs = await this.vectorEstOrt.run({
                noisy_latent: xtTensor,
                text_emb: textEmbedding,
                style_ttl: styleTextToLatentTensor,
                latent_mask: latentMaskTensor,
                text_mask: textMaskTensor,
                current_step: currentStepTensor,
                total_step: totalStepTensor
              })
              const denoised = Array.from(vectorEstimatorOutputs.denoised_latent.data)
              const latentDimension = noisyLatent[0].length
              const latentLength = noisyLatent[0][0].length
              noisyLatent = []
              let index = 0
              for (let b = 0; b < batchSize; b++) {
                const batch = []
                for (let d = 0; d < latentDimension; d++) {
                  const row = []
                  for (let t = 0; t < latentLength; t++) {
                    row.push(denoised[index++])
                  }
                  batch.push(row)
                }
                noisyLatent.push(batch)
              }
            }
            const finalXtFlat = new Float32Array(noisyLatent.flat(2))
            const finalXtShape = [batchSize, noisyLatent[0].length, noisyLatent[0][0].length]
            const finalXtTensor = new Tensor('float32', finalXtFlat, finalXtShape)
            const vocoderOutputs = await this.vocoderOrt.run({
              latent: finalXtTensor
            })
            const wav = Array.from(vocoderOutputs.wav_tts.data)
            return {
              wav,
              duration
            }
          }
          async call (text, lang, style, totalStep, speed = 1.05, silenceDuration = 0.3) {
            const maximumLength = lang === 'ko' ? 120 : 300
            const textList = chunkText(text, maximumLength)
            const langList = new Array(textList.length).fill(lang)
            let waveConcatenated = []
            let durationConcatenated = 0
            for (let i = 0; i < textList.length; i++) {
              const {
                wav,
                duration
              } = await this._infer([textList[i]], [langList[i]], style, totalStep, speed)
              if (waveConcatenated.length === 0) {
                waveConcatenated = wav
                durationConcatenated = duration[0]
              } else {
                const silenceLen = Math.floor(silenceDuration * this.sampleRate)
                const silence = new Array(silenceLen).fill(0)
                waveConcatenated = [...waveConcatenated, ...silence, ...wav]
                durationConcatenated += duration[0] + silenceDuration
              }
            }
            return {
              wav: waveConcatenated,
              duration: [durationConcatenated]
            }
          }
        }
        const initTTS = async () => {
          if (durationPredictorOrt) {
            return
            // Already initialized
          }
          const basePath = '/assets/tts/onnx'
          const [indexerResponse, cfgsResponse] = await Promise.all([fetch(`${basePath}/unicode_indexer.json`), fetch(`${basePath}/tts.json`)])
          const indexer = await indexerResponse.json()
          configurations = await cfgsResponse.json()
          textProcessor = new UnicodeProcessor(indexer)
          const options = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
          }
          const modelPaths = [`${basePath}/duration_predictor.onnx`, `${basePath}/text_encoder.onnx`, `${basePath}/vector_estimator.onnx`, `${basePath}/vocoder.onnx`]
          const sessions = await Promise.all(modelPaths.map(async p => {
            const response = await fetch(p)
            const arrayBuffer = await response.arrayBuffer()
            return InferenceSession.create(new Uint8Array(arrayBuffer), options)
          }));
          [durationPredictorOrt, textEncoderOrt, vectorEstimatorOrt, vocoderOrt] = sessions
        }
        const loadVoiceStyle = async path => {
          const response = await fetch(path)
          const voiceStyle = await response.json()

          const ttlDims = voiceStyle.style_ttl.dims
          const dpDims = voiceStyle.style_dp.dims

          const ttlFlat = new Float32Array(voiceStyle.style_ttl.data.flat(Infinity))
          const dpFlat = new Float32Array(voiceStyle.style_dp.data.flat(Infinity))

          const ttlTensor = new Tensor('float32', ttlFlat, [1, ttlDims[1], ttlDims[2]])
          const dpTensor = new Tensor('float32', dpFlat, [1, dpDims[1], dpDims[2]])

          return {
            style_ttl: ttlTensor,
            style_dp: dpTensor
          }
        }
        const writeWavBlob = (audioData, sampleRate) => {
          const numChannels = 1
          const bitsPerSample = 16
          const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
          const blockAlign = (numChannels * bitsPerSample) / 8
          const dataSize = audioData.length * 2
          const buffer = new ArrayBuffer(44 + dataSize)
          const view = new DataView(buffer)
          const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
              view.setUint8(offset + i, string.charCodeAt(i))
            }
          }
          writeString(0, 'RIFF')
          view.setUint32(4, 36 + dataSize, true)
          writeString(8, 'WAVE')
          writeString(12, 'fmt ')
          view.setUint32(16, 16, true)
          view.setUint16(20, 1, true)
          view.setUint16(22, numChannels, true)
          view.setUint32(24, sampleRate, true)
          view.setUint32(28, byteRate, true)
          view.setUint16(32, blockAlign, true)
          view.setUint16(34, bitsPerSample, true)
          writeString(36, 'data')
          view.setUint32(40, dataSize, true)
          const int16Data = new Int16Array(audioData.length)
          for (let i = 0; i < audioData.length; i++) {
            const clamped = Math.max(-1.0, Math.min(1.0, audioData[i]))
            int16Data[i] = Math.floor(clamped * 32767)
          }
          const dataView = new Uint8Array(buffer, 44)
          dataView.set(new Uint8Array(int16Data.buffer))
          return new Blob([buffer], {
            type: 'audio/wav'
          })
        }
        let defaultStyle = null
        return localContext => async (text, lang = 'en') => {
          await initTTS()
          if (!defaultStyle) {
            defaultStyle = await loadVoiceStyle('/assets/tts/voice_styles/M1.json')
          }
          const tts = new TextToSpeech(configurations, textProcessor, durationPredictorOrt, textEncoderOrt, vectorEstimatorOrt, vocoderOrt)
          const {
            wav
          } = await tts.call(text, lang, defaultStyle, 5, 1.05)
          return writeWavBlob(wav, configurations.ae.sample_rate)
        }
      }
    }
  }
})
