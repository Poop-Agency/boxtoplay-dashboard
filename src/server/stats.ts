import { createServerFn } from '@tanstack/react-start'

import { nameFor, summarizePlayer, type PlayerStats } from '@/lib/stats'
import { activeServer, btpFetch } from '@/server/btp'

// =============================================================================
// Statistiques joueurs du serveur vivant
//
// L'API fichiers adresse tout par identifiant opaque: on descend racine ->
// world -> stats, puis on lit chaque <uuid>.json et usercache.json pour les
// pseudos. ~6 requetes + une par joueur, sur le quota (120 req / 60 s) partage
// avec le worker et le bot: 5 min de cache, les compteurs ne bougent qu'a la
// sauvegarde automatique du monde de toute facon.
// =============================================================================

const REQUEST_TIMEOUT_MS = 15_000
const STATS_TTL_MS = 5 * 60_000
// Plafond de rafale de l'API: 6 req/s par cle. Des lectures en parallele le
// crevaient (api.rate_limit.exceeded, constate en local le 2026-09-24) et
// mordaient sur le quota d'une rotation en cours: une requete toutes les 250 ms.
const REQUEST_GAP_MS = 250

const pause = () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS))

interface BtpEntry {
  id: string
  name: string
  type: 'file' | 'directory'
}

interface BtpEntryList {
  entries?: BtpEntry[]
  next_cursor?: string | null
}

interface BtpTextFile {
  content?: string
}

async function listDir(serverId: string, key: string, directoryId?: string, query?: string): Promise<BtpEntry[]> {
  const entries: BtpEntry[] = []
  let cursor: string | null | undefined
  do {
    const page = await btpFetch<BtpEntryList>(
      `/services/minecraft/${serverId}/files/text`,
      {
        limit: '50',
        ...(directoryId ? { directory_id: directoryId } : {}),
        ...(query ? { query } : {}),
        ...(cursor ? { cursor } : {}),
      },
      REQUEST_TIMEOUT_MS,
      key,
    )
    entries.push(...(page.entries ?? []))
    cursor = page.next_cursor
    await pause()
  } while (cursor)
  return entries
}

async function readJson<T>(serverId: string, key: string, fileId: string): Promise<T> {
  const file = await btpFetch<BtpTextFile>(
    `/services/minecraft/${serverId}/files/text/content`,
    { file_id: fileId },
    REQUEST_TIMEOUT_MS,
    key,
  )
  await pause()
  return JSON.parse(file.content ?? '{}') as T
}

// Joueur absent des deux caches du serveur (plus connecte depuis un mois):
// le profil Mojang public rend son pseudo. Serveur en online-mode, UUID v4.
async function mojangName(uuid: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`,
      { signal: AbortSignal.timeout(3_000) },
    )
    if (!response.ok) return null
    return ((await response.json()) as { name?: string }).name ?? null
  } catch {
    return null
  }
}

export interface PlayerStatsReport {
  players: PlayerStats[]
  readAt: string
}

let cache: { serverId: string; data: PlayerStatsReport; expiresAt: number } | null = null

export const getPlayerStats = createServerFn({ method: 'GET' }).handler(async (): Promise<PlayerStatsReport> => {
  const { serverId, key } = await activeServer()
  if (cache && cache.serverId === serverId && cache.expiresAt > Date.now()) {
    return cache.data
  }

  const root = await listDir(serverId, key)
  const world = root.find((entry) => entry.name === 'world' && entry.type === 'directory')
  if (!world) throw new Error('Dossier world absent du serveur')

  const statsDir = (await listDir(serverId, key, world.id, 'stats')).find(
    (entry) => entry.name === 'stats' && entry.type === 'directory',
  )
  // Monde neuf: personne ne s'est encore connecte.
  const files = statsDir
    ? (await listDir(serverId, key, statsDir.id)).filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
    : []

  const fileNamed = (name: string) => root.find((entry) => entry.name === name)
  const usercache = fileNamed('usercache.json')
  const names = usercache
    ? await readJson<{ uuid?: string; name?: string }[]>(serverId, key, usercache.id).catch(() => [])
    : []
  const forgeCache = fileNamed('usernamecache.json')
  const forgeNames = forgeCache
    ? await readJson<Record<string, string>>(serverId, key, forgeCache.id).catch(() => ({}))
    : {}

  // ponytail: sequentiel, ~0,5 s par joueur; a paralleliser par lots si le serveur depasse la vingtaine.
  const players: PlayerStats[] = []
  for (const file of files) {
    const uuid = file.name.replace(/\.json$/, '')
    const known = nameFor(uuid, names, forgeNames)
    const name = known === uuid.slice(0, 8) ? ((await mojangName(uuid)) ?? known) : known
    players.push(summarizePlayer(uuid, name, await readJson(serverId, key, file.id)))
  }
  players.sort((a, b) => b.playTimeS - a.playTimeS)

  const data = { players, readAt: new Date().toISOString() }
  cache = { serverId, data, expiresAt: Date.now() + STATS_TTL_MS }
  return data
})
