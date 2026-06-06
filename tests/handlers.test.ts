import { describe, expect, it, vi } from "vitest";
import { Action } from "../src/enums/action";
import { Mode } from "../src/enums/mode";
import { Status } from "../src/enums/status";

const mockRpc = vi.fn();

vi.mock("../src/server", () => ({
  Server: vi.fn().mockImplementation(() => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    baseUrl: "http://127.0.0.1:8080",
    apiKey: undefined,
  })),
}));

class TestModel {
  constructor(
    private readonly _mode: Mode,
    private readonly _status: Status,
  ) {}

  get mode(): Mode {
    return this._mode;
  }

  get capabilities(): ["text"] | ["image"] {
    return ["text"];
  }

  async getStatus(): Promise<Status> {
    return this._status;
  }

  async getContextSize(): Promise<number> {
    return 4096;
  }
}

const createModel = (mode: Mode, status: Status) => new TestModel(mode, status);

/**
 * Replicates the getActionsForModel logic from commands/models.ts for testing
 * without needing the full Pi extension context.
 */
const getActionsForModel = async (model: TestModel): Promise<Array<Action>> => {
  const routerModeActions: Record<Status, Array<Action>> = {
    [Status.LOADED]: [Action.SWITCH, Action.UNLOAD, Action.INFO, Action.CANCEL],
    [Status.LOADING]: [Action.INFO, Action.CANCEL],
    [Status.FAILED]: [Action.RETRY, Action.CANCEL],
    [Status.SLEEPING]: [
      Action.SWITCH,
      Action.UNLOAD,
      Action.INFO,
      Action.CANCEL,
    ],
    [Status.UNLOADED]: [Action.LOAD, Action.CANCEL],
    [Status.UNAUTHORIZED]: [
      Action.SWITCH,
      Action.UNLOAD,
      Action.INFO,
      Action.CANCEL,
    ],
  };

  const singleModeActions: Record<Status, Array<Action>> = {
    [Status.LOADED]: [Action.INFO, Action.CANCEL],
    [Status.LOADING]: [Action.CANCEL],
    [Status.FAILED]: [Action.CANCEL],
    [Status.SLEEPING]: [Action.INFO, Action.CANCEL],
    [Status.UNLOADED]: [Action.CANCEL],
    [Status.UNAUTHORIZED]: [Action.INFO, Action.CANCEL],
  };

  const allActions =
    model.mode === Mode.ROUTER ? routerModeActions : singleModeActions;

  const status = await model.getStatus();
  return allActions[status];
};

describe("Action availability", () => {
  const actionMatrix: Array<{
    mode: Mode;
    status: Status;
    expected: Action[];
  }> = [
    // Router mode
    {
      mode: Mode.ROUTER,
      status: Status.LOADED,
      expected: [Action.SWITCH, Action.UNLOAD, Action.INFO, Action.CANCEL],
    },
    {
      mode: Mode.ROUTER,
      status: Status.LOADING,
      expected: [Action.INFO, Action.CANCEL],
    },
    {
      mode: Mode.ROUTER,
      status: Status.FAILED,
      expected: [Action.RETRY, Action.CANCEL],
    },
    {
      mode: Mode.ROUTER,
      status: Status.SLEEPING,
      expected: [Action.SWITCH, Action.UNLOAD, Action.INFO, Action.CANCEL],
    },
    {
      mode: Mode.ROUTER,
      status: Status.UNLOADED,
      expected: [Action.LOAD, Action.CANCEL],
    },
    {
      mode: Mode.ROUTER,
      status: Status.UNAUTHORIZED,
      expected: [
        Action.SWITCH,
        Action.UNLOAD,
        Action.INFO,
        Action.CANCEL,
      ],
    },
    // Single mode
    {
      mode: Mode.SINGLE,
      status: Status.LOADED,
      expected: [Action.INFO, Action.CANCEL],
    },
    { mode: Mode.SINGLE, status: Status.LOADING, expected: [Action.CANCEL] },
    { mode: Mode.SINGLE, status: Status.FAILED, expected: [Action.CANCEL] },
    {
      mode: Mode.SINGLE,
      status: Status.SLEEPING,
      expected: [Action.INFO, Action.CANCEL],
    },
    { mode: Mode.SINGLE, status: Status.UNLOADED, expected: [Action.CANCEL] },
    {
      mode: Mode.SINGLE,
      status: Status.UNAUTHORIZED,
      expected: [Action.INFO, Action.CANCEL],
    },
  ];

  it.each(actionMatrix)(
    "should return correct actions for $mode/$status",
    async ({ mode, status, expected }) => {
      const model = createModel(mode, status);
      const actions = await getActionsForModel(model);
      expect(actions).toEqual(expected);
    },
  );

  it("should always include CANCEL regardless of mode or status", async () => {
    for (const mode of [Mode.ROUTER, Mode.SINGLE]) {
      for (const status of Object.values(Status)) {
        const model = createModel(mode, status);
        const actions = await getActionsForModel(model);
        expect(actions).toContain(Action.CANCEL);
      }
    }
  });

  it("should not include mode-exclusive actions", async () => {
    const singleLoaded = createModel(Mode.SINGLE, Status.LOADED);
    expect(await getActionsForModel(singleLoaded)).not.toContain(Action.SWITCH);
    expect(await getActionsForModel(singleLoaded)).not.toContain(Action.LOAD);

    const singleFailed = createModel(Mode.SINGLE, Status.FAILED);
    expect(await getActionsForModel(singleFailed)).not.toContain(Action.RETRY);
  });
});
