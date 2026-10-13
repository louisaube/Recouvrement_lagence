/** rule-foundation-login-redirect-home: only an internal, safe path is accepted; otherwise the home page. */
export function safeRedirect(value: string | null): string {
  if (!value) return '/'
  if (!value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  const path = value.split(/[?#]/)[0]
  if (path === '/connexion') return '/'
  return value
}
