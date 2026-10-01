interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface Entry {
  task: () => Promise<void>;
  waiters: Waiter[];
  coalesceKey?: string;
}

interface QueueState {
  running: boolean;
  entries: Entry[];
}

/**
 * Serializes writes per key while allowing adjacent equivalent operations to
 * collapse into the newest task. A running task is never replaced; only work
 * that has not started yet can be coalesced.
 */
export class SessionWriteQueue {
  private readonly states = new Map<string, QueueState>();

  enqueue(taskKey: string, task: () => Promise<void>, coalesceKey?: string): Promise<void> {
    let state = this.states.get(taskKey);
    if (!state) {
      state = { running: false, entries: [] };
      this.states.set(taskKey, state);
    }

    return new Promise<void>((resolve, reject) => {
      const previous = state.entries[state.entries.length - 1];
      if (coalesceKey && previous?.coalesceKey === coalesceKey) {
        previous.task = task;
        previous.waiters.push({ resolve, reject });
      } else {
        state.entries.push({
          task,
          coalesceKey,
          waiters: [{ resolve, reject }],
        });
      }

      void this.run(taskKey, state);
    });
  }

  private async run(taskKey: string, state: QueueState): Promise<void> {
    if (state.running) return;
    state.running = true;

    while (state.entries.length > 0) {
      const entry = state.entries.shift()!;
      try {
        await entry.task();
        entry.waiters.forEach(({ resolve }) => resolve());
      } catch (error) {
        entry.waiters.forEach(({ reject }) => reject(error));
      }
    }

    state.running = false;
    if (state.entries.length === 0 && this.states.get(taskKey) === state) {
      this.states.delete(taskKey);
    }
  }
}
