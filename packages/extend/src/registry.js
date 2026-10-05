/**
 * Registry for managing normalized extension definitions.
 */
export class ExtensionRegistry {
  #extensions = new Map()

  /**
   * Registers a normalized extension.
   *
   * @param {object} extension
   */
  add(extension) {
    if (!extension || !extension.id) {
      throw new Error('Cannot add extension without an id')
    }
    if (this.#extensions.has(extension.id)) {
      throw new Error(`Extension with id '${extension.id}' is already registered`)
    }
    this.#extensions.set(extension.id, extension)
  }

  /**
   * Retrieves an extension by ID.
   *
   * @param {string} id
   * @returns {object|undefined}
   */
  get(id) {
    return this.#extensions.get(id)
  }

  /**
   * Checks if an extension ID is registered.
   *
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.#extensions.has(id)
  }

  /**
   * Returns a frozen array of all registered extensions in registration order.
   *
   * @returns {readonly object[]}
   */
  list() {
    return Object.freeze(Array.from(this.#extensions.values()))
  }

  /**
   * Returns a frozen array of extensions declaring rail, sorted ascending by rail.order.
   *
   * @returns {readonly object[]}
   */
  byRailOrder() {
    const railExtensions = Array.from(this.#extensions.values())
      .filter((ext) => ext.rail !== null && ext.rail !== undefined)
      .sort((a, b) => (a.rail.order ?? 0) - (b.rail.order ?? 0))
    return Object.freeze(railExtensions)
  }

  /**
   * Returns the extension whose detail.route matches route.
   *
   * @param {string} route
   * @returns {object|undefined}
   */
  ownerOfRoute(route) {
    for (const ext of this.#extensions.values()) {
      if (ext.detail && ext.detail.route === route) {
        return ext
      }
    }
    return undefined
  }

  /**
   * Returns the number of registered extensions.
   *
   * @returns {number}
   */
  size() {
    return this.#extensions.size
  }
}
