import { describe, expect, it } from 'vitest'

import { classifyBackups, groupByDay, isBackupStale, isRotationBackup } from './backups'

const file = (name: string, createdTime: string, isFinal = false) => ({
  name,
  createdTime,
  isFinal,
})

describe('isRotationBackup', () => {
  it('reconnait le nom horodate produit depuis le 2026-09-02', () => {
    expect(isRotationBackup('world_20260913_004551Z.zip')).toBe(true)
    expect(isRotationBackup('world_20260905_173150Z.zip')).toBe(true)
  })

  it('reconnait encore l ancien nom unique', () => {
    expect(isRotationBackup('minecraft_world_backup.zip')).toBe(true)
  })

  it('ne prend pas un point de restauration pour une rotation', () => {
    expect(isRotationBackup('final_backup_Star_Technology_20251206_1700.zip')).toBe(false)
    expect(isRotationBackup('final_backup_Monifactory_20251125_2132.zip')).toBe(false)
  })

  it('ne ramasse pas un zip quelconque nomme world', () => {
    expect(isRotationBackup('worldedit-schematics.zip')).toBe(false)
    expect(isRotationBackup('world_backup_perso.zip')).toBe(false)
  })
})

describe('classifyBackups', () => {
  it('rend les rotations de la plus recente a la plus ancienne', () => {
    const { rotations } = classifyBackups([
      file('world_20260911_113041Z.zip', '2026-09-11T11:30:41Z'),
      file('world_20260913_004551Z.zip', '2026-09-13T00:45:51Z'),
      file('world_20260912_011813Z.zip', '2026-09-12T01:18:13Z'),
    ])

    expect(rotations.map((r) => r.name)).toEqual([
      'world_20260913_004551Z.zip',
      'world_20260912_011813Z.zip',
      'world_20260911_113041Z.zip',
    ])
  })

  it('separe rotations et points de restauration', () => {
    const { rotations, restorePoints } = classifyBackups([
      file('world_20260913_004551Z.zip', '2026-09-13T00:45:51Z'),
      file('final_backup_Star_Technology_20251206_1700.zip', '2025-12-06T17:00:00Z', true),
    ])

    expect(rotations).toHaveLength(1)
    expect(restorePoints).toHaveLength(1)
    expect(restorePoints[0].name).toContain('final_backup')
  })

  it('ne classe pas une rotation en point de restauration meme si isFinal ment', () => {
    const { rotations, restorePoints } = classifyBackups([
      file('world_20260913_004551Z.zip', '2026-09-13T00:45:51Z', true),
    ])

    expect(rotations).toHaveLength(1)
    expect(restorePoints).toHaveLength(0)
  })
})

describe('groupByDay', () => {
  it('groupe par jour de Paris, jours recents en tete', () => {
    const days = groupByDay([
      file('world_20260912_114551Z.zip', '2026-09-12T11:45:51Z'),
      file('world_20260912_011813Z.zip', '2026-09-12T01:18:13Z'),
      // 23h30 UTC le 11 = 01h30 le 12 a Paris
      file('world_20260911_233000Z.zip', '2026-09-11T23:30:00Z'),
      file('world_20260911_113041Z.zip', '2026-09-11T11:30:41Z'),
    ])

    expect(days.map((d) => [d.day, d.files.length])).toEqual([
      ['2026-09-12', 3],
      ['2026-09-11', 1],
    ])
  })
})

describe('isBackupStale', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')

  it('signale une derniere archive trop vieille ou absente', () => {
    expect(isBackupStale('2026-09-12T11:45:51Z', now)).toBe(true)
    expect(isBackupStale(undefined, now)).toBe(true)
  })

  it('accepte une archive de la derniere rotation, meme en retard', () => {
    expect(isBackupStale('2026-09-17T01:30:00Z', now)).toBe(false)
  })
})
