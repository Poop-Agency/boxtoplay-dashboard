import { createServerFn } from '@tanstack/react-start'

import { promises as dns } from 'node:dns'

import { collectApiKeys, pickActiveService, type BtpService } from '@/lib/btp'
import { liveServerId, loadGistState } from '@/server/gist'

// =============================================================================
// Official BoxToPlay REST API — https://api.boxtoplay.com/docs
//
// Authenticated with a per-account API key, not the BOXTOPLAY_SESSION cookie
// the rest of this project juggles. Read-only here: server vitals only.
//
// The modpack catalog lives on the same API too, but it is unusable for the
// browser: one row per VERSION, pack and version names glued with no
// separator, and no artwork. See server/catalog.ts.
// =============================================================================

const BTP_API_BASE = 'https://api.boxtoplay.com/v1'
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const PTR_TIMEOUT_MS = 2_000
const REQUEST_TIMEOUT_MS = 15_000
// Measured quota: 120 requests / 60s, plus a burst ceiling on top of it.
// A 30s TTL keeps the dashboard nowhere near either limit.
const VITALS_CACHE_TTL_MS = 30_000

interface BtpEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
  request_id?: string
}

interface BtpServiceList {
  services?: BtpService[]
  next_cursor?: string | null
}

interface BtpServiceDetail extends BtpService {
  connection_address?: string
  installed_modpack?: { id?: string; name?: string; provider?: string } | null
}

/**
 * Un compte, son essai vivant s'il en a un. La rotation alterne entre deux
 * comptes: ne montrer que l'actif cache justement l'information qui dit si la
 * releve est possible.
 */
export interface AccountTrial {
  /** Rang de la cle, donc rang du compte dans le Gist. */
  index: number
  displayId: number | null
  expiresAt: string | null
  /** Ce compte porte-t-il le serveur qui sert en ce moment ? */
  isLive: boolean
}

export interface ServerVitals {
  serverId: string
  displayId: number | null
  connectionAddress: string | null
  expiresAt: string | null
  installedModpack: string | null
  modpackProvider: string | null
  fleet: AccountTrial[]
}

export const btpFetch = async <T>(
  path: string,
  params?: Record<string, string>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  apiKey?: string,
): Promise<T> => {
  const key = apiKey ?? collectApiKeys(process.env)[0]

  if (!key) {
    throw new Error('Missing BTP_API_KEY (https://www.boxtoplay.com/profile/api-keys)')
  }

  const url = new URL(`${BTP_API_BASE}${path}`)
  for (const [name, value] of Object.entries(params ?? {})) {
    url.searchParams.set(name, value)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const payload = (await response.json().catch(() => ({}))) as BtpEnvelope<T>

  // The API does return application errors as HTTP 200 with success:false.
  if (!response.ok || payload.success === false) {
    const detail = payload.error?.code ?? response.status
    throw new Error(`BoxToPlay API ${path} failed: ${detail}`)
  }

  return (payload.data ?? {}) as T
}

/**
 * `connection_address` remonte tantot `mc301.boxtoplay.com:27452`, tantot une
 * IP nue `144.76.61.111:27452`. Une IP ne veut rien dire pour un joueur et
 * change a chaque rotation; le PTR rend le nom que le panel affiche. C'est la
 * meme deduction que fait le worker pour trouver l'hote FTP.
 */
async function resolveHostname(address: string | null): Promise<string | null> {
  if (!address) return null

  const [host, port] = address.split(':')
  if (!IPV4.test(host)) return address

  try {
    const names = await Promise.race([
      dns.reverse(host),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('PTR timeout')), PTR_TIMEOUT_MS),
      ),
    ])
    const name = names[0]
    if (!name) return address
    return port ? `${name}:${port}` : name
  } catch {
    // Pas de PTR: l'IP reste utilisable, elle est juste moins parlante.
    return address
  }
}

let vitalsCache: { data: ServerVitals; key: string; expiresAt: number } | null = null

let vitalsInFlight: Promise<{ data: ServerVitals; key: string }> | null = null

/**
 * Les vitals, et la cle du compte qui porte le serveur vivant. Stats,
 * historique et alias la demandent tous au chargement de la page: une seule
 * releve en vol pour tous, sinon quatre balayages des deux comptes partent en
 * rafale sur le quota que partagent le worker et le bot.
 */
