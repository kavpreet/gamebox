import { createAuthClient } from 'better-auth/react';

// Same-origin: Vite proxies /api/auth to the backend in dev; in production the
// backend serves the SPA itself.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
});

export const { useSession, signIn, signUp, signOut } = authClient;
