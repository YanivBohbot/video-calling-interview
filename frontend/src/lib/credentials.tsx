import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { API_URL } from './config';
import { readStorage, writeStorage } from './storage';

// Who the browser is, for the backend:
//  - "clerk":  a signed-in interviewer — Clerk session token (60 s, refreshed by Clerk)
//  - "demo":   "Continue as Guest" — a server-issued demo token kept in sessionStorage
//  - "none":   nobody (sign-in page, or a candidate page that brings its own invite)
export type CredentialMode = 'clerk' | 'demo' | 'none';

type DemoSession = { token: string; expiresAt: string };

const DEMO_KEY = 'talentiq.demoToken';

const loadDemo = (): DemoSession | null => {
  const raw = readStorage(DEMO_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as DemoSession;
    if (!session.token || new Date(session.expiresAt).getTime() <= Date.now()) throw new Error('expired');
    return session;
  } catch {
    writeStorage(DEMO_KEY, null);
    return null;
  }
};

type CredentialsValue = {
  mode: CredentialMode;
  enterDemo: () => Promise<void>;
  leaveDemo: () => void;
  /** Bearer token for the current mode, fetched fresh each call (Clerk tokens live 60 s). */
  getBearer: () => Promise<string | null>;
};

const CredentialsContext = createContext<CredentialsValue | null>(null);

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useAuth();
  const [demo, setDemo] = useState<DemoSession | null>(loadDemo);

  const enterDemo = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/auth/demo`, { method: 'POST' });
    if (!res.ok) throw new Error(`Demo login failed (${res.status})`);
    const session = (await res.json()) as DemoSession;
    writeStorage(DEMO_KEY, JSON.stringify(session));
    setDemo(session);
  }, []);

  const leaveDemo = useCallback(() => {
    writeStorage(DEMO_KEY, null);
    setDemo(null);
  }, []);

  // A real Clerk session always wins: someone who tried the demo and then signed in
  // must see their own account, so the leftover demo token is dropped.
  useEffect(() => {
    if (isSignedIn && demo) leaveDemo();
  }, [isSignedIn, demo, leaveDemo]);

  const mode: CredentialMode = isSignedIn ? 'clerk' : demo ? 'demo' : 'none';

  const getBearer = useCallback(async () => {
    if (isSignedIn) return getToken();
    if (demo) return demo.token;
    return null;
  }, [demo, isSignedIn, getToken]);

  const value = useMemo(() => ({ mode, enterDemo, leaveDemo, getBearer }), [mode, enterDemo, leaveDemo, getBearer]);
  return <CredentialsContext.Provider value={value}>{children}</CredentialsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCredentials(): CredentialsValue {
  const ctx = useContext(CredentialsContext);
  if (!ctx) throw new Error('useCredentials must be used inside <CredentialsProvider>');
  return ctx;
}
