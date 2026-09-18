import { describe, expect, it } from 'vitest'

import {
  MAX_COMMAND_LENGTH,
  commandError,
  destructiveVerb,
  failureMessage,
  normalizeCommand,
} from './console'

describe('normalizeCommand', () => {
  it('retire le slash du chat et les espaces', () => {
    expect(normalizeCommand('  /list  ')).toBe('list')
    expect(normalizeCommand('list')).toBe('list')
    expect(normalizeCommand('//op moi')).toBe('op moi')
  })
})

describe('commandError', () => {
  it('laisse passer une commande normale', () => {
    expect(commandError('tellraw @a {"text":"salut"}')).toBeNull()
  })

  it('refuse le vide, le trop long et les caractères de contrôle', () => {
    expect(commandError('   ')).toBe('Commande vide.')
    expect(commandError('/')).toBe('Commande vide.')
    expect(commandError('a'.repeat(MAX_COMMAND_LENGTH + 1))).toContain('trop longue')
    expect(commandError('say salut\nop moi')).toBe('Caractère de contrôle interdit.')
  })
})

describe('destructiveVerb', () => {
  it('reconnaît les commandes à confirmer, slash ou pas', () => {
    expect(destructiveVerb('stop')).toBe('stop')
    expect(destructiveVerb('/KILL @e')).toBe('kill')
    expect(destructiveVerb('  op EdouardSence ')).toBe('op')
  })

  it('laisse passer les commandes sans conséquence durable', () => {
    expect(destructiveVerb('list')).toBeNull()
    expect(destructiveVerb('time set day')).toBeNull()
    // Le verbe compte, pas le texte: `say stop` ne coupe rien.
    expect(destructiveVerb('say stop')).toBeNull()
  })
})

describe('failureMessage', () => {
  it('traduit une erreur de l’API en cause probable', () => {
    expect(
      failureMessage('BoxToPlay API /services/minecraft/btp_x/console/commands failed: 409'),
    ).toBe('BoxToPlay refuse la commande (409). Serveur éteint ou en rotation ?')
  })

  it('traduit le refus illisible d’une server function', () => {
    // Le middleware repousse l’appel, mais le framework rend ceci au client.
    expect(failureMessage('Seroval Error (step: 3)')).toContain('session expirée')
  })

  it('laisse passer un message déjà clair', () => {
    expect(failureMessage('Commande vide.')).toBe('Commande vide.')
  })
})
