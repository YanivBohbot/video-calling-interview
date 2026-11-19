import { describe, it, expect, vi } from "vitest";
import { createSocketAuthenticator } from "./authenticateSocket.js";

const run = async (resolver, auth) => {
  const socket = { handshake: { auth }, data: {} };
  const next = vi.fn();
  await createSocketAuthenticator(resolver)(socket, next);
  return { socket, err: next.mock.calls[0][0] };
};

describe("socket authenticator", () => {
  it("refuses a handshake without credentials", async () => {
    const resolver = { fromCredentials: vi.fn().mockResolvedValue(null) };
    const { err } = await run(resolver, {});
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Unauthorized");
  });

  it("attaches the principal for a valid bearer token", async () => {
    const principal = { kind: "demo", userId: "u-demo", clerkId: "demo" };
    const resolver = { fromCredentials: vi.fn().mockResolvedValue(principal) };
    const { socket, err } = await run(resolver, { token: "t" });
    expect(err).toBeUndefined();
    expect(socket.data.principal).toEqual(principal);
    expect(resolver.fromCredentials).toHaveBeenCalledWith({ bearer: "t", invite: undefined });
  });

  it("passes an invite secret through", async () => {
    const resolver = { fromCredentials: vi.fn().mockResolvedValue({ kind: "candidate", interviewId: "iv-1" }) };
    await run(resolver, { invite: "s3cret" });
    expect(resolver.fromCredentials).toHaveBeenCalledWith({ bearer: undefined, invite: "s3cret" });
  });

  it("refuses (without leaking details) when resolution fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resolver = { fromCredentials: vi.fn().mockRejectedValue(new Error("db down at 10.0.0.1")) };
    const { err } = await run(resolver, { token: "t" });
    expect(err.message).toBe("Unauthorized");
  });

  it("ignores non-string credentials", async () => {
    const resolver = { fromCredentials: vi.fn().mockResolvedValue(null) };
    await run(resolver, { token: { evil: true }, invite: 42 });
    expect(resolver.fromCredentials).toHaveBeenCalledWith({ bearer: undefined, invite: undefined });
  });
});
