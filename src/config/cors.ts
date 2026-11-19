const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turns "https://app.example.com, https://app-*.vercel.app" into values the cors middleware understands.
 * A `*` matches one hostname label (letters, digits, hyphens) so Vercel preview URLs work, while
 * "https://app-x.vercel.app.evil.com" does not. Trailing slashes are ignored (a common config typo).
 */
export function parseCorsOrigins(csv: string): (string | RegExp)[] {
  return csv
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((o) => (o.includes('*') ? new RegExp(`^${o.split('*').map(escape).join('[a-z0-9-]+')}$`, 'i') : o));
}
