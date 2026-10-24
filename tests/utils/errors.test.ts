import { describe, expect, it } from "vitest";
import { errorMessage } from "../../src/ui/notifyMessages";

describe("errorMessage", () => {
  it("returns the message from an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the stringified value for non-Error inputs", () => {
    expect(errorMessage("oops")).toBe("oops");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
