import { createMiddleware, createStart } from '@tanstack/react-start'
import { getRequest, setResponseStatus } from '@tanstack/react-start/server'

import { requestHasSession } from './lib/auth'

// Le tableau de bord reste lisible sans mot de passe: tout le reste est
// protege par defaut, une nouvelle page ou server function comprise.
const PUBLIC_PAGES = new Set(['/', '/stats', '/login', '/api/login', '/api/logout'])
const PUBLIC_SERVER_FNS = new Set([
  'getRecentWorkflows',
  'getGistState',
  'getServerVitals',
  'getServerStats',
  'getServerHistory',
  'getPlayerStats',
  'hasSession',
])

const missingPassword = () => !process.env.DASHBOARD_MASTER_PASSWORD

// Pages et routes API. Les server functions passent ici par /_serverFn/<hash>,
// sans nom lisible: elles sont filtrees par le middleware de fonction.
const pageGuard = createMiddleware().server(({ request, pathname, next }) => {
  if (PUBLIC_PAGES.has(pathname) || pathname.startsWith('/_serverFn/')) return next()
  if (missingPassword()) return new Response('DASHBOARD_MASTER_PASSWORD manquant', { status: 503 })
  if (requestHasSession(request)) return next()

  const wantsPage = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html')
  return wantsPage
    ? Response.redirect(new URL('/login', request.url), 302)
    : new Response('Unauthorized', { status: 401 })
})

// Verifie cote serveur a chaque appel: cacher un bouton ne protege pas un
// POST direct sur la server function.
const serverFnGuard = createMiddleware({ type: 'function' }).server(({ serverFnMeta, next }) => {
  if (PUBLIC_SERVER_FNS.has(serverFnMeta.name)) return next()
  if (missingPassword() || !requestHasSession(getRequest())) {
    setResponseStatus(401)
    throw new Error('Unauthorized')
  }
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [pageGuard],
  functionMiddleware: [serverFnGuard],
}))
