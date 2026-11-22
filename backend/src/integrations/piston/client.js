// HTTP client for a self-hosted Piston (https://github.com/engineer-man/piston).
// No LangChain here: the REST API (POST /api/code/run) and the AI agents both get this
// client from container.js.

// The languages the code editor offers, mapped to Piston's names.
const PISTON_LANGUAGES = Object.freeze({
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  java: "java",
  cpp: "c++",
});
export const EDITOR_LANGUAGES = Object.freeze(Object.keys(PISTON_LANGUAGES));

const MAX_OUTPUT_CHARS = 20000;
const TRUNCATED = "\n[output truncated]";

// Piston is unreachable or refused the request: an outage, not a problem with the code.
export class CodeRunnerUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CodeRunnerUnavailableError";
  }
}

const cap = (text) => {
  const value = typeof text === "string" ? text : "";
  return value.length > MAX_OUTPUT_CHARS ? value.slice(0, MAX_OUTPUT_CHARS) + TRUNCATED : value;
};

export const createPistonClient = ({ baseUrl, fetch = globalThis.fetch, timeoutMs = 15000 }) => {
  const runCode = async ({ language, code, stdin = "" }) => {
    const pistonLanguage = PISTON_LANGUAGES[language];
    if (!pistonLanguage) throw new Error(`Unsupported language: ${language}`);

    let body;
    try {
      const res = await fetch(`${baseUrl}/api/v2/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: pistonLanguage, version: "*", files: [{ content: code }], stdin }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Piston answered ${res.status}`);
      body = await res.json();
    } catch (err) {
      throw new CodeRunnerUnavailableError("Code runner unavailable", { cause: err });
    }

    // A failed compile (Java, C++) is the result to show; the run step never happened.
    const step = body?.compile && body.compile.code !== 0 ? body.compile : body?.run;
    if (!step) throw new CodeRunnerUnavailableError("Code runner returned no result");
    // Piston kills a step with SIGKILL both when it runs too long (status "TO") and when its
    // stdout/stderr exceed the output limit ("OL" / "EL"); only the status tells them apart.
    // (No status: an older Piston — fall back to the signal.)
    const timedOut = step.status ? step.status === "TO" : step.signal === "SIGKILL";
    const mark = (text, flooded) => {
      const capped = cap(text);
      return flooded && !capped.endsWith(TRUNCATED) ? capped + TRUNCATED : capped;
    };
    const stdoutFlooded = step.status === "OL";
    const stderrFlooded = step.status === "EL";
    return {
      output: mark(step.output, stdoutFlooded || stderrFlooded),
      stdout: mark(step.stdout, stdoutFlooded),
      stderr: mark(step.stderr, stderrFlooded),
      exitCode: step.code ?? null,
      timedOut,
    };
  };

  return { runCode };
};
