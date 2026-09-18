import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Lamp, PageHead, Panel } from '@/components/ui/instrument'
import {
  MAX_COMMAND_LENGTH,
  commandError,
  destructiveVerb,
  failureMessage,
  normalizeCommand,
  parseLogLine,
} from '@/lib/console'
import { getConsoleLog, sendConsoleCommand } from '@/server/console'
import { requireSession } from '@/server/session'

export const Route = createFileRoute('/console')({
  beforeLoad: requireSession,
  component: ConsolePage,
})

type LineKind = 'server' | 'sent' | 'output' | 'error'

interface Line {
  id: number
  kind: LineKind
  text: string
}

// Le flux live de BoxToPlay rend l'historique recent au premier appel, puis la
// suite par curseur. 4 s entre deux releves: le quota (120 req/60 s) est
// partage avec le worker et le bot, et la console n'a pas besoin d'etre plus
// vive que l'oeil.
const POLL_MS = 4_000
// Un chunk annonce parfois qu'il en reste: on enchaine sans attendre.
const CHASE_MS = 250
const RETRY_MS = 10_000
// De quoi remonter une rotation entiere sans faire ramer le DOM.
const MAX_LINES = 600

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Rouge une erreur, ambre un avertissement: la ligne entiere, elle ne parle
// que de ca. Sur une ligne ordinaire, seul le fil qui parle est colore -- c'est
// l'identite de la source, pas un etat, et c'est ce qui laisse balayer mille
// lignes sans les lire. L'horodatage et le nom du mod situent la ligne sans
// etre la nouvelle: ils restent en retrait.
const MESSAGE_TEXT = {
  error: 'text-fault',
  warn: 'text-warn',
  info: 'text-ink-dim',
  other: 'text-ink-dim',
} as const

const THREAD_TEXT = {
  error: 'text-fault',
  warn: 'text-warn',
  info: 'text-series-players',
  other: 'text-ink-label',
} as const

function ServerLine({ text }: { text: string }) {
  const line = parseLogLine(text)
  const aside = line.level === 'info' || line.level === 'other' ? 'text-ink-label' : MESSAGE_TEXT[line.level]

  return (
    <p className={`readout whitespace-pre-wrap break-words text-xs ${MESSAGE_TEXT[line.level]}`}>
      {line.time && <span className={aside}>[{line.time}] </span>}
      {line.thread && <span className={THREAD_TEXT[line.level]}>[{line.thread}] </span>}
      {line.source && <span className={aside}>[{line.source}]: </span>}
      {line.message}
    </p>
  )
}

