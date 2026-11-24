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
const OWNER = { kind: "interviewer", userId: "u-ada", clerkId: "clerk_ada" };
const fakeSocket = (id = "s1", principal = OWNER) => {
  const rooms = new Set([id]);
  return {
    id,
    data: { principal },
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
    roomOwners: new Map(),
    askedQuestions: new Map(),
    interviewStore: { update: vi.fn().mockResolvedValue({}) },
    findCodeSnapshot: vi.fn(),
    // Rooms the principal may enter: owners their interviews, a candidate only theirs.
    canAccessRoom: vi.fn(async (principal, roomId) =>
      principal.kind === "candidate" ? principal.interviewId === roomId : true,
    ),
  };
});

describe("join-room", () => {
  it("replays the current question first, then live code — without touching the database", async () => {
    ctx.roomQuestions.set("r1", QUESTION);
    ctx.askedQuestions.set("r1", [QUESTION]);
    ctx.roomState.set("r1", { code: "live()", language: "python", dirty: true });
    const socket = fakeSocket();
    await createJoinRoomHandler(ctx)(socket)("r1");
    expect(socket.rooms.has("r1")).toBe(true);
    expect(socket.data.roomId).toBe("r1");
    expect(events).toEqual([
      ["room:r1", "interviewer-presence", { present: true }],
      ["self", "question-update", QUESTION],
      ["self", "questions-asked", [QUESTION]],
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
      ["room:r1", "interviewer-presence", { present: true }],
      ["self", "code-update", "saved()"],
      ["self", "language-update", "javascript"],
    ]);
  });

  it("emits nothing for an unknown room", async () => {
    ctx.findCodeSnapshot.mockResolvedValue(null);
    await createJoinRoomHandler(ctx)(fakeSocket())("default");
    expect(events).toEqual([["room:default", "interviewer-presence", { present: true }]]);
  });

  it("survives a database error while loading the snapshot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ctx.findCodeSnapshot.mockRejectedValue(new Error("db down"));
    await expect(createJoinRoomHandler(ctx)(fakeSocket())("r1")).resolves.toBeUndefined();
    expect(events).toEqual([["room:r1", "interviewer-presence", { present: true }]]);
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
    expect(events).toEqual([
      ["room:r1", "question-update", QUESTION],
      ["room:r1", "questions-asked", [QUESTION]],
    ]);
    expect(ctx.roomQuestions.get("r1")).toEqual(QUESTION);
  });

  it("keeps every question asked so far, once each, in the order they were first asked", () => {
    const socket = fakeSocket();
    socket.rooms.add("r1");
    const SECOND = { index: 3, text: "Merge intervals", category: "technical", difficulty: "medium" };
    const ask = (question) => createQuestionChangeHandler(ctx)(socket)({ roomId: "r1", question });
    ask(QUESTION);
    ask(SECOND);
    ask(QUESTION); // asked again: back on screen, not listed twice
    expect(events.at(-1)).toEqual(["room:r1", "questions-asked", [QUESTION, SECOND]]);
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
    ctx.askedQuestions.set("r1", [QUESTION]);
    ctx.roomState.set("r1", { code: "c", language: "js", dirty: true });
    createDisconnectHandler(ctx)(socket)();
    await vi.waitFor(() => expect(ctx.roomState.has("r1")).toBe(false));
    expect(ctx.roomQuestions.has("r1")).toBe(false);
    expect(ctx.askedQuestions.has("r1")).toBe(false);
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

describe("interviewer presence", () => {
  const candidate = { kind: "candidate", interviewId: "r1" };
  const presence = () => events.filter(([, name]) => name === "interviewer-presence");

  beforeEach(() => ctx.findCodeSnapshot.mockResolvedValue(null));

  it("tells the room when the first owner joins", async () => {
    await createJoinRoomHandler(ctx)(fakeSocket("s1"))("r1");
    expect(presence()).toEqual([["room:r1", "interviewer-presence", { present: true }]]);
  });

  it("tells a candidate who joins whether the interviewer is there, and only that candidate", async () => {
    await createJoinRoomHandler(ctx)(fakeSocket("s9", candidate))("r1");
    expect(presence()).toEqual([["self", "interviewer-presence", { present: false }]]);
    events = [];
    await createJoinRoomHandler(ctx)(fakeSocket("s1"))("r1");
    events = [];
    await createJoinRoomHandler(ctx)(fakeSocket("s8", candidate))("r1");
    expect(presence()).toEqual([["self", "interviewer-presence", { present: true }]]);
  });

  it("does not re-announce when a second owner socket joins", async () => {
    await createJoinRoomHandler(ctx)(fakeSocket("s1"))("r1");
    events = [];
    await createJoinRoomHandler(ctx)(fakeSocket("s2"))("r1");
    expect(presence()).toEqual([["self", "interviewer-presence", { present: true }]]);
  });

  it("counts a socket once when it joins twice", async () => {
    const socket = fakeSocket("s1");
    await createJoinRoomHandler(ctx)(socket)("r1");
    await createJoinRoomHandler(ctx)(socket)("r1");
    createDisconnectHandler(ctx)(socket)();
    expect(ctx.roomOwners.has("r1")).toBe(false);
  });

  it("stays silent while another owner socket remains, then says absent when the last leaves", async () => {
    const a = fakeSocket("s1");
    const b = fakeSocket("s2");
    await createJoinRoomHandler(ctx)(a)("r1");
    await createJoinRoomHandler(ctx)(b)("r1");
    events = [];
    createDisconnectHandler(ctx)(a)();
    expect(presence()).toEqual([]);
    createDisconnectHandler(ctx)(b)();
    expect(presence()).toEqual([["room:r1", "interviewer-presence", { present: false }]]);
  });

  it("a candidate leaving does not change presence", async () => {
    await createJoinRoomHandler(ctx)(fakeSocket("s1"))("r1");
    const c = fakeSocket("s9", candidate);
    await createJoinRoomHandler(ctx)(c)("r1");
    events = [];
    createDisconnectHandler(ctx)(c)();
    expect(presence()).toEqual([]);
  });
});

describe("room access", () => {
  const candidate = { kind: "candidate", interviewId: "iv-1" };

  it("refuses a candidate joining another interview's room", async () => {
    ctx.roomState.set("iv-2", { code: "secret()", language: "js", dirty: false });
    const socket = fakeSocket("s9", candidate);
    await createJoinRoomHandler(ctx)(socket)("iv-2");
    expect(socket.rooms.has("iv-2")).toBe(false);
    expect(socket.data.roomId).toBeUndefined();
    expect(events).toEqual([["self", "error-message", "Forbidden"]]);
  });

  it("lets a candidate join their own room", async () => {
    ctx.findCodeSnapshot.mockResolvedValue(null);
    const socket = fakeSocket("s9", candidate);
    await createJoinRoomHandler(ctx)(socket)("iv-1");
    expect(socket.rooms.has("iv-1")).toBe(true);
  });

  it("refuses (instead of crashing the server) when the access check itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    ctx.canAccessRoom.mockRejectedValue(new Error("db down"));
    const socket = fakeSocket();
    await expect(createJoinRoomHandler(ctx)(socket)("iv-1")).resolves.toBeUndefined();
    expect(socket.rooms.has("iv-1")).toBe(false);
    expect(events).toEqual([["self", "error-message", "Forbidden"]]);
  });

  it("ignores question-change from a candidate", () => {
    const socket = fakeSocket("s9", candidate);
    socket.rooms.add("iv-1");
    createQuestionChangeHandler(ctx)(socket)({ roomId: "iv-1", question: QUESTION });
    expect(events).toEqual([]);
    expect(ctx.roomQuestions.has("iv-1")).toBe(false);
  });
});
