import { beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_TIMEOUT } from "../src/constants";
import { SSEManager } from "../src/sse/manager";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SSEManager serverTimeout", () => {
  it("should use default timeout when not provided", () => {
    const manager = new SSEManager("http://127.0.0.1:8080", "");

    expect((manager as any).serverTimeout).toBe(SERVER_TIMEOUT);
  });

  it("should accept custom serverTimeout", () => {
    const manager = new SSEManager("http://127.0.0.1:8080", "", 3000);

    expect((manager as any).serverTimeout).toBe(3000);
  });
});
