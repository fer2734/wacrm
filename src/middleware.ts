import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Keep the invitation across email confirmation, browser reloads and login.
  const pathname = request.nextUrl.pathname
  const invitation = pathname.startsWith('/join/')
    ? pathname.split('/')[2]
    : request.nextUrl.searchParams.get('invite')
  const validInvite = invitation && /^[A-Za-z0-9_-]{43}$/.test(invitation)
    ? invitation : null
  if (validInvite) {
    supabaseResponse.cookies.set('wacrm_invitation', validInvite, {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60,
    })
  }

  if (user && pathname === '/dashboard') {
    const pending = validInvite ?? request.cookies.get('wacrm_invitation')?.value
    if (pending && /^[A-Za-z0-9_-]{43}$/.test(pending)) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending))
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const { data: invite, error } = await supabase.rpc('peek_invitation', { p_token_hash: hash })
      if (!error && invite?.ok) {
        const url = request.nextUrl.clone()
        url.pathname = `/join/${pending}`
        url.search = ''
        return withRefreshedCookies(NextResponse.redirect(url))
      }
      if (!error) supabaseResponse.cookies.delete('wacrm_invitation')
    }
  }

  // Agents use the shared inbox. Workspace setup belongs to administrators.
  if (user && !pathname.startsWith('/api/') &&
      ['/dashboard', '/broadcasts', '/automations', '/flows', '/agents', '/settings'].some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    const { data: profile } = await supabase.from('profiles')
      .select('account_role').eq('user_id', user.id).maybeSingle()
    if (profile?.account_role === 'agent') {
      const personalSettings = ['profile', 'security', 'appearance']
      const allowedSettings = pathname === '/settings' &&
        personalSettings.includes(request.nextUrl.searchParams.get('tab') ?? '')
      if (!allowedSettings) {
        const url = request.nextUrl.clone()
        url.pathname = pathname === '/settings' ? '/settings' : '/agenda'
        url.search = pathname === '/settings' ? '?tab=profile' : ''
        return withRefreshedCookies(NextResponse.redirect(url))
      }
    }
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/agenda'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  // Every top-level route under src/app/(dashboard)/ belongs here —
  // middleware.test.ts reads that directory and fails on a missing one.
  const protectedPaths = ['/agenda', '/dashboard', '/inbox', '/private-inbox', '/waha-lab', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/agents', '/notifications', '/settings']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  if (user && ['/api/flows', '/api/automations', '/api/whatsapp/broadcast', '/api/ai/config', '/api/ai/usage', '/api/ai/knowledge', '/api/ai/playground', '/api/ai/test'].some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    const { data: profile } = await supabase.from('profiles')
      .select('account_role').eq('user_id', user.id).maybeSingle()
    if (profile?.account_role === 'agent') {
      return withRefreshedCookies(NextResponse.json({ error: 'Esta función requiere un administrador' }, { status: 403 }))
    }
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
