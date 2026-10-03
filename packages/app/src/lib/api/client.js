import { createApiClient } from './index.js';
import { getSessionToken } from '../auth/session.js';

/**
 * Singleton API client instance configured with default base URL `/api/v1` and bearer auth token getter.
 */
export const api = createApiClient({
  baseUrl: '/api/v1',
  getAuthToken: () => getSessionToken(),
});
