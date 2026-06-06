/** The possible statuses of llama-server models */
export enum Status {
  LOADED = "loaded",
  LOADING = "loading",
  FAILED = "failed",
  SLEEPING = "sleeping",
  UNLOADED = "unloaded",
  UNAUTHORIZED = "unauthorized",
}
