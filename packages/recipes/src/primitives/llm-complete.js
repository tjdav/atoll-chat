// SPDX-License-Identifier: AGPL-3.0-or-later

import { substitute } from '../lib/substitute.js'

const VALID_MODES = ['saas', 'local']
const VALID_RESPONSE_FORMATS = ['text', 'json']

/**
 * Extracts the assistant content string from an OpenAI-compatible
 * chat completion response.
 * @param {unknown} body - The parsed response body.
 * @returns {string} The content string.
 * @throws {Error} When the shape is not recognized.
 */
function extractContent (body) {
  if (body === null || typeof body !== 'object') {
    throw new Error('llm-complete: response is not an object')
  }
  const choices = body.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('llm-complete: response has no choices')
  }
  const first = choices[0]
  if (first === null || typeof first !== 'object') {
    throw new Error('llm-complete: response choice is not an object')
  }
  const message = first.message
  if (message === null || typeof message !== 'object') {
    throw new Error('llm-complete: response has no message')
  }
  const content = message.content
  if (typeof content !== 'string') {
    throw new Error('llm-complete: response content is not a string')
  }
  return content
}

/**
 * llm-complete sends a prompt to an OpenAI-compatible chat
 * completion endpoint and passes the model's response to children.
 *
 * The primitive is provider-agnostic. The endpoint decides which
 * model answers. In v1 only the 'saas' mode is implemented; 'local'
 * throws at create time.
 * @type {Primitive}
 */
export const llmComplete = {
  id: 'llm-complete',
  targets: ['bot'],
  capabilities: [],
  label: 'LLM Complete',
  description: 'Sends a templated prompt to an LLM and passes the response to children.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['saas', 'local'], default: 'saas' },
      baseUrl: { type: 'string', minLength: 1 },
      model: { type: 'string', minLength: 1 },
      systemPrompt: { type: 'string' },
      userPrompt: { type: 'string', minLength: 1 },
      responseFormat: { type: 'string', enum: ['text', 'json'], default: 'text' },
      temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.1 }
    },
    required: ['baseUrl', 'model', 'userPrompt'],
    additionalProperties: false
  },
  create: (config, children) => {
    const mode = config.mode === undefined ? 'saas' : config.mode
    const baseUrl = config.baseUrl
    const model = config.model
    const systemPrompt = config.systemPrompt
    const userPrompt = config.userPrompt
    const responseFormat = config.responseFormat === undefined ? 'text' : config.responseFormat
    const temperature = config.temperature === undefined ? 0.1 : config.temperature

    if (!VALID_MODES.includes(mode)) {
      throw new Error('llm-complete: config.mode must be one of saas, local')
    }
    if (mode === 'local') {
      throw new Error('llm-complete: config.mode "local" is not implemented in v1')
    }
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      throw new Error('llm-complete: config.baseUrl is required')
    }
    if (typeof model !== 'string' || model.length === 0) {
      throw new Error('llm-complete: config.model is required')
    }
    if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
      throw new Error('llm-complete: config.systemPrompt must be a string')
    }
    if (typeof userPrompt !== 'string' || userPrompt.length === 0) {
      throw new Error('llm-complete: config.userPrompt is required')
    }
    if (!VALID_RESPONSE_FORMATS.includes(responseFormat)) {
      throw new Error('llm-complete: config.responseFormat must be one of text, json')
    }
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 2) {
      throw new Error('llm-complete: config.temperature must be a number between 0 and 2')
    }
    if (!Array.isArray(children)) {
      throw new Error('llm-complete: children must be an array')
    }
    if (children.length === 0) {
      throw new Error('llm-complete: at least one child is required')
    }

    const hasSystem = systemPrompt !== undefined
    const useJsonFormat = responseFormat === 'json'

    return async (ctx, input) => {
      const resolvedUrl = substitute(baseUrl, input)
      if (typeof resolvedUrl !== 'string' || resolvedUrl.length === 0) {
        throw new Error('llm-complete: resolved baseUrl is empty')
      }

      const resolvedUserPrompt = substitute(userPrompt, input)
      if (typeof resolvedUserPrompt !== 'string' || resolvedUserPrompt.length === 0) {
        throw new Error('llm-complete: resolved userPrompt is empty')
      }

      const messages = []
      if (hasSystem) {
        const resolvedSystem = substitute(systemPrompt, input)
        if (typeof resolvedSystem !== 'string') {
          throw new Error('llm-complete: resolved systemPrompt is not a string')
        }
        messages.push({ role: 'system', content: resolvedSystem })
      }
      messages.push({ role: 'user', content: resolvedUserPrompt })

      const requestBody = {
        model,
        temperature,
        messages
      }
      if (useJsonFormat) {
        requestBody.response_format = { type: 'json_object' }
      }

      const response = await ctx.fetch(resolvedUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        throw new Error(
          `llm-complete: request failed with status ${response.status}`
        )
      }

      const raw = await response.text()
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        throw new Error(`llm-complete: response is not valid JSON: ${err.message}`)
      }

      const content = extractContent(parsed)

      let output
      if (useJsonFormat) {
        try {
          output = JSON.parse(content)
        } catch (err) {
          throw new Error(`llm-complete: response content is not valid JSON: ${err.message}`)
        }
      } else {
        output = content
      }

      for (const child of children) {
        await child(ctx, output)
      }
    }
  }
}
