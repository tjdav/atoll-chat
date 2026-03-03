import { createPlugin } from 'coralite';

export default createPlugin({
  name: 'event-bus-plugin',
  client: {
    setup() {
      const bus = new EventTarget();
      return { bus };
    },
    helpers: {
      emit: (context) => (eventName, detail = {}) => {
        const event = new CustomEvent(eventName, { detail });
        context.values.bus.dispatchEvent(event);
      },
      on: (context) => (eventName, callback) => {
        const handler = (e) => callback(e.detail);
        context.values.bus.addEventListener(eventName, handler);
        return () => context.values.bus.removeEventListener(eventName, handler);
      }
    }
  }
});