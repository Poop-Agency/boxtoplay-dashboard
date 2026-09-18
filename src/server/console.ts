import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { requestHasSession } from '@/lib/auth'
import { commandError, normalizeCommand } from '@/lib/console'
import { activeServer, btpFetch } from '@/server/btp'

// =============================================================================
// Console serveur (RCON via l'API BoxToPlay)
//
// POST /services/minecraft/{id}/console/commands rend la sortie de la commande
// dans la meme reponse: pas de lecture de log a cote.
// =============================================================================

const REQUEST_TIMEOUT_MS = 20_000

interface BtpConsoleResult {
  status?: string
  output?: string
  output_truncated?: boolean
}

export interface ConsoleResult {
  output: string
  truncated: boolean
}

export const sendConsoleCommand = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { command?: string })
  .handler(async ({ data }): Promise<ConsoleResult> => {
    // Le middleware de start.ts protege deja toute server function absente de
    // son allowlist. On redemande ici parce que cette fonction-la est un shell
    // op sur le serveur: si quelqu'un l'ajoute un jour a l'allowlist par
    // erreur, la commande doit quand meme etre refusee.
    if (!requestHasSession(getRequest())) {
      throw new Error('Unauthorized')
    }

    const raw = data?.command ?? ''
    const problem = commandError(raw)
    if (problem) {
      throw new Error(problem)
    }

    const command = normalizeCommand(raw)
    const { serverId, key } = await activeServer()

    // Journal d'audit: la console peut casser une partie, il faut pouvoir
    // relire ce qui a ete envoye et quand (logs Vercel).
    console.info(`[console] ${new Date().toISOString()} ${serverId} << ${command}`)

    const result = await btpFetch<BtpConsoleResult>(
      `/services/minecraft/${serverId}/console/commands`,
      undefined,
      REQUEST_TIMEOUT_MS,
      key,
      { command },
    )

    return {
      output: result.output ?? '',
      truncated: result.output_truncated === true,
    }
  })
