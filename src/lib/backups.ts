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
