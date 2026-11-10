// Lightweight typed event bus for decoupled system communication.
// Avoids circular dependencies: systems publish/subscribe instead of importing each other.

type Handler<T = any> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private queue: Array<{ type: string; payload: any }> = [];
  private listening = new Set<string>();

  on<T = any>(type: string, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler);
    this.listening.add(type);
    const self = this;
    return function off() {
      const s = self.handlers.get(type);
      if (s) {
        s.delete(handler as Handler);
        if (s.size === 0) self.handlers.delete(type);
      }
    };
  }

  emit<T = any>(type: string, payload?: T): void {
    const set = this.handlers.get(type);
    if (!set) return;
    // Iterate over a copy to tolerate handlers that unsubscribe mid-flight.
    for (const h of [...set]) {
      try {
        h(payload as T);
      } catch (err) {
        console.error(`EventBus handler for "${type}" threw:`, err);
      }
    }
  }

  /** Buffer events until a listener is registered (useful for async scene setup). */
  emitDeferred<T = any>(type: string, payload?: T): void {
    this.queue.push({ type, payload });
  }

  /** Deliver all buffered events to a listener registered for `type`. */
  flush(type: string): void {
    const remaining: Array<{ type: string; payload: any }> = [];
    for (const ev of this.queue) {
      if (ev.type === type && this.handlers.has(type)) {
        this.emit(ev.type, ev.payload);
      } else {
        remaining.push(ev);
      }
    }
    this.queue = remaining;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  clear(): void {
    this.handlers.clear();
    this.queue = [];
    this.listening.clear();
  }
}

export const gameBus = new EventBus();
