import { createServerFn } from '@tanstack/react-start'

import { loadGistState } from '@/server/gist'

// =============================================================================
// Gist state types (only safe fields — no cookies, no FTP credentials)
// =============================================================================

export interface RotationState {
  activeAccountEmail: string
  activeServerId: string
  modpackName: string
  /** Id panel ou id API selon l'espace dans lequel le state a ete ecrit. */
  modpackRef: string
  lastRotationAt: string | null
}

interface GitHubWorkflowRunApi {
  id: number
  name: string | null
  created_at: string
  status: string
  conclusion: string | null
  html_url: string
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRunApi[]
}

export interface WorkflowRun {
  id: number
  name: string
  createdAt: string
  status: string
  conclusion: string | null
  htmlUrl: string
}

export const getRecentWorkflows = createServerFn({ method: 'GET' }).handler(async (): Promise<WorkflowRun[]> => {
  const token = process.env.GH_TOKEN
  const repository = process.env.GITHUB_REPO

  if (!token || !repository) {
    throw new Error('Missing GitHub configuration (GH_TOKEN or GITHUB_REPO)')
  }

  const [owner, repo] = repository.split('/')

  if (!owner || !repo) {
    throw new Error('GITHUB_REPO must be in the format owner/repo')
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=10`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch GitHub workflow runs')
  }

  const data = (await response.json()) as GitHubWorkflowRunsResponse

  return data.workflow_runs.map((run) => ({
    id: run.id,
    name: run.name ?? 'Unnamed workflow',
    createdAt: run.created_at,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
  }))
})

export const getGistState = createServerFn({ method: 'GET' }).handler(async (): Promise<RotationState> => {
  const state = await loadGistState()
  const idx = state.active_account_index ?? 0
  const activeAccount = state.accounts?.[idx]

  return {
    activeAccountEmail: activeAccount?.email ?? '—',
    activeServerId: String(state.current_server_id ?? activeAccount?.server_id ?? '—'),
    modpackName: state.modpack_name ?? state.modpack ?? '—',
    // Les deux espaces d'ids coexistent: change_modpack.py pose l'un et retire
    // l'autre, donc afficher celui qui est renseigne evite de montrer un id
    // que plus rien n'utilise.
    modpackRef: String(state.modpack_api_id || state.modpack_version_id || '—'),
    lastRotationAt: state.last_rotation_at ?? null,
  }
})
