/**
 * Google sign-in for DMs: an OAuth 2.0 authorization-code flow with PKCE, ending
 * in an HMAC-signed session cookie. Players never sign in.
 */

export interface AuthEnv {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
}

export interface User {
  /** Google's stable account id (`sub`). */
  id: string
  name: string
  email: string
  picture: string | null
}

const SESSION_COOKIE = 'crawler_session'
const OAUTH_COOKIE = 'crawler_oauth'
const SESSION_DAYS = 30
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'

interface Session extends User {
  exp: number
}

export function configured(env: Partial<AuthEnv>): env is AuthEnv {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET)
}

/** The signed-in DM, or null. */
export async function currentUser(request: Request, env: AuthEnv): Promise<User | null> {
  const raw = readCookie(request, SESSION_COOKIE)
  if (!raw) return null
  const session = await unseal<Session>(raw, env.SESSION_SECRET)
  if (!session || session.exp < Date.now()) return null
  return { id: session.id, name: session.name, email: session.email, picture: session.picture }
}

/** GET /auth/google — off to Google, remembering where to come back to. */
export async function startSignIn(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url)
  const state = randomToken()
  const verifier = randomToken() + randomToken()
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))))
  const back = safeReturn(url.searchParams.get('return'))

  const target = new URL(GOOGLE_AUTH)
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()

  const pending = await seal({ state, verifier, back, exp: Date.now() + 10 * 60_000 }, env.SESSION_SECRET)
  return redirect(target.toString(), cookie(url, OAUTH_COOKIE, pending, 600))
}

/** GET /auth/google/callback — swap the code for an id token and start a session. */
export async function finishSignIn(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url)
  const raw = readCookie(request, OAUTH_COOKIE)
  const pending = raw
    ? await unseal<{ state: string; verifier: string; back: string; exp: number }>(raw, env.SESSION_SECRET)
    : null
  const clearPending = cookie(url, OAUTH_COOKIE, '', 0)
  const code = url.searchParams.get('code')
  if (!pending || pending.exp < Date.now() || !code || url.searchParams.get('state') !== pending.state) {
    return redirect('/?signin=failed', clearPending)
  }

  const response = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
  })
  if (!response.ok) return redirect('/?signin=failed', clearPending)
  const tokens = (await response.json()) as { id_token?: string }

  // The id token came straight from Google's token endpoint over TLS in exchange
  // for our client secret, so its claims can be read without re-verifying the
  // signature (OpenID Connect Core §3.1.3.7). Still check who it is for.
  const claims = tokens.id_token ? decodeJwt(tokens.id_token) : null
  if (
    !claims ||
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
    typeof claims.sub !== 'string'
  ) {
    return redirect('/?signin=failed', clearPending)
  }

  const session: Session = {
    id: claims.sub,
    name: String(claims.name ?? claims.email ?? 'Dungeon Master'),
    email: String(claims.email ?? ''),
    picture: typeof claims.picture === 'string' ? claims.picture : null,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  }
  const sealed = await seal(session, env.SESSION_SECRET)
  return redirect(pending.back, clearPending, cookie(url, SESSION_COOKIE, sealed, SESSION_DAYS * 24 * 60 * 60))
}

/** POST /auth/logout */
export function signOut(request: Request): Response {
  const url = new URL(request.url)
  const headers = new Headers({ 'Set-Cookie': cookie(url, SESSION_COOKIE, '', 0) })
  return new Response(null, { status: 204, headers })
}

// ---------- Sealing: base64url(json).base64url(hmac) ----------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function seal(value: unknown, secret: string): Promise<string> {
  const body = base64url(utf8(JSON.stringify(value)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(body))
  return `${body}.${base64url(new Uint8Array(signature))}`
}

async function unseal<T>(raw: string, secret: string): Promise<T | null> {
  const [body, signature] = raw.split('.')
  if (!body || !signature) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(signature), utf8(body))
    return ok ? (JSON.parse(new TextDecoder().decode(fromBase64url(body))) as T) : null
  } catch {
    return null
  }
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(token.split('.')[1] ?? '')))
  } catch {
    return null
  }
}

// ---------- Small helpers ----------

/** Only same-site paths, so the sign-in flow can't bounce anyone elsewhere. */
function safeReturn(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/'
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

function cookie(url: URL, name: string, value: string, maxAge: number): string {
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function redirect(location: string, ...cookies: string[]): Response {
  const headers = new Headers({ Location: location })
  for (const item of cookies) headers.append('Set-Cookie', item)
  return new Response(null, { status: 302, headers })
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)))
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text))
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
