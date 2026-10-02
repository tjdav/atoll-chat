/**
 * Represents a normalized API error returned by the server or client transport.
 */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code (e.g. 400, 404, 500)
   * @param {string} code Error code string (e.g. "invalid_credentials", "unknown")
   * @param {string} message Descriptive error message
   * @param {any} [details=null] Optional error details object or null
   */
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Creates an API client instance with normalized request/response handling per client spec §4.3 and §21.
 *
 * @param {Object} options
 * @param {string} options.baseUrl Base URL string (e.g. "https://example.com/api/v1")
 * @param {Function} [options.getAuthToken] Function returning a bearer token string or null/undefined
 * @param {typeof fetch} [options.fetchImpl=fetch] Custom fetch implementation for testing
 * @returns {Object} Client methods { get, post, del }
 */
export function createApiClient({ baseUrl, getAuthToken, fetchImpl = fetch }) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new TypeError('baseUrl must be a non-empty string');
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  /**
   * Helper to execute HTTP requests with headers, query string serialization, and error normalization.
   */
  async function request(method, path, { body, query, headers = {}, signal } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new TypeError('path must be a string starting with "/"');
    }

    let url = `${normalizedBaseUrl}${path}`;

    if (query && typeof query === 'object') {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const requestHeaders = { ...headers };

    if (body !== undefined && !('Content-Type' in requestHeaders) && !('content-type' in requestHeaders)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    if (typeof getAuthToken === 'function') {
      const token = await getAuthToken();
      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    const fetchOptions = {
      method,
      headers: requestHeaders,
      signal,
    };

    if (body !== undefined) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetchImpl(url, fetchOptions);

    if (response.status === 204) {
      return null;
    }

    const contentLength = response.headers?.get('content-length');
    if (contentLength === '0') {
      return null;
    }

    const contentType = response.headers?.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (response.ok) {
      if (isJson) {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }
      return await response.text();
    }

    let errorBody = null;
    let text = '';
    try {
      text = await response.text();
      if (text && isJson) {
        errorBody = JSON.parse(text);
      }
    } catch {
      errorBody = null;
    }

    if (errorBody && typeof errorBody === 'object' && 'error' in errorBody) {
      const code = typeof errorBody.error === 'string' ? errorBody.error : 'unknown';
      const message = errorBody.message || code;
      const details = errorBody.details ?? null;
      throw new ApiError(response.status, code, message, details);
    }

    const rawMessage = text || response.statusText || `HTTP ${response.status}`;
    throw new ApiError(response.status, 'unknown', rawMessage, null);
  }

  return {
    /**
     * Executes a GET request.
     * @param {string} path Path starting with "/"
     * @param {Object} [options] Request options { query, headers, signal }
     */
    get(path, options) {
      return request('GET', path, options);
    },

    /**
     * Executes a POST request.
     * @param {string} path Path starting with "/"
     * @param {Object} [options] Request options { body, headers, signal }
     */
    post(path, options) {
      return request('POST', path, options);
    },

    /**
     * Executes a DELETE request.
     * @param {string} path Path starting with "/"
     * @param {Object} [options] Request options { headers, signal }
     */
    del(path, options) {
      return request('DELETE', path, options);
    },
  };
}
