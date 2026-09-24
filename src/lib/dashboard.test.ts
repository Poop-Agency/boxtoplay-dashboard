import { describe, expect, it } from 'vitest'

import {
  formatDisk,
  formatMemory,
  formatRemaining,
  formatWorkflowState,
  getWorkflowTone,
  loadSignal,
  nextRotationAt,
  niceCeil,
  trialFraction,
  trialSignal,
  workflowSignal,
  runProgress,
} from './dashboard'

// Releve reel /metrics du 2026-09-11 sur #957036 (ATM9, 0 joueur).
describe('server stats formatting', () => {
  it('formats memory like the panel, base 1024', () => {
    expect(formatMemory(9097, 22528)).toBe('8.9 / 22.0 Go')
    expect(formatMemory(9097, 0)).toBe('8.9 Go')
  })

  it('formats disk usage in Go', () => {
    expect(formatDisk(9959583744)).toBe('9.3 Go')
  })

  it('warns at 75 % load and faults at 90 %', () => {
    expect(loadSignal(9097 / 22528)).toBe('live')
    expect(loadSignal(0.75)).toBe('warn')
    expect(loadSignal(0.95)).toBe('fault')
  })

  it('rounds chart scales up to 1, 2 or 5 x 10^n, never below the floor', () => {
    expect(niceCeil(0, 10)).toBe(10)
    expect(niceCeil(3, 4)).toBe(5)
    expect(niceCeil(12, 10)).toBe(20)
    expect(niceCeil(23, 10)).toBe(50)
    expect(niceCeil(60, 10)).toBe(100)
  })
})

describe('getWorkflowTone', () => {
  it('returns success when a run completed successfully', () => {
    expect(getWorkflowTone('completed', 'success')).toBe('success')
  })

  it('returns info when a run is in progress', () => {
    expect(getWorkflowTone('in_progress', null)).toBe('info')
  })

  it('returns muted when a run is queued', () => {
    expect(getWorkflowTone('queued', null)).toBe('muted')
  })

  it('returns danger for failed states', () => {
    expect(getWorkflowTone('completed', 'failure')).toBe('danger')
  })
})

describe('formatWorkflowState', () => {
  it('prefers conclusion for completed runs', () => {
    expect(formatWorkflowState('completed', 'cancelled')).toBe('cancelled')
  })

  it('falls back to status for non-completed runs', () => {
    expect(formatWorkflowState('in_progress', null)).toBe('in_progress')
  })
})

describe('workflowSignal', () => {
  it('reads a successful run as live', () => {
    expect(workflowSignal('completed', 'success')).toBe('live')
  })

  it('keeps a skipped run neutral: the guard refusing a slot is not a fault', () => {
    expect(workflowSignal('completed', 'skipped')).toBe('idle')
    expect(workflowSignal('completed', 'cancelled')).toBe('idle')
  })

  it('reads a failed run as a fault', () => {
    expect(workflowSignal('completed', 'failure')).toBe('fault')
  })

  it('marks a running rotation, and leaves a queued one idle', () => {
    expect(workflowSignal('in_progress', null)).toBe('warn')
    expect(workflowSignal('queued', null)).toBe('idle')
  })
})

describe('nextRotationAt', () => {
  it('rotates 2h30 before the trial dies', () => {
    expect(nextRotationAt('2026-09-24T23:43:19Z', '2026-09-24T12:06:38Z')?.toISOString()).toBe('2026-09-24T21:13:19.000Z')
  })

  it('falls back to last rotation + 10h', () => {
    expect(nextRotationAt(null, '2026-09-22T17:25:38Z')?.toISOString()).toBe('2026-09-23T03:25:38.000Z')
  })

  it('never lets a stale expiry push past last rotation + 10h', () => {
    expect(nextRotationAt('2026-09-26T00:00:00Z', '2026-09-24T12:00:00Z')?.toISOString()).toBe('2026-09-24T22:00:00.000Z')
  })

  it('has nothing to point at without dates', () => {
    expect(nextRotationAt(null, null)).toBeNull()
  })
})

describe('trialFraction', () => {
  const now = Date.parse('2026-08-29T09:00:00Z')

  it('is full on a fresh twelve-hour trial', () => {
    expect(trialFraction('2026-08-29T21:00:00Z', now)).toBe(1)
  })

  it('halves at six hours left', () => {
    expect(trialFraction('2026-08-29T15:00:00Z', now)).toBeCloseTo(0.5, 5)
  })

  it('empties rather than filling when the source is missing or expired', () => {
    expect(trialFraction(null, now)).toBe(0)
    expect(trialFraction('nonsense', now)).toBe(0)
    expect(trialFraction('2026-08-29T08:00:00Z', now)).toBe(0)
  })

  it('clamps a trial longer than the assumed lifetime', () => {
    expect(trialFraction('2026-08-30T09:00:00Z', now)).toBe(1)
  })
})

describe('trialSignal', () => {
  const now = Date.parse('2026-08-29T09:00:00Z')

  it('warns before the number looks alarming', () => {
    expect(trialSignal('2026-08-29T10:30:00Z', now)).toBe('warn')
    expect(trialSignal('2026-08-29T12:00:00Z', now)).toBe('live')
  })

  it('faults once expired', () => {
    expect(trialSignal('2026-08-29T08:59:00Z', now)).toBe('fault')
  })

  it('stays idle without a date', () => {
    expect(trialSignal(null, now)).toBe('idle')
  })
})

describe('formatRemaining', () => {
  const now = Date.parse('2026-08-29T09:00:00Z')

  it('pads minutes so the reading does not jump width', () => {
    expect(formatRemaining('2026-08-29T17:47:00Z', now)).toBe('8h 47m')
    expect(formatRemaining('2026-08-29T17:05:00Z', now)).toBe('8h 05m')
  })

  it('drops the hour below one', () => {
    expect(formatRemaining('2026-08-29T09:12:00Z', now)).toBe('12m')
  })

  it('names an expired trial rather than showing a negative', () => {
    expect(formatRemaining('2026-08-29T08:00:00Z', now)).toBe('expiré')
  })
})

describe('runProgress', () => {
  const progress = { run_id: '42', step: 4, total: 5, label: 'Transfert du monde (coupure)' }

  it('affiche la phase du run en cours', () => {
    expect(runProgress({ id: 42, status: 'in_progress' }, progress)).toBe('4/5 · Transfert du monde (coupure)')
  })

  it('ignore un autre run, un run fini, un echec et un fichier absent', () => {
    expect(runProgress({ id: 41, status: 'in_progress' }, progress)).toBeNull()
    expect(runProgress({ id: 42, status: 'completed' }, progress)).toBeNull()
    expect(runProgress({ id: 42, status: 'in_progress' }, { ...progress, step: 0 })).toBeNull()
    expect(runProgress({ id: 42, status: 'in_progress' }, null)).toBeNull()
  })
})