// La console montre ce que le serveur raconte, comme le panel BoxToPlay, et y
// intercale ce qu'on lui envoie. L'historique des commandes d'avant vient donc
// du serveur lui-meme: rien n'est garde ici entre deux visites.
function ConsolePage() {
  const [draft, setDraft] = React.useState('')
  const [lines, setLines] = React.useState<Line[]>([])
  const [streamError, setStreamError] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState<string | null>(null)
  // -1 = en train de taper; sinon rang dans les commandes envoyees.
  const [recall, setRecall] = React.useState(-1)
  const [sent, setSent] = React.useState<string[]>([])
  const transcript = React.useRef<HTMLDivElement>(null)
  const nextId = React.useRef(0)

  const push = React.useCallback((kind: LineKind, texts: string[]) => {
    if (texts.length === 0) return
    setLines((list) => {
      const added = texts.map((text) => ({ id: nextId.current++, kind, text }))
      return [...list, ...added].slice(-MAX_LINES)
    })
  }, [])

  // Releve du flux live tant que la page est ouverte.
  React.useEffect(() => {
    let alive = true
    let cursor: string | undefined

    const follow = async () => {
      while (alive) {
        try {
          const chunk = await getConsoleLog({ data: { cursor } })
          if (!alive) return

          cursor = chunk.cursor ?? undefined
          // `reset`: le serveur a redemarre ou le curseur a expire. Ce qui est
          // affiche ne suit plus rien, on repart du chunk recu.
          if (chunk.reset) setLines([])
          push('server', chunk.lines)
          setStreamError(null)
          await sleep(chunk.hasMore ? CHASE_MS : POLL_MS)
        } catch (error) {
          if (!alive) return
          setStreamError(failureMessage(error instanceof Error ? error.message : 'Flux interrompu'))
          await sleep(RETRY_MS)
        }
      }
    }

    void follow()
    return () => {
      alive = false
    }
  }, [push])

  const run = useMutation({
    mutationFn: (command: string) => sendConsoleCommand({ data: { command } }),
    onMutate: (command) => {
      push('sent', [`> ${command}`])
      setSent((list) => [...list, command])
    },
    onSuccess: (result) => {
      if (result.output) push('output', result.output.split('\n'))
      if (result.truncated) push('output', ['… (réponse tronquée)'])
    },
    onError: (error) => {
      push('error', [failureMessage(error instanceof Error ? error.message : 'Commande refusée')])
    },
  })

  // Le flux colle au bas tant qu'on y est -- c'est la position par defaut, et
  // c'est la seule ou les nouvelles lignes se lisent. Remonter lache la prise,
  // redescendre la reprend: personne n'est ramene de force au bas pendant sa
  // lecture, et personne n'a a redescendre a la main apres.
  const stuck = React.useRef(true)

  const onScroll = () => {
    const node = transcript.current
    if (node) stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40
  }

  React.useEffect(() => {
    const node = transcript.current
    if (node && stuck.current) node.scrollTop = node.scrollHeight
  }, [lines])

  const send = (command: string) => {
    setDraft('')
    setRecall(-1)
    run.mutate(command)
  }

  const submit = () => {
    if (commandError(draft)) return

    const command = normalizeCommand(draft)
    if (destructiveVerb(command)) {
      setConfirming(command)
      return
    }
    send(command)
  }

  // Fleches haut/bas: rappeler une commande deja envoyee plutot que la retaper.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (sent.length === 0) return
    event.preventDefault()

    const position =
      event.key === 'ArrowUp'
        ? Math.min(recall < 0 ? 0 : recall + 1, sent.length - 1)
        : recall - 1

    setRecall(position)
    setDraft(position < 0 ? '' : sent[sent.length - 1 - position])
  }

  const problem = draft.trim() ? commandError(draft) : null

  return (
    <div className="space-y-5">
      <PageHead
        title="Console"
        note="Ce que le serveur raconte en direct, et ce qu'on lui envoie. Le « / » est facultatif."
      />

      <Panel
        title="Terminal"
        note="Flux live du serveur qui sert en ce moment · ↑ et ↓ rappellent les commandes envoyées"
        aside={
          streamError ? (
            <span className="flex items-center gap-2 text-xs text-ink-dim">
              <Lamp signal="fault" />
              Flux interrompu
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs text-ink-label">
              <Lamp signal="live" />
              En direct
            </span>
          )
        }
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div
            ref={transcript}
            onScroll={onScroll}
            // La console est seule sur la page: elle prend la hauteur qui reste, sans
            // jamais deborder de l'ecran (marge = entete + barre de saisie).
            className="recess h-[calc(100vh-19rem)] min-h-56 overflow-y-auto rounded-[2px] p-3.5"
            role="log"
            aria-live="polite"
            aria-label="Console du serveur"
          >
            {lines.length === 0 ? (
              <p className="readout text-xs text-ink-label">
                {streamError ?? 'Lecture du flux…'}
              </p>
            ) : (
              <div className="space-y-0.5">
                {lines.map((line) =>
                  line.kind === 'server' ? (
                    <ServerLine key={line.id} text={line.text} />
                  ) : (
                    <p
                      key={line.id}
                      className={`readout whitespace-pre-wrap break-words text-xs ${
                        line.kind === 'error' ? 'text-fault' : 'text-ink'
                      }`}
                    >
                      {line.text}
                    </p>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_COMMAND_LENGTH + 1}
              placeholder="list"
              aria-label="Commande"
              className="recess readout w-full rounded-[2px] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-label focus:outline-none focus-visible:outline-2 focus-visible:outline-ink-dim"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!!problem || !draft.trim() || run.isPending}
              className="raise shrink-0 rounded-[2px] px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-edge disabled:opacity-40"
            >
              Envoyer
            </button>
          </div>

          {problem && <p className="text-xs text-fault">{problem}</p>}
        </div>
      </Panel>

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent className="panel border-edge-soft bg-panel text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-ink">
              Envoyer « {confirming} » ?
            </AlertDialogTitle>
            <AlertDialogDescription className="max-w-[68ch] text-sm text-ink-dim">
              Cette commande coupe le serveur, met quelqu'un dehors ou détruit du monde. La rotation
              ne la voit pas passer : un « stop » hors rotation laisse le Gist croire le serveur en
              ligne.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="raise rounded-[2px] border-0 text-ink hover:bg-edge">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              className="raise rounded-[2px] text-fault hover:bg-edge"
              onClick={() => {
                if (confirming) send(confirming)
                setConfirming(null)
              }}
            >
              Envoyer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
