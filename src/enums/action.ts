/** The possible actions for the /models command */
export enum Action {
  LOAD_AND_SWITCH = "Load & switch",
  SWITCH = "Switch model",
  LOAD = "Load only",
  UNLOAD = "Unload",
  RETRY = "Retry",
  INFO = "Info",
  CANCEL = "Cancel",
}
