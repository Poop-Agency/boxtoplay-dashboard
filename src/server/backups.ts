import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// =============================================================================
// Types
// =============================================================================

interface DriveCredentials {
  client_id: string
  client_secret: string
  refresh_token: string
}

interface GoogleDriveFile {
  id: string
  name: string
  size: string
  createdTime: string
  webContentLink?: string
}

interface GoogleDriveResponse {
  files: GoogleDriveFile[]
}

// =============================================================================
// Token Cache
// =============================================================================

interface TokenCache {
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parses RCLONE_CONFIG_GDRIVE to extract OAuth credentials.
 * The format is INI-like: client_id/client_secret at top level, token JSON contains refresh_token.
 */
function getDriveCredentials(): DriveCredentials {
  const config = process.env.RCLONE_CONFIG_GDRIVE

  if (!config) {
    throw new Error('RCLONE_CONFIG_GDRIVE environment variable is not set')
  }

  const lines = config.split('\n')

  // Extract client_id and client_secret from separate lines
  const clientIdLine = lines.find((line) => line.trim().startsWith('client_id'))
  const clientSecretLine = lines.find((line) => line.trim().startsWith('client_secret'))
  const tokenLine = lines.find((line) => line.trim().startsWith('token ='))

  if (!clientIdLine || !clientSecretLine || !tokenLine) {
    throw new Error('Missing required fields in RCLONE_CONFIG_GDRIVE (client_id, client_secret, or token)')
  }

  const client_id = clientIdLine.replace(/^.*client_id\s*=\s*/, '').trim()
  const client_secret = clientSecretLine.replace(/^.*client_secret\s*=\s*/, '').trim()

  // Extract refresh_token from the JSON token
  const jsonStr = tokenLine.replace(/^.*token\s*=\s*/, '').trim()

  try {
    const tokenData = JSON.parse(jsonStr)

    if (!tokenData.refresh_token) {
      throw new Error('Missing refresh_token in token JSON')
    }

    return {
      client_id,
      client_secret,
      refresh_token: tokenData.refresh_token,
    }
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown parse error'
    throw new Error(`Failed to parse token JSON from RCLONE_CONFIG_GDRIVE: ${errorMsg}`)
  }
}

/**
 * Gets a valid access token, refreshing if necessary.
 * Uses in-memory cache to avoid spamming the OAuth API.
 */
async function getValidAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken
  }

  const credentials = getDriveCredentials()

  const params = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    refresh_token: credentials.refresh_token,
    grant_type: 'refresh_token',
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to refresh OAuth token: ${response.status} ${errorText}`)
  }

  const tokenResponse = (await response.json()) as { access_token: string; expires_in: number }

  // Update cache
  tokenCache = {
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
  }

  return tokenCache.accessToken
}

// =============================================================================
// Server Function
// =============================================================================

export interface BackupFile {
  id: string
  name: string
  size: string
  createdTime: string
  webContentLink?: string
  isFinal: boolean
  associatedModpack: string
}

export const getBackupsList = createServerFn({ method: 'GET' }).handler(async (): Promise<BackupFile[]> => {
  try {
    const accessToken = await getValidAccessToken()

    // Filter to show only actual Minecraft backups (not random zip files).
    // `world_` couvre les rotations horodatees (world_<AAAAMMJJ>_<HHMMSS>Z.zip),
    // le nom que le worker depose depuis boxtoplay-v2 #29 (2026-09-02);
    // `minecraft_world_backup` reste pour les archives d'avant ce changement.
    // Drive filtre large ici, isRotationBackup() tranche ensuite cote client.
    const queryParams = new URLSearchParams({
      q: "name contains '.zip' and trashed=false and (name contains 'world_' or name contains 'minecraft_world_backup' or name contains 'final_backup' or name contains '-server-files.zip')",
      fields: 'files(id, name, size, createdTime, webContentLink)',
      orderBy: 'createdTime desc',
    })

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${queryParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      console.error('[backups] Google Drive API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return []
    }

    const data = (await response.json()) as GoogleDriveResponse

    // Parse filenames to extract modpack info
    // Accepts: FINAL_*, final_backup_*, final_*
    const backups: BackupFile[] = (data.files ?? []).map((file) => {
      const nameLower = file.name.toLowerCase()
      const isFinal = nameLower.startsWith('final_') || nameLower.startsWith('final_backup_')
      let associatedModpack = ''

      if (isFinal) {
        // Format: final_backup_ModpackName_Date.zip or final_ModpackName_Date.zip
        // Extract modpack name between prefix and the date part
        let withoutPrefix = file.name.replace(/^final_backup_/i, '').replace(/^final_/i, '')
        // Match everything up to the last underscore before the date pattern
        const dateMatch = withoutPrefix.match(/_(\d{8})_\d{4}/)
        if (dateMatch) {
          associatedModpack = withoutPrefix.substring(0, dateMatch.index ?? withoutPrefix.length)
          // Replace underscores with spaces for display, e.g. "All-The-Mods-9" -> "All The Mods 9"
          associatedModpack = associatedModpack.replace(/_/g, ' ')
        } else {
          // Fallback: take everything before the last underscore
          const lastUnderscore = withoutPrefix.lastIndexOf('_')
          if (lastUnderscore > 0) {
            associatedModpack = withoutPrefix.substring(0, lastUnderscore).replace(/_/g, ' ')
          }
        }
      }

      return {
        ...file,
        isFinal,
        associatedModpack,
      }
    })

    return backups
  } catch (error) {
    console.error('[backups] Failed to fetch backups list', {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
})

export interface StorageStats {
  limit: number
  usage: number
}

export const getDriveStorageStats = createServerFn({ method: 'GET' }).handler(async (): Promise<StorageStats> => {
  try {
    const accessToken = await getValidAccessToken()
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      console.error('[backups] Storage stats error', response.status)
      return { limit: 0, usage: 0 }
    }
    const data = (await response.json()) as { storageQuota: { limit: string; usage: string } }
    return {
      limit: parseInt(data.storageQuota.limit, 10),
      usage: parseInt(data.storageQuota.usage, 10),
    }
  } catch (error) {
    console.error('[backups] Failed to fetch storage stats', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { limit: 0, usage: 0 }
  }
})

export const deleteBackupFile = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ fileId: z.string() }))
  .handler(async ({ data }) => {
    const accessToken = await getValidAccessToken()
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${data.fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Delete failed: ${response.status} ${errorText}`)
    }
    return { success: true }
  })

