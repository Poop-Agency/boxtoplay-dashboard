import type { Signal } from '@/components/ui/instrument'

export type WorkflowBadgeTone = 'success' | 'danger' | 'info' | 'muted'

export function getWorkflowTone(status: string, conclusion: string | null): WorkflowBadgeTone {
  if (status === 'in_progress') {
    return 'info'
  }

  if (status === 'queued' || status === 'waiting' || status === 'requested') {
    return 'muted'
  }

  if (status === 'completed' && conclusion === 'success') {
    return 'success'
  }

  return 'danger'
}

export function formatWorkflowState(status: string, conclusion: string | null): string {
  if (status === 'completed' && conclusion) {
    return conclusion
  }

  return status
}

/**
 * Un run saute ("skipped") quand la garde anti-double-rotation refuse le
 * creneau, ou quand BoxToPlay refuse l'achat parce que l'essai precedent
 * respire encore. Ce n'est pas une panne, et le peindre en rouge apprend a
 * ignorer le rouge.
 */
export function workflowSignal(status: string, conclusion: string | null): Signal {
  if (status !== 'completed') {
    return status === 'in_progress' ? 'warn' : 'idle'
  }

  if (conclusion === 'success') return 'live'
  if (conclusion === 'skipped' || conclusion === 'cancelled') return 'idle'
  return 'fault'
}

/**
 * Les creneaux de rotation sont ceux du cron GitHub de schedule.yml, en UTC.
 * GitHub les tire souvent en retard (jusqu'a 4h20 observees le 2026-08-28):
 * l'heure rendue ici est la plus proche possible, pas une promesse.
 */
export const ROTATION_SLOTS_UTC = [7, 15, 23] as const

export function nextRotationAt(
  now: number = Date.now(),
  slots: readonly number[] = ROTATION_SLOTS_UTC,
): Date | null {
  if (slots.length === 0) return null

  const ordered = [...slots].sort((a, b) => a - b)
  const date = new Date(now)

  for (const hour of ordered) {
    const candidate = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0, 0),
    )
    if (candidate.getTime() > now) return candidate
  }

  // Tous les creneaux du jour sont passes: le premier de demain.
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, ordered[0], 0, 0, 0),
  )
}

/**
 * Part d'essai restante, 0 a 1, pour la jauge. Un essai BoxToPlay vit douze
 * heures (mesure le 2026-08-28); sans date d'expiration il n'y a rien a
 * dessiner et la jauge doit rester vide plutot que pleine.
 */
export const TRIAL_LIFETIME_MS = 12 * 60 * 60 * 1000

export function trialFraction(
  expiresAt: string | null,
  now: number = Date.now(),
  lifetimeMs: number = TRIAL_LIFETIME_MS,
): number {
  if (!expiresAt) return 0

  const target = Date.parse(expiresAt)
  if (Number.isNaN(target)) return 0

  const remaining = target - now
  if (remaining <= 0) return 0

  return Math.min(1, remaining / lifetimeMs)
}

/**
 * Sous deux heures l'essai devient le probleme le plus urgent de l'ecran, donc
 * la jauge change de signal avant que le nombre ne devienne alarmant.
 */
export function trialSignal(expiresAt: string | null, now: number = Date.now()): Signal {
  if (!expiresAt) return 'idle'

  const target = Date.parse(expiresAt)
  if (Number.isNaN(target)) return 'idle'

  const remainingMinutes = (target - now) / 60_000
  if (remainingMinutes <= 0) return 'fault'
  if (remainingMinutes <= 120) return 'warn'
  return 'live'
}

/** Duree restante, sans unite de langue: "8h 47m", "12m", "expiré". */
export function formatRemaining(expiresAt: string | null, now: number = Date.now()): string {
  if (!expiresAt) return '—'

  const target = Date.parse(expiresAt)
  if (Number.isNaN(target)) return '—'

  const minutes = Math.ceil((target - now) / 60_000)
  if (minutes <= 0) return 'expiré'

  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

/**
 * Base 1024, comme le panel: la limite remonte en 22528 MB, soit 22 Go pile.
 * Sans limite connue on n'affiche que la conso.
 */
export function formatMemory(usedMb: number, limitMb: number): string {
  const go = (mb: number) => (mb / 1024).toFixed(1)
  return limitMb > 0 ? `${go(usedMb)} / ${go(limitMb)} Go` : `${go(usedMb)} Go`
}

export function formatDisk(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`
}

/**
 * Jauge de charge CPU/RAM. Un pack moddé sature la RAM avant de crasher, donc
 * l'orange arrive a 75 % pour laisser le temps de reagir.
 */
export function loadSignal(fraction: number): Signal {
  if (fraction >= 0.9) return 'fault'
  if (fraction >= 0.75) return 'warn'
  return 'live'
}

/**
 * Haut d'echelle rond (1, 2, 5 x 10^n) pour les courbes. Le plancher evite
 * qu'un CPU a 1 % remplisse tout le graphe comme s'il saturait.
 */
export function niceCeil(value: number, floor: number): number {
  const target = Math.max(value, floor)
  const step = 10 ** Math.floor(Math.log10(target))
  for (const multiple of [1, 2, 5]) {
    if (multiple * step >= target) return multiple * step
  }
  return 10 * step
}

/**
 * Le worker refuse de tourner tant que le serveur actif tient encore plus de
 * ROTATION_SKIP_ABOVE_HOURS heures (defaut 6, cf. worker.py). Predire ce que
 * fera le prochain creneau evite d'aller lire les logs pour savoir si la nuit
 * tient.
 *
 * `expired` est le cas qui compte: l'essai meurt AVANT que le worker ne se
 * reveille, donc le serveur tombe sans que personne ne soit prevenu.
 */
export const ROTATION_SKIP_ABOVE_HOURS = 6

export type RotationVerdict = 'rotate' | 'skip' | 'expired' | 'unknown'

export interface RotationOutlook {
  verdict: RotationVerdict
  /** Heures de vie restantes AU MOMENT du creneau, negatif si deja mort. */
  hoursAtSlot: number | null
}

export function rotationOutlook(
  expiresAt: string | null,
  slot: Date | null,
  skipAboveHours: number = ROTATION_SKIP_ABOVE_HOURS,
): RotationOutlook {
  if (!expiresAt || !slot) return { verdict: 'unknown', hoursAtSlot: null }

  const target = Date.parse(expiresAt)
  if (Number.isNaN(target)) return { verdict: 'unknown', hoursAtSlot: null }

  const hoursAtSlot = (target - slot.getTime()) / 3_600_000

  if (hoursAtSlot <= 0) return { verdict: 'expired', hoursAtSlot }
  if (skipAboveHours > 0 && hoursAtSlot > skipAboveHours) return { verdict: 'skip', hoursAtSlot }
  return { verdict: 'rotate', hoursAtSlot }
}

export function outlookSignal(verdict: RotationVerdict): Signal {
  if (verdict === 'expired') return 'fault'
  if (verdict === 'rotate') return 'live'
  if (verdict === 'skip') return 'idle'
  return 'idle'
}

export function formatOutlook(outlook: RotationOutlook): string {
  const { verdict, hoursAtSlot } = outlook
  if (verdict === 'unknown' || hoursAtSlot === null) return 'indeterminee'

  const h = Math.abs(hoursAtSlot).toFixed(1)
  if (verdict === 'expired') return `l'essai meurt ${h} h avant le creneau`
  if (verdict === 'skip') return `sautee — il restera ${h} h, au-dessus du seuil`
  return `rotation — il restera ${h} h`
}
