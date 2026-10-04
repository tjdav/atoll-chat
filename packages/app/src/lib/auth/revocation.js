/**
 * Revocation handler class that acts as a sink for server-initiated revocation events
 * (e.g., session revocation, account disabling, or account deletion).
 */
export class RevocationHandler {
  /**
   * Constructs a RevocationHandler instance.
   *
   * @param {Object} options Configuration parameters
   * @param {Object} options.session Session storage module (must provide clearSession())
   * @param {Function} [options.navigate] Navigation function receiving a target URL string
   */
  constructor({ session, navigate }) {
    if (!session || typeof session.clearSession !== 'function') {
      throw new Error('RevocationHandler requires a session module with clearSession()');
    }
    this.session = session;
    this.navigate = navigate ?? ((url) => { window.location.href = url; });
  }

  /**
   * Handles incoming server events. If the event type indicates session revocation or account termination,
   * clears local session credentials and navigates to the login page.
   *
   * @param {string} eventType The incoming event type (e.g. "session.revoked", "account.disabled", "account.deleted")
   * @param {Object} [payload] Event payload object (accepted for future extension, unused)
   */
  handle(eventType, payload) {
    if (
      eventType === 'session.revoked' ||
      eventType === 'account.disabled' ||
      eventType === 'account.deleted'
    ) {
      this.session.clearSession();
      this.navigate('/index.html');
    }
  }
}
