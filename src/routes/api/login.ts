import { createFileRoute } from '@tanstack/react-router'

import { SESSION_TTL_S, createSessionToken, passwordMatches, sessionCookie } from '@/lib/auth'

const seeOther = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location, ...headers } })

export const Route = createFileRoute('/api/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const password = process.env.DASHBOARD_MASTER_PASSWORD ?? ''
        const form = await request.formData()

        if (!passwordMatches(String(form.get('password') ?? ''), password)) {
          // ponytail: delai fixe par essai, pas de compteur (instances serverless
          // sans etat partage). Brute-force distribue: regle rate-limit Vercel Firewall sur /api/login.
          await new Promise((resolve) => setTimeout(resolve, 1000))
          return seeOther('/login?error=true')
        }

        return seeOther('/', { 'set-cookie': sessionCookie(createSessionToken(password), SESSION_TTL_S) })
      },
    },
  },
})
