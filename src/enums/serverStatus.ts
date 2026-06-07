/** The possible states of a llama.cpp server */
export enum ServerStatus {
  READY = "ready",
  TIMEOUT = "timeout",
  UNREACHABLE = "unreachable",
}
