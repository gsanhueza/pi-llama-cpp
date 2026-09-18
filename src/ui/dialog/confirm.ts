import { SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { BaseDialog } from "./base";
import type { ConfirmDialogOptions } from "./options";

/**
 * A framed confirmation dialog with a two-option `SelectList`
 * (Delete / Cancel), matching the confirm pattern of pi's `/llama` view.
 */
export class ConfirmDialog extends BaseDialog {
  private readonly list: SelectList;

  constructor(options: ConfirmDialogOptions) {
    super(options.theme, options.tui);

    this.list = new SelectList(
      [
        { value: "confirm", label: "Delete" },
        { value: "cancel", label: "Cancel" },
      ],
      2,
      this.selectListTheme(),
    );
    this.list.onSelect = (item) => {
      if (item.value === "confirm") options.onConfirm();
      else options.onCancel();
    };
    this.list.onCancel = () => options.onCancel();

    this.setFrame(
      options.title,
      [
        new Text(this.theme.fg("text", options.message), 1, 0),
        new Spacer(1),
        this.list,
      ],
      this.selectFooter(),
    );
  }

  // -- helpers -------------------------------------------------------------------

  protected get inputTarget() {
    return this.list;
  }
}
