import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'btp_session'
export const SESSION_TTL_S = 7 * 24 * 3600

const digest = (value: string) => createHash('sha256').update(value).digest()

// Comparer les empreintes et non les chaines: timingSafeEqual exige deux
// tampons de meme longueur, et la longueur du mot de passe ne doit pas fuiter.
export const passwordMatches = (input: string, expected: string) =>
  expected !== '' && timingSafeEqual(digest(input), digest(expected))

// La cle de signature derive du mot de passe: le changer sur Vercel
// deconnecte toutes les sessions ouvertes, sans second secret a gerer.
const sign = (payload: string, password: string) =>
  createHmac('sha256', digest(`session:${password}`)).update(payload).digest('base64url')

export const createSessionToken = (password: string, now = Date.now()) => {
  const expiresAt = String(Math.floor(now / 1000) + SESSION_TTL_S)
  return `${expiresAt}.${sign(expiresAt, password)}`
}

export const isValidSessionToken = (token: string | undefined, password: string, now = Date.now()) => {
  if (!token || !password) return false

  const [expiresAt, signature] = token.split('.')
  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) return false

  const given = Buffer.from(signature)
  const expected = Buffer.from(sign(expiresAt, password))
  return given.length === expected.length && timingSafeEqual(given, expected) && Number(expiresAt) * 1000 > now
}

export const readCookie = (header: string | null, name: string) =>
  header
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1]

export const requestHasSession = (request: Request) =>
  isValidSessionToken(
    readCookie(request.headers.get('cookie'), SESSION_COOKIE),
    process.env.DASHBOARD_MASTER_PASSWORD ?? '',
  )

export const sessionCookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