async function loadVitals(): Promise<{ data: ServerVitals; key: string }> {
  if (vitalsCache && vitalsCache.expiresAt > Date.now()) {
    return vitalsCache
  }

  vitalsInFlight ??= fetchVitals().finally(() => {
    vitalsInFlight = null
  })
  return vitalsInFlight
}

async function fetchVitals(): Promise<{ data: ServerVitals; key: string }> {

  const keys = collectApiKeys(process.env)

  if (keys.length === 0) {
    throw new Error('Missing BTP_API_KEY (https://www.boxtoplay.com/profile/api-keys)')
  }

  // One key per account: the live server is on whichever account the rotation
  // last landed on, so both are listed and the live one picked across them.
  const owners = new Map<string, string>()
  const services: BtpService[] = []
  const byAccount: BtpService[][] = []
  for (const key of keys) {
    const list = await btpFetch<BtpServiceList>('/services/minecraft', { limit: '50' }, REQUEST_TIMEOUT_MS, key)
    const own = list.services ?? []
    byAccount.push(own)
    for (const service of own) {
      owners.set(service.id, key)
      services.push(service)
    }
  }

  // Le Gist fait foi sur le serveur qui sert: worker.py l'y ecrit a chaque
  // bascule et s'en sert lui-meme pour savoir qui tient `orny`. Sans lui,
  // pickActiveService retombe sur "expiration la plus tardive", qui designe
  // l'essai le PLUS RECENT -- donc celui du compte cible des qu'un essai a ete
  // achete sans bascule, ce qui est justement l'etat entre deux rotations.
  // Symptome observe le 2026-08-29: l'ecran montrait #956446 `stopped` et le
  // declarait hors ligne, alors que #956437 servait des joueurs.
  let wanted = ''
  try {
    wanted = liveServerId(await loadGistState())
  } catch (error) {
    console.warn('Gist illisible, repli sur BOXTOPLAY_SERVER_ID:', error)
  }
  if (!wanted) {
    wanted = (process.env.BOXTOPLAY_SERVER_ID ?? '').trim()
  }

  const active = pickActiveService(services, wanted)

  if (!active) {
    throw new Error('No Minecraft service on these BoxToPlay accounts')
  }

  const key = owners.get(active.id) ?? keys[0]
  const detail = await btpFetch<BtpServiceDetail>(`/services/minecraft/${active.id}`, undefined, REQUEST_TIMEOUT_MS, key)

  // Chaque compte traine ses essais morts: on ne retient que le vivant le plus
  // tardif, celui que le worker verrait.
  const now = Date.now()
  const fleet: AccountTrial[] = byAccount.map((own, index) => {
    const alive = own.filter((service) => {
      const at = Date.parse(service.expires_at ?? '')
      return !Number.isNaN(at) && at > now
    })
    const best = alive.reduce<BtpService | null>((latest, service) => {
      if (!latest) return service
      return Date.parse(service.expires_at ?? '') > Date.parse(latest.expires_at ?? '') ? service : latest
    }, null)

    return {
      index,
      displayId: typeof best?.display_id === 'number' ? best.display_id : null,
      expiresAt: best?.expires_at ?? null,
      isLive: best?.id === active.id,
    }
  })

  const vitals: ServerVitals = {
    serverId: active.id,
    displayId: typeof detail.display_id === 'number' ? detail.display_id : null,
    connectionAddress: await resolveHostname(detail.connection_address ?? null),
    expiresAt: detail.expires_at ?? null,
    installedModpack: detail.installed_modpack?.name ?? null,
    modpackProvider: detail.installed_modpack?.provider ?? null,
    fleet,
  }

  vitalsCache = { data: vitals, key, expiresAt: Date.now() + VITALS_CACHE_TTL_MS }
  return vitalsCache
}

export const getServerVitals = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ServerVitals> => (await loadVitals()).data,
)

// https://api.boxtoplay.com/docs#tag/minecraft/GET/services/minecraft/{serverId}/metrics
interface BtpMetrics {
  players_online?: number
  players_max?: number
  /** cpu_usage_percent deja ramene sur cpu_threads: le chiffre du panel. */
  display_cpu_usage_percent?: number
  memory_usage_mb?: number
  display_memory_limit_mb?: number
  disk_used_bytes?: number
}

