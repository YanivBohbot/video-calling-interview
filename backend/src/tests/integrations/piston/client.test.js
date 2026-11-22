import { describe, it, expect, vi } from "vitest";
import { createPistonClient, CodeRunnerUnavailableError } from "../../../integrations/piston/client.js";

const fakeFetch = (status, body) => vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
const run = (fields) => ({ run: { stdout: "", stderr: "", output: "", code: 0, signal: null, ...fields } });

describe("Piston client", () => {
  it("posts the Piston language name and returns the run result", async () => {
    const fetch = fakeFetch(200, run({ stdout: "2\n", output: "2\n" }));
    const piston = createPistonClient({ baseUrl: "http://p:2000", fetch });
    expect(await piston.runCode({ language: "cpp", code: "int main(){}" })).toEqual({
      output: "2\n", stdout: "2\n", stderr: "", exitCode: 0, timedOut: false,
    });
    expect(fetch).toHaveBeenCalledWith("http://p:2000/api/v2/execute", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      language: "c++", version: "*", files: [{ content: "int main(){}" }], stdin: "",
    });
  });

  it("reports a compile error as output, not as a failure", async () => {
    const fetch = fakeFetch(200, {
      compile: { stdout: "", stderr: "error: x", output: "error: x", code: 1, signal: null },
      ...run({ code: null }),
    });
    expect(await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "java", code: "x" })).toMatchObject({
      output: "error: x", stderr: "error: x", exitCode: 1, timedOut: false,
    });
  });

  it("flags a run killed by Piston's time limit", async () => {
    const fetch = fakeFetch(200, run({ code: null, signal: "SIGKILL", status: "TO" }));
    expect(
      await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "python", code: "while True: pass" }),
    ).toMatchObject({ timedOut: true });
  });

  it("reports an output flood cut by Piston as truncated, not as a timeout", async () => {
    // Piston kills a run whose output exceeds its limit with SIGKILL too, but status "OL"/"EL".
    const fetch = fakeFetch(200, run({ stdout: "1 2", output: "1 2", code: null, signal: "SIGKILL", status: "OL" }));
    const result = await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "python", code: "" });
    expect(result.timedOut).toBe(false);
    expect(result.output.endsWith("[output truncated]")).toBe(true);
  });

  it("flags a compile step that timed out", async () => {
    const fetch = fakeFetch(200, {
      compile: { stdout: "", stderr: "", output: "", code: null, signal: "SIGKILL", status: "TO" },
    });
    expect(await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "java", code: "x" })).toMatchObject({
      timedOut: true,
    });
  });

  it("truncates output beyond 20000 characters", async () => {
    const big = "x".repeat(25000);
    const fetch = fakeFetch(200, run({ stdout: big, output: big }));
    const result = await createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "python", code: "" });
    expect(result.output.length).toBeLessThan(20100);
    expect(result.output.endsWith("[output truncated]")).toBe(true);
    expect(result.stdout.endsWith("[output truncated]")).toBe(true);
  });

  it("throws CodeRunnerUnavailableError when Piston is down or answers non-2xx", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      createPistonClient({ baseUrl: "http://p", fetch: down }).runCode({ language: "python", code: "" }),
    ).rejects.toBeInstanceOf(CodeRunnerUnavailableError);
    await expect(
      createPistonClient({ baseUrl: "http://p", fetch: fakeFetch(400, { message: "runtime unknown" }) }).runCode({
        language: "python",
        code: "",
      }),
    ).rejects.toBeInstanceOf(CodeRunnerUnavailableError);
  });

  it("rejects a language the editor does not offer", async () => {
    const fetch = vi.fn();
    await expect(
      createPistonClient({ baseUrl: "http://p", fetch }).runCode({ language: "ruby", code: "" }),
    ).rejects.toThrow(/unsupported language/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
