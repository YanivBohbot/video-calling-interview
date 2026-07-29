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
