import { useEffect, useRef } from 'react';
import type { ApiFetch } from './api';
import { createAiInterviewerApi } from './aiInterviewer';

// Opens the room's AI interviewer panel by itself, once, when the interview already has an
// AI session (a reloaded room shows the conversation without a click). `enabled`: the
// caller may see the AI (the room is loaded, the viewer is its owner or candidate).
export function useAiAutoOpen(apiFetch: ApiFetch, interviewId: string, enabled: boolean, open: () => void) {
  const checked = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!enabled || !interviewId || checked.current) return;
    checked.current = true;
    createAiInterviewerApi(apiFetch, interviewId)
      .current()
      .then(({ sessionId }) => sessionId && openRef.current())
      .catch(() => {}); // no panel, as before: the button still opens it
  }, [apiFetch, interviewId, enabled]);
}
