// Disable SSR for the whole app — it uses localStorage for auth
// so server-side rendering causes hydration mismatches.
export const ssr = false;
