import { createFileRoute } from '@tanstack/react-router'

import { sessionCookie } from '@/lib/auth'

export const Route = createFileRoute('/api/logout')({
  server: {
    handlers: {
      POST: () =>
        new Response(null, {
          status: 303,
          headers: { location: '/login', 'set-cookie': sessionCookie('', 0) },
        }),
    },
  },
})
