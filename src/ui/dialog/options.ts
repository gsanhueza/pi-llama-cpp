import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export interface ConfirmDialogOptions {
  theme: Theme;
  tui: TUI;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface InputDialogOptions {
  theme: Theme;
  tui: TUI;
  title: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  validate?: (raw: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}
