import { describe, expect, it } from 'vitest'

import { SESSION_TTL_S, createSessionToken, isValidSessionToken, passwordMatches, readCookie } from './auth'

const PASSWORD = 'correct horse battery staple'
const NOW = Date.parse('2026-09-17T12:00:00Z')

describe('passwordMatches', () => {
  it('accepts the exact password only', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true)
    expect(passwordMatches('wrong', PASSWORD)).toBe(false)
  })

  it('rejects everything when no password is configured', () => {
    expect(passwordMatches('', '')).toBe(false)
  })
})

describe('isValidSessionToken', () => {
  const token = createSessionToken(PASSWORD, NOW)

  it('accepts a fresh token', () => {
    expect(isValidSessionToken(token, PASSWORD, NOW)).toBe(true)
  })

  it('rejects an expired token', () => {
    expect(isValidSessionToken(token, PASSWORD, NOW + SESSION_TTL_S * 1000 + 1)).toBe(false)
  })

  it('rejects a token whose expiry was pushed back', () => {
    const [, signature] = token.split('.')
    expect(isValidSessionToken(`9999999999.${signature}`, PASSWORD, NOW)).toBe(false)
  })

  it('rejects a forged or malformed token', () => {
    const [expiresAt] = token.split('.')
    expect(isValidSessionToken(`${expiresAt}.forged`, PASSWORD, NOW)).toBe(false)
    expect(isValidSessionToken('garbage', PASSWORD, NOW)).toBe(false)
    expect(isValidSessionToken(undefined, PASSWORD, NOW)).toBe(false)
  })

  it('invalidates sessions when the password changes', () => {
    expect(isValidSessionToken(token, 'new password', NOW)).toBe(false)
  })
})

describe('readCookie', () => {
  it('finds the named cookie among others', () => {
    expect(readCookie('a=1; btp_session=abc.def; b=2', 'btp_session')).toBe('abc.def')
    expect(readCookie('a=1', 'btp_session')).toBeUndefined()
    expect(readCookie(null, 'btp_session')).toBeUndefined()
  })
})
