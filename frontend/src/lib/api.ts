import { useCallback, useMemo } from 'react';
import { useCredentials } from './credentials';
import { API_URL } from './config';

export { API_URL };

type SocketAuthCallback = (data: Record<string, string>) => void;

/**
 * Talks to the backend with the right credential attached.
 *  - default: the signed-in interviewer's Clerk token, or the demo token
 *  - `{ invite }`: a candidate's invite secret (candidate room only)
 * `socketAuth` is meant for `io(API_URL, { auth: socketAuth })`: as a callback, every
 * (re)connection sends a fresh credential.
 */
export function useApi(options: { invite?: string | null } = {}) {
  const { getBearer, mode, leaveDemo } = useCredentials();
  const { invite } = options;

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (invite) return { 'x-invite-token': invite };
    const bearer = await getBearer();
    return bearer ? { Authorization: `Bearer ${bearer}` } : {};
  }, [invite, getBearer]);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = { ...(init.headers as Record<string, string> | undefined), ...(await authHeaders()) };
      const res = await fetch(`${API_URL}${path}`, { ...init, headers });
      // An expired demo token: drop it so the app goes back to the sign-in page.
      if (res.status === 401 && mode === 'demo' && !invite) leaveDemo();
      return res;
    },
    [authHeaders, mode, invite, leaveDemo],
  );

  const socketAuth = useCallback(
    (cb: SocketAuthCallback) => {
      if (invite) return cb({ invite });
      getBearer().then((token) => cb(token ? { token } : {}));
    },
    [invite, getBearer],
  );

  return useMemo(() => ({ apiFetch, socketAuth }), [apiFetch, socketAuth]);
}
