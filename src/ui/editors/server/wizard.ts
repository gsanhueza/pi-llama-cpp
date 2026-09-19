import type { LlamaServer } from "../../../interfaces/settings";
import type { DialogFactory } from "../../dialog/factory";
import type { InputDialog } from "../../dialog/input";
import { FieldMessages, TITLES } from "../../strings";
import { ServerFields, type ServerField } from "./fields";

/** Wizard step spec: which registry field this step prompts for, plus an
 * optional note override for the prompt. */
interface WizardStepSpec {
  def: ServerField;
  note?: string;
}

/**
 * State machine for the add-server wizard (URL → optional ID → optional name).
 *
 * The wizard state is just a growing `LlamaServer`: each step applies its
 * committed value through the field definition's `apply` (backed by
 * {@link LlamaServerBuilder}, so the unset-on-empty rule for `id`/`name`
 * is shared with field edits).
 *
 * Usage:
 * ```ts
 * const wizard = new ServerWizard(dialogs);
 * wizard.start(onComplete, onCancel);
 * wizard.next(value);  // advances through the steps
 * wizard.cancel();
 * ```
 */
export class ServerWizard {
  /**
   * Ordered pipeline of wizard steps: URL (required, validated) → optional
   * ID → optional name. Steps reference the shared `ServerFields` registry
   * — the single source of truth for each field's label, placeholder,
   * validator and apply logic — so the wizard can't drift from field edits
   * on existing servers.
   */
  private static readonly STEPS: WizardStepSpec[] = [
    { def: ServerFields.byId("url") },
    { def: ServerFields.byId("id"), note: "(optional)" },
    { def: ServerFields.byId("name"), note: "(optional)" },
  ];

  private server: LlamaServer = { url: "" };
  private stepIndex = 0;
  private dialog: InputDialog | null = null;
  private onComplete: ((server: LlamaServer) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(
    private readonly dialogs: DialogFactory,
    /** Called each time a step dialog is created — the containing editor
     * re-opens it via `openDialog` so input keeps flowing to the current
     * step. */
    private readonly onDialog: (dialog: InputDialog) => void,
  ) {}

  /** Start the wizard at the first step (URL). Focus is managed by the
   * caller (the containing editor's `openDialog`). */
  start(onComplete: (server: LlamaServer) => void, onCancel: () => void): void {
    this.onComplete = onComplete;
    this.onCancel = onCancel;
    this.server = { url: "" };
    this.stepIndex = 0;
    this.showStep();
  }

  /**
   * Commit the current step's value and advance. When the final step
   * completes, hands the built server to the completion callback.
   */
  next(value: string): void {
    const spec = ServerWizard.STEPS[this.stepIndex];
    if (!spec) return;

    this.server = spec.def.apply(this.server, value);
    this.stepIndex += 1;

    if (this.stepIndex >= ServerWizard.STEPS.length) {
      this.dialog = null;
      this.onComplete?.(this.server);
      return;
    }

    this.showStep();
    this.dialogs.requestRender();
  }

  /** Abort the wizard and call the cancel callback. */
  cancel(): void {
    this.dialog = null;
    this.stepIndex = 0;
    this.onCancel?.();
  }

  // -- internal helpers ------------------------------------------------------

  private showStep(): void {
    const spec = ServerWizard.STEPS[this.stepIndex];
    this.dialog = this.dialogs.input({
      title: TITLES.addServerStep((this.stepIndex + 1) as 1 | 2 | 3),
      message: FieldMessages.of(spec.def.field, spec.note),
      placeholder: spec.def.placeholder,
      validate: spec.def.validate,
      onSubmit: (v) => this.next(v),
      onCancel: () => this.cancel(),
    });
    this.onDialog(this.dialog);
  }
}
