import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'

import { requestHasSession } from '@/lib/auth'

// Le cookie est HttpOnly: le client ne peut pas savoir seul s'il est connecte.
export const hasSession = createServerFn({ method: 'GET' }).handler(async () => requestHasSession(getRequest()))

// Navigation cote client: le middleware de requete ne voit pas ces transitions.
export const requireSession = async () => {
  if (!(await hasSession())) throw redirect({ to: '/login' })
}
