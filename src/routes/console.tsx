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
import { MAX_COMMAND_LENGTH, commandError, destructiveVerb, normalizeCommand } from '@/lib/console'
import { sendConsoleCommand } from '@/server/console'
import { requireSession } from '@/server/session'

export const Route = createFileRoute('/console')({
  beforeLoad: requireSession,
  component: ConsolePage,
})

interface Entry {
  id: number
  command: string
  output?: string
  error?: string
  truncated?: boolean
}

// L'historique ne vit que dans l'onglet: le serveur ne garde rien, et une
// commande rejouee au rechargement serait une commande envoyee sans le vouloir.
function ConsolePage() {
  const [draft, setDraft] = React.useState('')
  const [entries, setEntries] = React.useState<Entry[]>([])
  const [confirming, setConfirming] = React.useState<string | null>(null)
  // -1 = en train de taper; sinon rang dans l'historique remonte au clavier.
  const [recall, setRecall] = React.useState(-1)
  const transcript = React.useRef<HTMLDivElement>(null)
  const nextId = React.useRef(0)

  const sent = React.useMemo(() => entries.map((entry) => entry.command), [entries])

  const run = useMutation({
    mutationFn: (command: string) => sendConsoleCommand({ data: { command } }),
    onMutate: (command) => {
      const id = nextId.current++
      setEntries((list) => [...list, { id, command }])
      return { id }
    },
    onSuccess: (result, _command, context) => {
      setEntries((list) =>
        list.map((entry) =>
          entry.id === context?.id
            ? { ...entry, output: result.output, truncated: result.truncated }
            : entry,
        ),
      )
    },
    onError: (error, _command, context) => {
      const message = error instanceof Error ? error.message : 'Commande refusée'
      setEntries((list) =>
        list.map((entry) => (entry.id === context?.id ? { ...entry, error: message } : entry)),
      )
    },
  })

  // Le nouveau resultat doit etre visible sans faire defiler a la main.
  React.useEffect(() => {
    const node = transcript.current
    if (node) node.scrollTop = node.scrollHeight
  }, [entries])

  const submit = () => {
    const problem = commandError(draft)
    if (problem) return

    const command = normalizeCommand(draft)
    if (destructiveVerb(command)) {
      setConfirming(command)
      return
    }

    setDraft('')
    setRecall(-1)
    run.mutate(command)
  }

  const confirm = () => {
    if (!confirming) return
    setDraft('')
    setRecall(-1)
    run.mutate(confirming)
    setConfirming(null)
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
        note="Commandes envoyées au serveur qui sert en ce moment, par l'API BoxToPlay. Le « / » est facultatif."
      />

      <Panel
        title="Terminal"
        note={`${entries.length} commande${entries.length > 1 ? 's' : ''} dans cette session · ↑ et ↓ rappellent les précédentes`}
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div
            ref={transcript}
            className="recess h-[46vh] min-h-56 overflow-y-auto rounded-[2px] p-3.5"
            role="log"
            aria-live="polite"
            aria-label="Sortie de la console"
          >
            {entries.length === 0 ? (
              <p className="readout text-xs text-ink-label">
                Rien encore. « list » dit qui est connecté.
              </p>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div key={entry.id}>
                    <p className="readout text-xs text-ink">
                      <span className="text-ink-label">&gt; </span>
                      {entry.command}
                    </p>
                    {entry.error !== undefined ? (
                      <p className="readout mt-1 flex items-start gap-2 text-xs text-ink-dim">
                        <Lamp signal="fault" className="mt-1" />
                        <span className="whitespace-pre-wrap break-words">{entry.error}</span>
                      </p>
                    ) : entry.output === undefined ? (
                      <p className="readout mt-1 text-xs text-ink-label">Envoi…</p>
                    ) : (
                      <p className="readout mt-1 whitespace-pre-wrap break-words text-xs text-ink-dim">
                        {entry.output || 'Exécutée, sans réponse.'}
                        {entry.truncated && (
                          <span className="text-ink-label"> … (réponse tronquée)</span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
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
            <AlertDialogAction className="raise rounded-[2px] text-fault hover:bg-edge" onClick={confirm}>
              Envoyer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
