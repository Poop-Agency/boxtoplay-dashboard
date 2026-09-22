import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'

import { requestHasSession } from '@/lib/auth'

// Actions du tableau de bord = workflow_dispatch GitHub. Les gardes vivent
// cote worker (rotation trop tot, groupe de concurrence): le bouton ne fait
// que demander, comme le ferait un dispatch a la main.
export const ACTIONS = {
  backup: { workflow: 'schedule.yml', inputs: { backup_only: 'true' } },
  restart: { workflow: 'schedule.yml', inputs: { restart_only: 'true' } },
  rotate: { workflow: 'schedule.yml', inputs: {} },
  resync: { workflow: 'resync_gist.yml', inputs: { apply: 'true' } },
} as const

export type ActionName = keyof typeof ACTIONS

export const runAction = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ action: z.enum(['backup', 'restart', 'rotate', 'resync']) }))
  .handler(async ({ data }) => {
    // Le middleware de start.ts protege deja: double verrou, une action peut
    // couper le serveur.
    if (!requestHasSession(getRequest())) {
      throw new Error('Unauthorized')
    }

    const token = process.env.GH_TOKEN
    const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/')
    if (!token || !owner || !repo) {
      throw new Error('Missing GitHub configuration (GH_TOKEN or GITHUB_REPO)')
    }

    const { workflow, inputs } = ACTIONS[data.action]
    console.info(`[actions] ${new Date().toISOString()} ${data.action} -> ${workflow}`)
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs }),
      },
    )
    if (!response.ok) {
      throw new Error(`GitHub a refusé le déclenchement (${response.status})`)
    }
    return { ok: true }
  })