export interface ServerStats {
  runtimeStatus: string
  playersOnline: number
  playersMax: number
  players: string[]
  cpuPercent: number
  memoryMb: number
  memoryLimitMb: number
  diskBytes: number
}

// L'ecran relit toutes les 10 s, et les cles sont partagees avec le worker et
// le bot sous le meme quota (120 req / 60 s). Le cache borne la charge a trois
// requetes par tranche de 10 s, quel que soit le nombre d'onglets ouverts.
// ponytail: cache par instance serverless, un store partage si le trafic grossit.
const STATS_CACHE_TTL_MS = 10_000
let statsCache: { data: ServerStats; expiresAt: number } | null = null

export const getServerStats = createServerFn({ method: 'GET' }).handler(async (): Promise<ServerStats> => {
  if (statsCache && statsCache.expiresAt > Date.now()) {
    return statsCache.data
  }

  const { data: vitals, key } = await loadVitals()
  const path = `/services/minecraft/${vitals.serverId}`
  const [status, metrics, online] = await Promise.all([
    btpFetch<{ runtime_status?: string }>(`${path}/status`, undefined, REQUEST_TIMEOUT_MS, key),
    // Un serveur arrete ne mesure rien: son etat doit s'afficher quand meme.
    btpFetch<BtpMetrics>(`${path}/metrics`, undefined, REQUEST_TIMEOUT_MS, key).catch((): BtpMetrics => ({})),
    btpFetch<{ players?: { name?: string }[] }>(`${path}/players/online`, undefined, REQUEST_TIMEOUT_MS, key).catch(
      () => ({ players: [] }),
    ),
  ])

  const stats: ServerStats = {
    runtimeStatus: status.runtime_status ?? 'unknown',
    playersOnline: metrics.players_online ?? 0,
    playersMax: metrics.players_max ?? 0,
    players: (online.players ?? []).map((player) => player.name ?? '').filter(Boolean),
    cpuPercent: metrics.display_cpu_usage_percent ?? 0,
    memoryMb: metrics.memory_usage_mb ?? 0,
    memoryLimitMb: metrics.display_memory_limit_mb ?? 0,
    diskBytes: metrics.disk_used_bytes ?? 0,
  }

  statsCache = { data: stats, expiresAt: Date.now() + STATS_CACHE_TTL_MS }
  return stats
})

// https://api.boxtoplay.com/docs#tag/minecraft/GET/services/minecraft/{serverId}/metrics/history
interface BtpHistorySample {
  sampled_at?: string
  players_peak?: number
  /** Deja au chiffre du panel: 1 quand /metrics rend 50 brut sur 32 threads. */
  cpu_usage_percent_average?: number
  memory_used_bytes_average?: number
  memory_limit_bytes?: number
}

export interface HistoryPoint {
  at: string
  players: number
  cpuPercent: number
  memoryBytes: number
  memoryLimitBytes: number
}

// `day` rend un point toutes les 30 min depuis le lancement, soit l'essai
// entier; `hour` n'en rend que deux. Rien de neuf avant 30 min: 5 min de cache.
const HISTORY_CACHE_TTL_MS = 5 * 60_000
let historyCache: { serverId: string; data: HistoryPoint[]; expiresAt: number } | null = null

export const getServerHistory = createServerFn({ method: 'GET' }).handler(async (): Promise<HistoryPoint[]> => {
  const { data: vitals, key } = await loadVitals()

  if (historyCache && historyCache.serverId === vitals.serverId && historyCache.expiresAt > Date.now()) {
    return historyCache.data
  }

  const data = await btpFetch<{ history?: BtpHistorySample[] }>(
    `/services/minecraft/${vitals.serverId}/metrics/history`,
    { timeframe: 'day' },
    REQUEST_TIMEOUT_MS,
    key,
  )

  const points = (data.history ?? []).flatMap((sample): HistoryPoint[] =>
    sample.sampled_at
      ? [
          {
            at: sample.sampled_at,
            players: sample.players_peak ?? 0,
            cpuPercent: sample.cpu_usage_percent_average ?? 0,
            memoryBytes: sample.memory_used_bytes_average ?? 0,
            memoryLimitBytes: sample.memory_limit_bytes ?? 0,
          },
        ]
      : [],
  )

  historyCache = { serverId: vitals.serverId, data: points, expiresAt: Date.now() + HISTORY_CACHE_TTL_MS }
  return points
})
