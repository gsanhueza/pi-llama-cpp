import type { Model } from "../models/model";

/**
 * Tracks models currently being loaded and their in-flight promises.
 *
 * Shared between `EventManager` (which reads/writes it) and the extension
 * init code (which checks it for session-switch warnings). A module-level
 * singleton keeps the bridge between the two managers explicit and typed,
 * avoiding private static fields on a class.
 *
 * `inflightModels` covers batch operations (e.g. `/models reload`).
 * `inflightModel` / `inflightPromise` cover the single-model path so
 * `autoLoadIfNeeded` can still await the right promise.
 */
export class InflightTracker {
  inflightModel: Model | null = null;
  inflightPromise: Promise<void> | null = null;
  readonly inflightModels = new Set<Model>();

  /** Resets all fields to their idle state. */
  reset(): void {
    this.inflightModel = null;
    this.inflightPromise = null;
    this.inflightModels.clear();
  }

  /** Sets the in-flight model and its promise. */
  setInflight(model: Model, promise: Promise<void>): void {
    this.inflightModel = model;
    this.inflightPromise = promise;
  }

  /** Adds a model to the batch inflight set. */
  add(model: Model): void {
    this.inflightModels.add(model);
  }

  /** Removes a model from the batch inflight set. */
  remove(model: Model): void {
    this.inflightModels.delete(model);
  }
}
