import type { ExtensionEvent } from "@earendil-works/pi-coding-agent";

/**
 * pi-coding-agent does not re-export its `ModelSelectEvent` from the public
 * API (it exists in the internal extensions/index but is omitted from the
 * root re-export list, and the package's `exports` map blocks deep imports).
 * It is therefore derived from the exported `ExtensionEvent` union, which
 * yields pi's real event shape (`model: Model<any>`, `previousModel`,
 * `source`) and tracks the API automatically.
 */
export type ModelSelectEvent = Extract<
  ExtensionEvent,
  { type: "model_select" }
>;