/**
 * Normalizes an extension object by applying default values.
 * Does not mutate the input extension object.
 *
 * @param {object} ext - Raw extension object.
 * @returns {object} Normalized extension object.
 */
export function normalizeExtension(ext) {
  if (!ext || typeof ext !== 'object') {
    return ext
  }

  const normalized = {
    ...ext,
    permissions: ext.permissions ? [...ext.permissions] : [],
    rail: ext.rail ? normalizeRail(ext.rail) : null,
    list: ext.list ? normalizeList(ext.list) : null,
    detail: normalizeDetail(ext.detail),
    slots: ext.slots ? [...ext.slots] : [],
    emits: ext.emits ? [...ext.emits] : [],
    publicEvents: ext.publicEvents ? [...ext.publicEvents] : [],
    listens: ext.listens ? [...ext.listens] : [],
    sessions: ext.sessions ? [...ext.sessions] : [],
    preferences: ext.preferences ? [...ext.preferences] : [],
    locales: ext.locales ?? null,
    assets: ext.assets ? [...ext.assets] : [],
    onRegister: typeof ext.onRegister === 'function' ? ext.onRegister : null,
    onActivate: typeof ext.onActivate === 'function' ? ext.onActivate : null,
    onDeactivate: typeof ext.onDeactivate === 'function' ? ext.onDeactivate : null
  }

  return normalized
}

function normalizeRail(rail) {
  if (!rail || typeof rail !== 'object') {
    return rail
  }
  return {
    ...rail,
    badge: rail.badge ?? null,
    mobile: {
      placement: 'more',
      ...(rail.mobile ?? {})
    },
    visible: typeof rail.visible === 'function' ? rail.visible : () => true
  }
}

function normalizeList(list) {
  if (!list || typeof list !== 'object') {
    return list
  }
  return {
    ...list,
    surfaces: list.surfaces ? [...list.surfaces] : ['panel'],
    defaultSurface: list.defaultSurface ?? 'panel',
    back: list.back ?? 'auto',
    actions: list.actions ? [...list.actions] : [],
    slots: list.slots ? { ...list.slots } : {},
    scope: list.scope ? { ...list.scope } : {},
    settings: list.settings ?? null,
    empty: list.empty ?? null,
    loading: list.loading ?? null,
    error: list.error ?? null
  }
}

function normalizeDetail(detail) {
  if (!detail || typeof detail !== 'object') {
    return detail
  }
  return {
    ...detail,
    surfaces: detail.surfaces ? [...detail.surfaces] : ['panel'],
    defaultSurface: detail.defaultSurface ?? 'panel',
    back: detail.back ?? 'auto',
    actions: detail.actions ? [...detail.actions] : [],
    slots: detail.slots ? { ...detail.slots } : {},
    scope: detail.scope ? { ...detail.scope } : {},
    settings: detail.settings ?? null,
    empty: detail.empty ?? null,
    loading: detail.loading ?? null,
    error: detail.error ?? null
  }
}
