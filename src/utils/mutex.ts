/**
 * Ensures only one in-flight operation exists per key.
 * Concurrent callers for the same key share the same promise.
 */
export class Mutex {
  private promises = new Map<string, Promise<unknown>>();

  /**
   * Runs `fn` for the given key, or returns an existing in-flight promise.
   * Concurrent callers for the same key share the same promise.
   */
  getOrCreate<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.promises.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.promises.delete(key);
    });
    this.promises.set(key, promise);
    return promise;
  }
}
