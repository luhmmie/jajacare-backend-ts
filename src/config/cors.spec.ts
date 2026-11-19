import { parseCorsOrigins } from './cors';

const allowed = (origins: (string | RegExp)[], origin: string) => origins.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));

describe('parseCorsOrigins', () => {
  const origins = parseCorsOrigins('https://jajacare.vercel.app/, https://jajacare-*.vercel.app , http://localhost:5173');

  it('allows exact origins and ignores a trailing slash', () => {
    expect(allowed(origins, 'https://jajacare.vercel.app')).toBe(true);
    expect(allowed(origins, 'http://localhost:5173')).toBe(true);
  });
  it('allows Vercel preview deployments through the wildcard', () => {
    expect(allowed(origins, 'https://jajacare-git-main-amidat.vercel.app')).toBe(true);
  });
  it('rejects look-alike and unrelated origins', () => {
    expect(allowed(origins, 'https://jajacare-x.vercel.app.evil.com')).toBe(false);
    expect(allowed(origins, 'https://evil.com')).toBe(false);
    expect(allowed(origins, 'http://jajacare.vercel.app')).toBe(false);
  });
  it('ignores empty entries', () => {
    expect(parseCorsOrigins(' , ,')).toEqual([]);
  });
});
