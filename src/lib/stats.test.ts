import { describe, expect, it } from 'vitest'

import { formatPlayTime, nameFor, prettyEntity, summarizePlayer, totals } from './stats'

// Extrait reel de world/stats/8d42d203-....json (#957574, 2026-09-24).
const RAW = {
  stats: {
    'minecraft:custom': {
      'minecraft:deaths': 41,
      'minecraft:play_time': 7237795,
      'minecraft:mob_kills': 11145,
      'minecraft:player_kills': 8,
      'minecraft:walk_one_cm': 9085967,
      'minecraft:sprint_one_cm': 914033,
      'minecraft:jump': 32375,
    },
    'minecraft:mined': { 'minecraft:stone': 1200, 'minecraft:dirt': 300 },
    'minecraft:killed_by': { 'minecraft:zombie': 3, 'minecraft:creeper': 9 },
  },
}

describe('summarizePlayer', () => {
  const player = summarizePlayer('8d42d203', 'Uxy_', RAW)

  it('converts ticks to seconds', () => {
    expect(player.playTimeS).toBe(361890)
    expect(formatPlayTime(player.playTimeS)).toBe('100h 31min')
  })

  it('reads deaths and kills', () => {
    expect(player.deaths).toBe(41)
    expect(player.mobKills).toBe(11145)
    expect(player.playerKills).toBe(8)
  })

  it('adds every travel mode into kilometers', () => {
    expect(player.distanceKm).toBeCloseTo(100, 5)
  })

  it('sums mined blocks and finds the deadliest mob', () => {
    expect(player.blocksMined).toBe(1500)
    expect(player.topKiller).toEqual({ name: 'Creeper', count: 9 })
  })

  it('survives an empty file', () => {
    const empty = summarizePlayer('x', 'Nobody', {})
    expect(empty).toMatchObject({ playTimeS: 0, deaths: 0, distanceKm: 0, topKiller: null })
  })
})

describe('helpers', () => {
  it('prettifies modded entity ids', () => {
    expect(prettyEntity('alexsmobs:grizzly_bear')).toBe('Grizzly bear')
  })

  it('falls back to the uuid prefix without usercache entry', () => {
    expect(nameFor('d458901b-93b0', [{ uuid: 'other', name: 'Steve' }])).toBe('d458901b')
    expect(nameFor('other', [{ uuid: 'other', name: 'Steve' }])).toBe('Steve')
  })

  it('uses the Forge name cache once usercache forgot the player', () => {
    expect(nameFor('d458901b-93b0', [], { 'd458901b-93b0': 'Alex' })).toBe('Alex')
  })

  it('names PvP deaths', () => {
    expect(prettyEntity('minecraft:player')).toBe('Un joueur')
  })

  it('totals the server', () => {
    const p = summarizePlayer('a', 'A', RAW)
    expect(totals([p, p])).toMatchObject({ players: 2, deaths: 82 })
  })

  it('formats short sessions in minutes', () => {
    expect(formatPlayTime(720)).toBe('12min')
  })
})
