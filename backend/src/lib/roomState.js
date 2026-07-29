const DEFAULT_LANGUAGE = "javascript";

const getOrCreateEntry = (state, roomId) => {
  let entry = state.get(roomId);
  if (!entry) {
    entry = { code: "", language: DEFAULT_LANGUAGE, dirty: false };
    state.set(roomId, entry);
  }
  return entry;
};

export const applyCodeChange = (state, roomId, code) => {
  const entry = getOrCreateEntry(state, roomId);
  entry.code = code;
  entry.dirty = true;
};

export const applyLanguageChange = (state, roomId, language) => {
  const entry = getOrCreateEntry(state, roomId);
  entry.language = language;
  entry.dirty = true;
};

const saveRoom = async (state, prismaInterview, roomId) => {
  const entry = state.get(roomId);
  if (!entry || !entry.dirty) return;

  try {
    await prismaInterview.update({
      where: { id: roomId },
      data: { codeSnapshot: entry.code, codeLanguage: entry.language },
    });
    entry.dirty = false;
  } catch (err) {
    if (err.code !== "P2025") {
      console.error(`roomState: failed to flush room ${roomId}:`, err.message);
    }
    // Leave dirty=true either way — a missing interview (P2025) or a transient
    // DB error both just get retried on the next flush pass, harmlessly.
  }
};

export const flushAllDirty = async (state, prismaInterview) => {
  for (const roomId of state.keys()) {
    await saveRoom(state, prismaInterview, roomId);
  }
};

export const flushRoomOnExit = async (state, prismaInterview, roomId) => {
  await saveRoom(state, prismaInterview, roomId);
  state.delete(roomId);
};
