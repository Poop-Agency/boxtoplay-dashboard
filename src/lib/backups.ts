/**
 * Tri des archives Drive.
 *
 * Depuis le 2026-09-02 (boxtoplay-v2 #29) chaque rotation depose son propre
 * fichier horodate `world_<AAAAMMJJ>_<HHMMSS>Z.zip`, purge a 7 jours. Avant,
 * le worker reecrivait toujours `minecraft_world_backup.zip` et l'historique
 * ne tenait qu'aux revisions Drive. Le dashboard filtrait encore sur l'ancien
 * nom: plus aucune sauvegarde de rotation n'apparaissait depuis 11 jours.
 */

export const LEGACY_ROTATION_FILE = 'minecraft_world_backup'

const STAMPED_ROTATION = /^world_\d{8}_\d{6}z\.zip$/

export function isRotationBackup(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes(LEGACY_ROTATION_FILE) || STAMPED_ROTATION.test(lower)
}

interface Sortable {
  name: string
  createdTime: string
  isFinal: boolean
}

/**
 * Separe les rotations (recentes d'abord) des points de restauration figes.
 * Un fichier ne peut pas etre les deux: `final_backup_*` reste un point de
 * restauration meme s'il contient un monde.
 */
export function classifyBackups<T extends Sortable>(files: T[]): {
  rotations: T[]
  restorePoints: T[]
} {
  const rotations = files
    .filter((file) => isRotationBackup(file.name))
    .sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())

  return {
    rotations,
    restorePoints: files.filter((file) => file.isFinal && !isRotationBackup(file.name)),
  }
}

/** Jour calendaire a Paris, `AAAA-MM-JJ`: les rotations de 01h UTC tombent le bon jour. */
export const parisDay = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })

/**
 * Regroupe les rotations par jour, du plus recent au plus ancien. 7 jours de
 * retention a ~3 rotations par jour faisaient une liste de 21 lignes.
 */
export function groupByDay<T extends Sortable>(rotations: T[]): { day: string; files: T[] }[] {
  const days = new Map<string, T[]>()
  for (const file of rotations) {
    const day = parisDay(file.createdTime)
    days.set(day, [...(days.get(day) ?? []), file])
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, files]) => ({ day, files }))
}

// Une rotation toutes les 8 h, et le cron GitHub derive jusqu'a ~5 h.
export const STALE_BACKUP_HOURS = 14

/**
 * Vrai si la derniere archive de rotation a plus de STALE_BACKUP_HOURS. Du
 * 2026-09-12 au 17 plus rien n'arrivait sur Drive et les runs restaient verts:
 * seule la date de la derniere archive le montrait.
 */
export const isBackupStale = (latestIso: string | undefined, now = Date.now()) =>
  !latestIso || now - new Date(latestIso).getTime() > STALE_BACKUP_HOURS * 3600_000
