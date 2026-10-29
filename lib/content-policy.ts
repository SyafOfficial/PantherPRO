export function contentPolicy(nonce: string, development: boolean) {
  if (!/^[A-Za-z0-9+/=]{16,128}$/.test(nonce))
    throw new Error("Invalid CSP nonce");
  const scripts = development
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; font-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}
