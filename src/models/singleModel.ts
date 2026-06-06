import { Mode } from "../enums/mode";
import { BaseModel } from "./baseModel";

export class SingleModel extends BaseModel {
  get mode(): Mode {
    return Mode.SINGLE;
  }
}
