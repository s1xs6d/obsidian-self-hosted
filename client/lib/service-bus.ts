const _services = {};
const _listeners = {};

export const bus = {
  set(name, fn) {
    _services[name] = fn;
  },

  get(name) {
    return _services[name];
  },

  require(name) {
    const fn = _services[name];
    if (!fn) throw new Error(`Service '${name}' not registered`);
    return fn;
  },

  on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
    return () => {
      _listeners[event] = _listeners[event].filter((l) => l !== fn);
    };
  },

  off(event, fn) {
    if (_listeners[event]) _listeners[event] = _listeners[event].filter((l) => l !== fn);
  },

  emit(event, ...args) {
    const handlers = _listeners[event] || [];
    handlers.forEach((fn) => {
      try {
        fn(...args);
      } catch (_) {}
    });
  },
};
