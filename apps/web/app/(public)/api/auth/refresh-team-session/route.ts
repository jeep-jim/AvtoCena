import {NextResponse} from 'next/server';
import {AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie, getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';

export async function GET(request: Request) {
  // Re-read the account and session version; never promote the signed cookie itself.
  const user = await getCurrentUser();
  const destination = !user ? '/login?next=/crm' : isPlatformTeam(user) ? '/crm' : '/dealer-cabinet';
  const response = NextResponse.redirect(new URL(destination, process.env.NEXT_PUBLIC_SITE_URL || request.url));
  response.headers.set('Cache-Control', 'private, no-store');
  if (user && isPlatformTeam(user)) response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: AUTH_MAX_AGE_SECONDS,
  });
  return response;
}
