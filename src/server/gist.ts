// =============================================================================
// Lecture du Gist d'etat
//
// Extrait de server/dashboard.ts pour que server/btp.ts puisse s'en servir sans
// creer de cycle d'import (dashboard.ts importe deja btp.ts).
// =============================================================================

const GIST_TTL_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000

export interface GistStateAccount {
  email?: string
  server_id?: string | number
}

export interface GistStateRaw {
  active_account_index?: number
  current_server_id?: string | number
  modpack_name?: string
  modpack?: string
  modpack_version_id?: string | number
  modpack_api_id?: string
  last_rotation_at?: string
  accounts?: GistStateAccount[]
}

/** progress.json, ecrit par le worker a chaque phase de rotation. */
export interface RotationProgress {
  run_id?: string
  step?: number
  total?: number
  label?: string
  updated_at?: string
}

let cache: { value: GistStateRaw; progress: RotationProgress | null; expiresAt: number } | null = null

export async function loadGistState(): Promise<GistStateRaw> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value
  }

  const token = process.env.GH_TOKEN
  const gistId = (process.env.GIST_ID ?? '').trim()

  if (!token || !gistId) {
    throw new Error('Missing Gist configuration (GH_TOKEN or GIST_ID)')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch Gist state: ${response.status}`)
  }

  const gist = (await response.json()) as { files: Record<string, { content: string }> }
  const fileContent = gist.files['boxtoplay.json']?.content
  if (!fileContent) {
    throw new Error('boxtoplay.json not found in Gist')
  }

  const value = JSON.parse(fileContent) as GistStateRaw
  let progress: RotationProgress | null = null
  try {
    const raw = gist.files['progress.json']?.content
    progress = raw ? (JSON.parse(raw) as RotationProgress) : null
  } catch {
    // progress.json est du confort: illisible = pas d'avancement affiche.
  }
  cache = { value, progress, expiresAt: Date.now() + GIST_TTL_MS }
  return value
}

export async function loadRotationProgress(): Promise<RotationProgress | null> {
  await loadGistState()
  return cache?.progress ?? null
}

/** Id panel du serveur qui sert en ce moment, ou '' si le Gist est muet. */
export function liveServerId(state: GistStateRaw): string {
  const idx = state.active_account_index ?? 0
  return String(state.current_server_id ?? state.accounts?.[idx]?.server_id ?? '').trim()
}
