import { describe, it, expect, vi, beforeEach } from "vitest";
import { createJoinRoomHandler } from "./handlers/joinRoom.js";
import { createCodeChangeHandler } from "./handlers/codeChange.js";
import { createLanguageChangeHandler } from "./handlers/languageChange.js";
import { createQuestionChangeHandler } from "./handlers/questionChange.js";
import { createCodeExecutionHandler } from "./handlers/codeExecution.js";
import { createDisconnectHandler } from "./handlers/disconnect.js";

const QUESTION = { index: 0, text: "Reverse a list", category: "technical", difficulty: "easy" };

// Records every emit in order, whether direct (socket.emit), to peers (socket.to) or to the room (io.to).
let events;
const fakeSocket = (id = "s1") => {
  const rooms = new Set([id]);
  return {
    id,
    data: {},
    rooms,
    join: vi.fn((room) => rooms.add(room)),
    emit: vi.fn((name, payload) => events.push(["self", name, payload])),
    to: vi.fn((room) => ({ emit: (name, payload) => events.push([`peers:${room}`, name, payload]) })),
  };
};

let ctx;
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  events = [];
  ctx = {
    io: {
      to: (room) => ({ emit: (name, payload) => events.push([`room:${room}`, name, payload]) }),
      sockets: { adapter: { rooms: new Map() } },
    },
    roomState: new Map(),
    roomQuestions: new Map(),
    interviewStore: { update: vi.fn().mockResolvedValue({}) },
    findCodeSnapshot: vi.fn(),
  };
});

describe("join-room", () => {
  it("replays the current question first, then live code — without touching the database", async () => {
    ctx.roomQuestions.set("r1", QUESTION);
    ctx.roomState.set("r1", { code: "live()", language: "python", dirty: true });
    const socket = fakeSocket();
    await createJoinRoomHandler(ctx)(socket)("r1");
    expect(socket.rooms.has("r1")).toBe(true);
    expect(socket.data.roomId).toBe("r1");
    expect(events).toEqual([
      ["self", "question-update", QUESTION],
      ["self", "code-update", "live()"],
      ["self", "language-update", "python"],
    ]);
    expect(ctx.findCodeSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to the persisted snapshot when the room is not live", async () => {
    ctx.findCodeSnapshot.mockResolvedValue({ codeSnapshot: "saved()", codeLanguage: "javascript" });
    await createJoinRoomHandler(ctx)(fakeSocket())("r1");
    expect(ctx.findCodeSnapshot).toHaveBeenCalledWith("r1");
    expect(events).toEqual([
      ["self", "code-update", "saved()"],
      ["self", "language-update", "javascript"],
    ]);
  });

  it("emits nothing for an unknown room", async () => {
    ctx.findCodeSnapshot.mockResolvedValue(null);
    await createJoinRoomHandler(ctx)(fakeSocket())("default");
    expect(events).toEqual([]);
  });

  it("survives a database error while loading the snapshot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ctx.findCodeSnapshot.mockRejectedValue(new Error("db down"));
    await expect(createJoinRoomHandler(ctx)(fakeSocket())("r1")).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });
});

describe("code-change / language-change", () => {
  it("broadcasts to peers and marks the room dirty", () => {
    const socket = fakeSocket();
    socket.rooms.add("r1");
    createCodeChangeHandler(ctx)(socket)({ roomId: "r1", code: "x = 1" });
    createLanguageChangeHandler(ctx)(socket)({ roomId: "r1", language: "go" });
    expect(events).toEqual([
      ["peers:r1", "code-update", "x = 1"],
      ["peers:r1", "language-update", "go"],
    ]);
    expect(ctx.roomState.get("r1")).toEqual({ code: "x = 1", language: "go", dirty: true });
  });

  it("ignores changes for a room the socket has not joined", () => {
    createCodeChangeHandler(ctx)(fakeSocket())({ roomId: "r1", code: "evil" });
    createLanguageChangeHandler(ctx)(fakeSocket())({ roomId: "r1", language: "evil" });
    expect(events).toEqual([]);
    expect(ctx.roomState.has("r1")).toBe(false);
  });
});

describe("question-change", () => {
  it("sanitises the question and sends it to the whole room", () => {
    const socket = fakeSocket();
    socket.rooms.add("r1");
    createQuestionChangeHandler(ctx)(socket)({ roomId: "r1", question: { ...QUESTION, source: { secret: true } } });
    expect(events).toEqual([["room:r1", "question-update", QUESTION]]);
    expect(ctx.roomQuestions.get("r1")).toEqual(QUESTION);
  });

  it("drops an invalid payload", () => {
    const socket = fakeSocket();
    socket.rooms.add("r1");
    createQuestionChangeHandler(ctx)(socket)({ roomId: "r1", question: { text: "" } });
    createQuestionChangeHandler(ctx)(socket)(undefined);
    expect(events).toEqual([]);
  });
});

describe("code-execution", () => {
  it("relays the result to peers in the room", () => {
    const socket = fakeSocket();
    socket.rooms.add("r1");
    createCodeExecutionHandler(ctx)(socket)({ roomId: "r1", result: { stdout: "1" } });
    expect(events).toEqual([["peers:r1", "execution-result", { stdout: "1" }]]);
  });

  it("ignores a socket that is not in the room", () => {
    createCodeExecutionHandler(ctx)(fakeSocket())({ roomId: "r1", result: { stdout: "spoof" } });
    expect(events).toEqual([]);
  });
});

describe("disconnect", () => {
  it("clears the question and flushes the room when the last member leaves", async () => {
    const socket = fakeSocket();
    socket.data.roomId = "r1";
    ctx.roomQuestions.set("r1", QUESTION);
    ctx.roomState.set("r1", { code: "c", language: "js", dirty: true });
    createDisconnectHandler(ctx)(socket)();
    await vi.waitFor(() => expect(ctx.roomState.has("r1")).toBe(false));
    expect(ctx.roomQuestions.has("r1")).toBe(false);
    expect(ctx.interviewStore.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { codeSnapshot: "c", codeLanguage: "js" },
    });
  });

  it("keeps the room alive while others are still in it", () => {
    const socket = fakeSocket();
    socket.data.roomId = "r1";
    ctx.io.sockets.adapter.rooms.set("r1", new Set(["s2"]));
    ctx.roomQuestions.set("r1", QUESTION);
    createDisconnectHandler(ctx)(socket)();
    expect(ctx.roomQuestions.has("r1")).toBe(true);
    expect(ctx.interviewStore.update).not.toHaveBeenCalled();
  });
});
