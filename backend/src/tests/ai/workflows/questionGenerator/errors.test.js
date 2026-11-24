import { describe, it, expect } from "vitest";
import { AIConfigError, AIProviderError, AIInvalidResponseError } from "../../../../ai/workflows/questionGenerator/errors.js";

describe("question generator error types", () => {
  it("are distinct Error subclasses", () => {
    expect(new AIConfigError("x")).toBeInstanceOf(Error);
    expect(new AIProviderError("x")).toBeInstanceOf(Error);
    expect(new AIInvalidResponseError("x")).toBeInstanceOf(Error);
    expect(new AIConfigError("x")).not.toBeInstanceOf(AIProviderError);
  });
});
