import { describe, expect, it } from 'vitest'

import {
  formatDisk,
  formatMemory,
  formatOutlook,
  rotationOutlook,
  formatRemaining,
  formatWorkflowState,
  getWorkflowTone,
  loadSignal,
  nextRotationAt,
  trialFraction,
  trialSignal,
  workflowSignal,
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
  const at = (iso: string) => Date.parse(iso)

  it('picks the next slot later today', () => {
    expect(nextRotationAt(at('2026-08-29T09:12:00Z'))?.toISOString()).toBe('2026-08-29T15:00:00.000Z')
  })

  it('wraps to tomorrow once the last slot has passed', () => {
    expect(nextRotationAt(at('2026-08-29T23:30:00Z'))?.toISOString()).toBe('2026-08-30T07:00:00.000Z')
  })

  it('does not return the slot it is sitting exactly on', () => {
    expect(nextRotationAt(at('2026-08-29T15:00:00Z'))?.toISOString()).toBe('2026-08-29T23:00:00.000Z')
  })

  it('has nothing to point at without slots', () => {
    expect(nextRotationAt(at('2026-08-29T09:00:00Z'), [])).toBeNull()
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

describe('rotationOutlook', () => {
  const slot = new Date('2026-08-29T23:00:00Z')

  it('predicts a rotation when the trial dips under the guard', () => {
    // 03:51Z le lendemain => 4,85 h au creneau de 23:00Z, sous les 6 h.
    const out = rotationOutlook('2026-08-30T03:51:00Z', slot)
    expect(out.verdict).toBe('rotate')
    expect(out.hoursAtSlot).toBeCloseTo(4.85, 2)
  })

  it('predicts a skip while the trial still holds above the guard', () => {
    const out = rotationOutlook('2026-08-30T06:16:00Z', slot)
    expect(out.verdict).toBe('skip')
    expect(out.hoursAtSlot).toBeCloseTo(7.27, 2)
  })

  // Le cas qui compte: personne ne passe avant la mort de l'essai.
  it('flags a trial that dies before the worker even wakes', () => {
    const out = rotationOutlook('2026-08-29T21:00:00Z', slot)
    expect(out.verdict).toBe('expired')
    expect(out.hoursAtSlot).toBeCloseTo(-2, 5)
  })

  it('treats the guard boundary as a rotation, matching the worker', () => {
    // worker.py skippe sur `left > seuil`, donc pile 6 h tourne.
    const out = rotationOutlook('2026-08-30T05:00:00Z', slot)
    expect(out.verdict).toBe('rotate')
  })

  it('rotates whatever the life when the guard is disabled', () => {
    expect(rotationOutlook('2026-08-30T06:16:00Z', slot, 0).verdict).toBe('rotate')
  })

  it('stays unknown rather than guessing', () => {
    expect(rotationOutlook(null, slot).verdict).toBe('unknown')
    expect(rotationOutlook('2026-08-30T03:51:00Z', null).verdict).toBe('unknown')
    expect(rotationOutlook('pas une date', slot).verdict).toBe('unknown')
  })

  it('words each verdict without a negative duration', () => {
    expect(formatOutlook(rotationOutlook('2026-08-29T21:00:00Z', slot))).toContain('2.0 h avant')
    expect(formatOutlook(rotationOutlook(null, slot))).toBe('indeterminee')
  })
})
