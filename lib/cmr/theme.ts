/**
 * CMR theme preference. Light is the default; dark is opt-in. Stored in a cookie (not only
 * localStorage) so the server renders the right theme on first paint — no flash.
 * Dependency-free so both the server layout and the client toggle can import it.
 */
export type CmrTheme = 'light' | 'dark'

export const CMR_THEME_COOKIE = 'cmr-theme'

export function parseCmrTheme(v: string | undefined | null): CmrTheme {
  return v === 'dark' ? 'dark' : 'light'
}
