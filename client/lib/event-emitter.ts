export class EventEmitter {
  _events: Record<string, ((...args: unknown[]) => void)[]>;

  constructor() {
    this._events = {};
  }

  on(e: string, cb: (...args: unknown[]) => void): this {
    if (!this._events[e]) this._events[e] = [];
    this._events[e].push(cb);
    return this;
  }

  once(e: string, cb: (...args: unknown[]) => void): this {
    const w = (...args: unknown[]) => {
      this.removeListener(e, w);
      cb.apply(this, args);
    };
    (w as unknown as { _origFn: unknown })._origFn = cb;
    return this.on(e, w);
  }

  off(e: string, cb: (...args: unknown[]) => void): this {
    return this.removeListener(e, cb);
  }

  removeListener(e: string, cb: (...args: unknown[]) => void): this {
    if (!this._events[e]) return this;
    this._events[e] = this._events[e].filter(
      (l) => l !== cb && (l as unknown as { _origFn: unknown })._origFn !== cb,
    );
    return this;
  }

  removeAllListeners(e?: string): this {
    if (e) delete this._events[e];
    else this._events = {};
    return this;
  }

  emit(e: string, ...args: unknown[]): boolean {
    const listeners = (this._events[e] || []).slice();
    listeners.forEach((l) => l(...args));
    return listeners.length > 0;
  }

  listeners(e: string): ((...args: unknown[]) => void)[] {
    return (this._events[e] || []).slice();
  }

  listenerCount(e: string): number {
    return (this._events[e] || []).length;
  }

  eventNames(): string[] {
    return Object.keys(this._events);
  }
}

(EventEmitter as unknown as { EventEmitter: typeof EventEmitter }).EventEmitter = EventEmitter;
