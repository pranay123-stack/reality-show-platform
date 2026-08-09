import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route protection at the edge.
 *
 * This is a *routing* convenience, not a security boundary: it only checks that
 * a session cookie is present so signed-out visitors get a sign-in page instead
 * of a flash of empty dashboard. Every actual authorisation decision is made by
 * the API, which verifies the token, the session and the role on every request.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/predictions',
  '/challenges',
  '/polls',
  '/perspectives',
  '/contestants',
  '/nominations',
  '/evictions',
  '/kitchen',
  '/weekend',
  '/leaderboard',
  '/rewards',
  '/points',
  '/notifications',
  '/admin',
];

const AUTH_PAGES = ['/login', '/signup', '/forgot-password'];

const ACCESS_COOKIE = 'rp_at';

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(ACCESS_COOKIE);

  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Someone already signed in has no use for the sign-in page.
  if (AUTH_PAGES.includes(pathname) && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
