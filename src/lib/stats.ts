// Statistiques joueurs, lues dans world/stats/<uuid>.json (format vanilla).
// Le fichier suit le monde d'une rotation a l'autre: ce sont les compteurs de
// toute la partie, pas de l'essai en cours. Minecraft les ecrit a chaque
// sauvegarde automatique et a la deconnexion, donc avec quelques minutes de
// retard sur un joueur connecte.

export interface PlayerStats {
  uuid: string
  name: string
  playTimeS: number
  deaths: number
  mobKills: number
  playerKills: number
  distanceKm: number
  blocksMined: number
  /** Mob qui a tue ce joueur le plus souvent, ou null s'il n'est jamais mort d'un mob. */
  topKiller: { name: string; count: number } | null
}

type Counters = Record<string, number>

interface VanillaStats {
  stats?: Record<string, Counters | undefined>
}

const sum = (counters: Counters | undefined, keep: (key: string) => boolean = () => true) =>
  Object.entries(counters ?? {}).reduce((total, [key, value]) => (keep(key) ? total + (Number(value) || 0) : total), 0)

/** `minecraft:ender_dragon` -> `Ender dragon`, `alexsmobs:grizzly_bear` -> `Grizzly bear`. */
export function prettyEntity(id: string): string {
  // killed_by compte aussi les morts en PvP.
  if (id === 'minecraft:player') return 'Un joueur'
  const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  const words = bare.replace(/[_/.]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : id
}

export function summarizePlayer(uuid: string, name: string, raw: VanillaStats): PlayerStats {
  const stats = raw.stats ?? {}
  const custom = stats['minecraft:custom'] ?? {}
  const killedBy = Object.entries(stats['minecraft:killed_by'] ?? {}).sort(([, a], [, b]) => b - a)[0]

  return {
    uuid,
    name,
    // play_time en ticks (20 par seconde); ancien nom play_one_minute avant 1.17.
    playTimeS: Math.round((custom['minecraft:play_time'] ?? custom['minecraft:play_one_minute'] ?? 0) / 20),
    deaths: custom['minecraft:deaths'] ?? 0,
    mobKills: custom['minecraft:mob_kills'] ?? 0,
    playerKills: custom['minecraft:player_kills'] ?? 0,
    // Tous les modes de deplacement comptent (marche, sprint, nage, elytres, bateau...).
    distanceKm: sum(custom, (key) => key.endsWith('_one_cm')) / 100_000,
    blocksMined: sum(stats['minecraft:mined']),
    topKiller: killedBy ? { name: prettyEntity(killedBy[0]), count: killedBy[1] } : null,
  }
}

/**
 * Pseudo d'apres usercache.json (vanilla, purge apres un mois sans connexion),
 * puis usernamecache.json (Forge, garde tout le monde); a defaut, le debut de l'UUID.
 */
export function nameFor(
  uuid: string,
  cache: { uuid?: string; name?: string }[],
  forgeCache: Record<string, string> = {},
): string {
  return cache.find((entry) => entry.uuid === uuid)?.name ?? forgeCache[uuid] ?? uuid.slice(0, 8)
}

export function totals(players: PlayerStats[]) {
  return {
    players: players.length,
    playTimeS: players.reduce((total, p) => total + p.playTimeS, 0),
    deaths: players.reduce((total, p) => total + p.deaths, 0),
    mobKills: players.reduce((total, p) => total + p.mobKills, 0),
  }
}

/** `361h 40min`, `12min`. Au-dela d'un jour les heures restent lisibles d'un coup d'oeil. */
export function formatPlayTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}min` : `${minutes}min`
}
