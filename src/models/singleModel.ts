import { Mode } from "../enums/mode";
import { BaseModel } from "./baseModel";

export class SingleModel extends BaseModel {
  get mode(): Mode {
    return Mode.SINGLE;
  }

  async getCapabilities(): Promise<("text" | "image")[]> {
    const { models } = await this.server.fetchModels();
    const [model] = models!;

    const hasImage = model.capabilities.includes("multimodal");
    return hasImage ? ["text", "image"] : ["text"];
  }
}
