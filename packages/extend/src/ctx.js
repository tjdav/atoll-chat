/**
 * Creates a fresh context (ctx) object for an extension invocation point.
 *
 * @param {object} options
 * @param {object} options.extension - Normalized extension object.
 * @param {object} [options.services] - Bag of backing service implementations.
 * @param {object} [options.invocation] - Invocation parameters.
 * @returns {object} Fresh ctx object.
 */
export function createCtx({ extension, services = {}, invocation = {} }) {
  if (!extension || typeof extension !== 'object' || !extension.id) {
    throw new Error('createCtx requires a valid extension object with an id')
  }

  const surface = invocation.surface ?? null
  const scope = invocation.scope ?? null
  const selection = invocation.selection ?? null
  const position = invocation.position ?? null

  return {
    id: extension.id,
    $state: services.$state ?? undefined,
    capabilities: services.capabilities ?? undefined,
    platform: services.platform ?? 'desktop',
    state: services.state ?? {},
    storage: wrapObjectService('storage', services, ['get', 'set', 'delete', 'clear']),
    preferences: wrapObjectService('preferences', services, ['get', 'set', 'delete', 'subscribe']),
    surface,
    scope,
    selection,
    position,
    navigate: requireService('navigate', services, 'router'),
    back: requireService('back', services, 'router'),
    present: requireService('present', services, 'router'),
    dismiss: requireService('dismiss', services, 'router'),
    toast: requireService('toast', services, 'toast'),
    notify: requireService('notify', services, 'notification'),
    openExternal: requireService('openExternal', services, 'external-link'),
    asset: requireService('asset', services, 'asset'),
    hasPermission: requireService('hasPermission', services, 'permission'),
    fetch: requireService('fetch', services, 'network'),
    fetchUserUrl: requireService('fetchUserUrl', services, 'network'),
    t: requireService('t', services, 'i18n')
  }
}

function requireService(name, services, pluginName) {
  return (...args) => {
    const impl = services[name]
    if (typeof impl !== 'function') {
      const pluginText = pluginName ? `The ${pluginName} plugin` : 'The plugin that provides it'
      throw new Error(`ctx.${name} is not available. ${pluginText} is not registered.`)
    }
    return impl(...args)
  }
}

function wrapObjectService(name, services, methods) {
  const impl = services[name]
  const wrapped = {}
  for (const method of methods) {
    wrapped[method] = (...args) => {
      if (!impl || typeof impl[method] !== 'function') {
        throw new Error(`ctx.${name}.${method} is not available.`)
      }
      return impl[method](...args)
    }
  }
  return wrapped
}
