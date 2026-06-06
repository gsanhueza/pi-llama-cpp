import { DEFAULT_CTX } from "../constants";
import { Mode } from "../enums/mode";
import { SingleModel } from "./singleModel";

export class LegacyModel extends SingleModel {
  get mode(): Mode {
    return Mode.LEGACY;
  }

  /**
   * Retrieves the context size when the user is running
   * a server that uses legacy models, such as ik_llama.cpp
   *
   * @returns The context size
   */
  async getContextSize(): Promise<number> {
    const props = await this.server.fetchModelProps(this.id);
    const models = await this.server.fetchModels();

    const { n_ctx } = props as unknown as { n_ctx: number };
    const { data } = models as unknown as {
      data: { max_model_len: number }[];
    };

    const [{ max_model_len }] = data;
    const contextSize = max_model_len === 0 ? n_ctx : max_model_len;

    return contextSize ?? DEFAULT_CTX;
  }
}
