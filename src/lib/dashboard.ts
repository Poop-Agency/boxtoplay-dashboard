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
 * Heure de la prochaine rotation, meme regle que le bot (boxtoplay-bot/rotation.js):
 * 2h30 avant la mort de l'essai, sinon derniere rotation + 10h; les deux
 * connues, la plus tot. C'est le bot qui la declenche, le cron GitHub (qui
 * derive de plusieurs heures) n'est plus qu'un filet.
 */
export const ROTATION_LEAD_MS = 2.5 * 60 * 60 * 1000
export const ROTATE_AGE_MS = 10 * 60 * 60 * 1000

export function nextRotationAt(expiresAt: string | null, lastRotationAt: string | null): Date | null {
  const candidates = [
    Date.parse(expiresAt ?? '') - ROTATION_LEAD_MS,
    Date.parse(lastRotationAt ?? '') + ROTATE_AGE_MS,
  ].filter(Number.isFinite)
  return candidates.length ? new Date(Math.min(...candidates)) : null
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
 * Avancement d'un run en cours, d'apres progress.json du worker. Seulement si
 * le fichier parle de CE run: un reste d'une rotation passee ne compte pas.
 */
export function runProgress(
  run: { id: number; status: string },
  progress: { run_id?: string; step?: number; total?: number; label?: string } | null,
): string | null {
  if (!progress || run.status !== 'in_progress' || String(run.id) !== String(progress.run_id)) return null
  if (!progress.step || progress.step < 1) return null
  return `${progress.step}/${progress.total ?? 5} · ${progress.label ?? ''}`.trim()
}