// =============================================================================
// File Revisions (Version History)
// =============================================================================

export interface FileRevision {
  id: string
  modifiedTime: string
  size: string
  downloadUrl: string | null
}

export const getFileRevisions = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ fileId: z.string() }))
  .handler(async ({ data }): Promise<FileRevision[]> => {
    try {
      const accessToken = await getValidAccessToken()
      const queryParams = new URLSearchParams({
        fields: 'revisions(id,modifiedTime,size,downloadUrl)',
      })

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${data.fileId}/revisions?${queryParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error('[backups] File revisions error', { status: response.status, error: errorText })
        return []
      }

      const body = (await response.json()) as { revisions: Array<{ id: string; modifiedTime: string; size: string; downloadUrl?: string }> }
      return (body.revisions ?? []).map((r) => ({
        id: r.id,
        modifiedTime: r.modifiedTime,
        size: r.size,
        downloadUrl: r.downloadUrl ?? null,
      }))
    } catch (error) {
      console.error('[backups] Failed to fetch file revisions', {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  })

export const restoreFullState = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ fileId: z.string(), modpackName: z.string(), modpackVersionId: z.string().optional() }))
  .handler(async ({ data }) => {
    const ghToken = process.env.GH_TOKEN
    if (!ghToken) {
      throw new Error('GH_TOKEN environment variable is not set')
    }

    const repository = process.env.GITHUB_REPO
    if (!repository) {
      throw new Error('GITHUB_REPO environment variable is not set')
    }
    const [owner, repo] = repository.split('/')
    if (!owner || !repo) {
      throw new Error('GITHUB_REPO must be in the format owner/repo')
    }
    const workflowId = 'schedule.yml'

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            restore_file_id: data.fileId,
            force_modpack: data.modpackName,
            restore_pack_id: data.modpackVersionId || '',
          },
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Failed to trigger restore workflow: ${response.status} ${errorText}`)
    }

    return { success: true }
  })