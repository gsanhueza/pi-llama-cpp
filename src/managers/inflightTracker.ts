import type { Model } from "../models/model";

/**
 * Tracks the model currently being loaded and its in-flight promise.
 *
 * Shared between `EventManager` (which reads/writes it) and the extension
 * init code (which checks it for session-switch warnings). A module-level
 * singleton keeps the bridge between the two managers explicit and typed,
 * avoiding private static fields on a class.
 */
export class InflightTracker {
  inflightModel: Model | null = null;
  inflightPromise: Promise<void> | null = null;

  /** Resets both fields to `null`. */
  reset(): void {
    this.inflightModel = null;
    this.inflightPromise = null;
  }

  /** Sets the in-flight model and its promise. */
  setInflight(model: Model, promise: Promise<void>): void {
    this.inflightModel = model;
    this.inflightPromise = promise;
  }
}
