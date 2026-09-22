import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster, toast } from 'sonner'

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

import { Fault, Gauge, Lamp, Panel, State, Well } from '@/components/ui/instrument'
import {
  formatDisk,
  formatMemory,
  formatOutlook,
  formatRemaining,
  formatWorkflowState,
  loadSignal,
  nextRotationAt,
  niceCeil,
  outlookSignal,
  rotationOutlook,
  runProgress,
  trialFraction,
  trialSignal,
  workflowSignal,
} from '@/lib/dashboard'
import { getServerHistory, getServerStats, getServerVitals } from '@/server/btp'
import { runAction } from '@/server/actions'
import type { ActionName } from '@/server/actions'
import { getGistState, getRecentWorkflows } from '@/server/dashboard'
import { hasSession } from '@/server/session'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

const ALIAS_HOST = 'orny.boxtoplay.com'

function DashboardPage() {
  // Le cache serveur est de 10 s: relire plus vite ne servirait a rien.
  const stats = useQuery({
    queryKey: ['server-stats'],
    queryFn: () => getServerStats(),
    refetchInterval: 10_000,
  })

  const history = useQuery({
    queryKey: ['server-history'],
    queryFn: () => getServerHistory(),
    refetchInterval: 5 * 60_000,
  })

  const vitals = useQuery({
    queryKey: ['server-vitals'],
    queryFn: () => getServerVitals(),
    refetchInterval: 60_000,
  })

  const rotation = useQuery({
    queryKey: ['gist-state'],
    queryFn: () => getGistState(),
    refetchInterval: 60_000,
  })

  const runs = useQuery({
    queryKey: ['recent-workflows'],
    queryFn: () => getRecentWorkflows(),
    refetchInterval: 30_000,
  })

  return (
    // Tient sur un ecran 1080p: pas d'en-tete de page (la sidebar le dit), et
    // aucune valeur affichee deux fois.
    <div className="space-y-4">
      <h1 className="sr-only">Tableau de bord</h1>

      <StatusBanner stats={stats} vitals={vitals} />

      <HistoryPanel history={history} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <RotationPanel rotation={rotation} vitals={vitals} />
        <RunLog runs={runs} progress={rotation.data?.progress ?? null} />
      </div>
      <Toaster position="top-right" theme="dark" />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Bandeau: la seule chose lisible de loin.
// -----------------------------------------------------------------------------

function StatusBanner({
  stats,
  vitals,
}: {
  stats: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getServerStats>>>>
  vitals: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getServerVitals>>>>
}) {
  // runtime_status fait foi, comme pour la presence du bot.
  const online = stats.data?.runtimeStatus === 'started'
  const signal = stats.isPending ? 'idle' : stats.isError ? 'warn' : online ? 'live' : 'fault'
  const expiresAt = vitals.data?.expiresAt ?? null
  const host = vitals.data?.connectionAddress ?? ALIAS_HOST

  const players = stats.data?.playersOnline ?? 0
  const slots = stats.data?.playersMax ?? 0
  const cpu = Math.round(stats.data?.cpuPercent ?? 0)
  const memory = stats.data?.memoryMb ?? 0
  const memoryLimit = stats.data?.memoryLimitMb ?? 0
  const disk = stats.data?.diskBytes ?? 0
  const names = stats.data?.players ?? []

  return (
    <section className="panel arrive overflow-hidden">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Lamp signal={signal} className="h-3.5 w-3.5" />
          <div>
            <p className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
              {stats.isPending
                ? 'Lecture…'
                : stats.isError
                  ? 'API BTP injoignable'
                  : online
                    ? 'En ligne'
                    : 'Hors ligne'}
            </p>
            <p className="readout mt-1 text-sm text-ink-dim">{host}</p>
          </div>
        </div>

        <div className="min-w-0 md:w-72">
          <div className="flex items-baseline justify-between gap-4">
            <span className="engraved">Essai restant</span>
            <span className="readout text-sm text-ink">
              {vitals.isPending ? '…' : formatRemaining(expiresAt)}
            </span>
          </div>
          <Gauge
            className="mt-2.5"
            label="Temps restant sur l'essai en cours"
            value={trialFraction(expiresAt)}
            signal={trialSignal(expiresAt)}
            ticks={[1 / 6]}
          />
          {expiresAt && <p className="readout mt-1.5 text-right text-[11px] text-ink-label">expire {formatShort(expiresAt)}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-edge-soft bg-edge-soft sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="Serveur" value={vitals.data?.displayId ? `#${vitals.data.displayId}` : '—'} />
        <Cell label="Modpack" value={vitals.data?.installedModpack ?? '—'} />
        <Cell label="Joueurs" value={online ? `${players} / ${slots}` : '—'}>
          {online && slots > 0 && (
            <Gauge
              className="mt-2"
              label="Places occupées"
              value={players / slots}
              signal={players > 0 ? 'live' : 'idle'}
            />
          )}
        </Cell>
        <Cell label="CPU" value={online ? `${cpu} %` : '—'}>
          {online && (
            <Gauge className="mt-2" label="Charge CPU" value={Math.min(1, cpu / 100)} signal={loadSignal(cpu / 100)} />
          )}
        </Cell>
        <Cell label="Mémoire" value={online ? formatMemory(memory, memoryLimit) : '—'}>
          {online && memoryLimit > 0 && (
            <Gauge
              className="mt-2"
              label="Mémoire utilisée"
              value={Math.min(1, memory / memoryLimit)}
              signal={loadSignal(memory / memoryLimit)}
            />
          )}
        </Cell>
        <Cell label="Disque" value={disk > 0 ? formatDisk(disk) : '—'} />
      </div>

      {online && names.length > 0 && (
        <div className="border-t border-edge-soft px-4 py-3 sm:px-6">
          <p className="engraved">Connectés</p>
          <p className="readout mt-2 text-sm text-ink">{names.join(' · ')}</p>
        </div>
      )}
    </section>
  )
}

function Cell({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <div className="bg-panel px-4 py-3 sm:px-5">
      <p className="engraved">{label}</p>
      <p className="readout mt-2 truncate text-sm text-ink" title={value}>
        {value}
      </p>
      {children}
    </div>
  )
}

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------

function RotationPanel({
  rotation,
  vitals,
}: {
  rotation: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getGistState>>>>
  vitals: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getServerVitals>>>>
}) {
  const next = nextRotationAt()
  const outlook = rotationOutlook(vitals.data?.expiresAt ?? null, next)
  const fleet = vitals.data?.fleet ?? []

  return (
    <Panel title="Rotation" note="État du worker, lu dans le Gist">
      <div className="p-4 sm:p-5">
        {rotation.isPending ? (
          <LoadingGrid />
        ) : rotation.isError ? (
          <Fault>
            Gist illisible. Vérifier <span className="readout">GH_TOKEN</span> et
            <span className="readout"> GIST_ID</span>.
          </Fault>
        ) : (
          <>
            <dl className="space-y-2">
              <Row label="Compte actif">
                <span className="readout text-sm text-ink">{rotation.data.activeAccountEmail}</span>
              </Row>
              <Row label="Dernière">
                <span className="readout text-sm text-ink">
                  {rotation.data.lastRotationAt ? formatShort(rotation.data.lastRotationAt) : '—'}
                </span>
              </Row>
              {/* Le cron GitHub tire souvent en retard, jusqu'a quatre heures
                  observees: cette heure est un plancher, pas une promesse. */}
              <Row label="Prochaine au plus tôt">
                <span className="readout text-sm text-ink-dim" title="Le cron GitHub peut partir jusqu'à ~4 h en retard">
                  {next ? next.toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </Row>
              <Row label="Ce créneau">
                <span className="flex items-center gap-2 text-sm text-ink">
                  <Lamp signal={outlookSignal(outlook.verdict)} />
                  {formatOutlook(outlook)}
                </span>
              </Row>
            </dl>

            <ActionBar />

            {fleet.length > 0 && (
              <div className="mt-4 border-t border-edge-soft pt-4">
                <p className="engraved">Les deux comptes</p>
                <div className="mt-2.5 space-y-2">
                  {fleet.map((account) => (
                    <AccountRow key={account.index} account={account} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

// -----------------------------------------------------------------------------

function RunLog({
  runs,
  progress,
}: {
  runs: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getRecentWorkflows>>>>
  progress: Awaited<ReturnType<typeof getGistState>>['progress']
}) {
  return (
    <Panel title="Journal" note="5 derniers déclenchements GitHub Actions">
      <div className="p-4 sm:p-5">
        {runs.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Well key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : runs.isError ? (
          <Fault>
            Journal indisponible. Vérifier <span className="readout">GH_TOKEN</span> et
            <span className="readout"> GITHUB_REPO</span>.
          </Fault>
        ) : runs.data.length === 0 ? (
          <p className="text-sm text-ink-dim">Aucun déclenchement enregistré.</p>
        ) : (
          <table className="stack-rows w-full">
            <thead>
              <tr className="border-b border-edge-soft text-left">
                <th className="engraved pb-2.5">Déclenchement</th>
                <th className="engraved pb-2.5">Date</th>
                <th className="engraved pb-2.5">État</th>
                <th className="engraved pb-2.5 text-right">Logs</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.slice(0, 5).map((run) => (
                <tr key={run.id} className="border-b border-edge-soft/60 last:border-0">
                  <td data-label="Déclenchement" className="py-2.5 pr-4 text-sm text-ink">
                    {run.name}
                  </td>
                  <td data-label="Date" className="readout py-2.5 pr-4 text-xs text-ink-dim">
                    {formatShort(run.createdAt)}
                  </td>
                  <td data-label="État" className="py-2.5 pr-4">
                    <State signal={workflowSignal(run.status, run.conclusion)}>
                      {formatWorkflowState(run.status, run.conclusion)}
                    </State>
                    {runProgress(run, progress) && (
                      <span className="readout mt-1 block text-xs text-ink-dim">{runProgress(run, progress)}</span>
                    )}
                  </td>
                  <td data-label="Logs" className="py-2.5 text-right">
                    <a
                      href={run.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-ink-dim underline-offset-4 hover:text-ink hover:underline"
                    >
                      Ouvrir
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  )
}

const ACTION_COPY: Record<ActionName, { label: string; title: string; body: string }> = {
  backup: {
    label: 'Sauvegarder',
    title: 'Sauvegarder le monde sur Drive ?',
    body: 'Copie du monde vivant sur Google Drive, sans coupure pour les joueurs. Environ 15 à 20 min de runner GitHub.',
  },
  restart: {
    label: 'Redémarrer',
    title: 'Redémarrer le serveur ?',
    body: 'Repose le DNS et redémarre le serveur actuel, sans rotation ni transfert. Les joueurs sont coupés quelques minutes.',
  },
  rotate: {
    label: 'Rotation',
    title: 'Lancer une rotation ?',
    body: "Le worker ne remplace le serveur que si l'essai arrive en fin de vie (moins de 6 h). Sinon le run se termine sans rien toucher.",
  },
  resync: {
    label: 'Recaler le Gist',
    title: 'Recaler le Gist ?',
    body: "Remet le Gist sur le serveur réellement vivant d'après l'API BoxToPlay. À faire quand le tableau de bord ou le bot pointent un serveur mort.",
  },
}

/** Boutons d'action: seulement une fois connecte, chacun confirme avant de partir. */
function ActionBar() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => hasSession() })
  const [pending, setPending] = useState<ActionName | null>(null)
  const run = useMutation({
    mutationFn: (action: ActionName) => runAction({ data: { action } }),
    onSuccess: (_result, action) => {
      toast.success(`${ACTION_COPY[action].label} : demandé. Le run apparaît dans le journal sous une minute.`)
      setPending(null)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Déclenchement impossible'),
  })

  if (!session.data) return null
  const copy = pending ? ACTION_COPY[pending] : null

  return (
    <div className="mt-4 border-t border-edge-soft pt-4">
      <p className="engraved">Actions</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {(Object.keys(ACTION_COPY) as ActionName[]).map((action) => (
          <button
            key={action}
            onClick={() => setPending(action)}
            className="raise rounded-[2px] px-3 py-2 text-sm text-ink transition-colors duration-150 hover:bg-edge"
          >
            {ACTION_COPY[action].label}
          </button>
        ))}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent className="panel border-edge-soft bg-panel text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-ink">{copy?.title}</AlertDialogTitle>
            <AlertDialogDescription className="max-w-[68ch] text-sm text-ink-dim">{copy?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="raise rounded-[2px] border-0 text-ink hover:bg-edge">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="raise rounded-[2px] text-ink hover:bg-edge"
              onClick={(event) => {
                event.preventDefault()
                if (pending) run.mutate(pending)
              }}
              disabled={run.isPending}
            >
              {run.isPending ? 'Envoi…' : 'Confirmer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Un compte, son essai, et lequel des deux sert en ce moment. */
function AccountRow({
  account,
}: {
  account: { index: number; displayId: number | null; expiresAt: string | null; isLive: boolean }
}) {
  return (
    <div className="recess flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[2px] px-3 py-2">
      <Lamp signal={account.isLive ? 'live' : account.expiresAt ? 'idle' : 'fault'} />
      <span className="readout text-[13px] text-ink">
        compte {account.index}
        {account.displayId !== null && <span className="text-ink-label"> · #{account.displayId}</span>}
      </span>
      {account.isLive && <span className="engraved text-live">en service</span>}
      <span className="readout ml-auto text-xs text-ink-dim">
        {account.expiresAt ? formatRemaining(account.expiresAt) : 'aucun essai vivant'}
      </span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Historique: trois petits multiples plutot qu'un graphe a plusieurs axes,
// joueurs, CPU et memoire n'ont pas la meme echelle.
// -----------------------------------------------------------------------------

const GIB = 1024 ** 3

const formatTime = (at: string) =>
  new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function HistoryPanel({
  history,
}: {
  history: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getServerHistory>>>>
}) {
  const points = history.data ?? []
  const players = points.map((point) => ({ at: point.at, value: point.players }))
  const cpu = points.map((point) => ({ at: point.at, value: point.cpuPercent }))
  const memory = points.map((point) => ({ at: point.at, value: point.memoryBytes / GIB }))
  const memoryLimit = (points[points.length - 1]?.memoryLimitBytes ?? 0) / GIB
  const peak = (series: { value: number }[]) => Math.max(0, ...series.map((point) => point.value))

  return (
    <Panel title="Historique" note="Depuis le lancement de l'essai · un point toutes les 30 min">
      <div className="p-4 sm:p-5">
        {history.isPending ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Well key={i} className="h-[92px] w-full" />
            ))}
          </div>
        ) : history.isError ? (
          <Fault>L'API BoxToPlay n'a pas rendu l'historique des mesures.</Fault>
        ) : points.length < 2 ? (
          <p className="text-sm text-ink-dim">
            Pas encore assez d'échantillons : un point toutes les 30 min après le démarrage.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <HistoryChart
                label="Joueurs · pic"
                color="var(--color-series-players)"
                points={players}
                max={niceCeil(peak(players), 4)}
                format={(value) => String(Math.round(value))}
              />
              <HistoryChart
                label="CPU · moyenne"
                color="var(--color-series-cpu)"
                points={cpu}
                max={niceCeil(peak(cpu), 10)}
                format={(value) => `${Math.round(value)} %`}
              />
              <HistoryChart
                label="Mémoire · moyenne"
                color="var(--color-series-memory)"
                points={memory}
                max={memoryLimit > 0 ? memoryLimit : niceCeil(peak(memory), 1)}
                format={(value) => `${value.toFixed(1)} Go`}
              />
            </div>

            <details className="mt-3 border-t border-edge-soft pt-2.5">
              <summary className="engraved cursor-pointer">Valeurs</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-edge-soft">
                      <th className="engraved pb-2 pr-4">Heure</th>
                      <th className="engraved pb-2 pr-4 text-right">Joueurs</th>
                      <th className="engraved pb-2 pr-4 text-right">CPU</th>
                      <th className="engraved pb-2 text-right">Mémoire</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.at} className="border-b border-edge-soft/60 last:border-0">
                        <td className="readout py-1.5 pr-4 text-xs text-ink-dim">{formatTime(point.at)}</td>
                        <td className="readout py-1.5 pr-4 text-right text-xs text-ink tabular-nums">
                          {point.players}
                        </td>
                        <td className="readout py-1.5 pr-4 text-right text-xs text-ink tabular-nums">
                          {Math.round(point.cpuPercent)} %
                        </td>
                        <td className="readout py-1.5 text-right text-xs text-ink tabular-nums">
                          {(point.memoryBytes / GIB).toFixed(1)} Go
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>
    </Panel>
  )
}

/**
 * Une serie, une couleur neutre: les couleurs de signal sont reservees a
 * l'etat. La lecture en tete suit le pointeur (ou les fleches), et montre le
 * dernier point sinon, donc aucune valeur n'est cachee derriere un survol.
 */
function HistoryChart({
  label,
  color,
  points,
  max,
  format,
}: {
  label: string
  /** Couleur de la mesure, ex. `var(--color-series-cpu)`. Jamais sur du texte. */
  color: string
  points: { at: string; value: number }[]
  max: number
  format: (value: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const last = points.length - 1
  const shown = hover ?? last
  const clamp = (i: number) => Math.max(0, Math.min(last, i))
  const x = (i: number) => (i / last) * 100
  const y = (value: number) => 100 - (Math.max(0, Math.min(value, max)) / max) * 100
  const line = points.map((point, i) => `${x(i)},${y(point.value)}`).join(' ')

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="engraved flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="text-xs text-ink-label">
          <span className="readout text-sm text-ink">{format(points[shown].value)}</span>
          {' · '}
          {formatTime(points[shown].at)}
        </span>
      </div>

      <div
        tabIndex={0}
        role="group"
        aria-label={`${label}, flèches gauche et droite pour parcourir les points`}
        className="relative mt-4 h-12 cursor-crosshair rounded-[1px] outline-none focus-visible:ring-1 focus-visible:ring-edge"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setHover(clamp(Math.round(((event.clientX - box.left) / box.width) * last)))
        }}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setHover(clamp(shown + (event.key === 'ArrowLeft' ? -1 : 1)))
        }}
      >
        <span className="readout absolute left-0 top-0 -translate-y-full pb-1 text-[10px] leading-none text-ink-label">
          {format(max)}
        </span>
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <line x1="0" x2="100" y1="0" y2="0" stroke="var(--color-edge-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2="100" y1="100" y2="100" stroke="var(--color-edge-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polygon points={`0,100 ${line} 100,100`} fill={color} fillOpacity="0.1" />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {hover !== null && (
          <span aria-hidden className="absolute inset-y-0 w-px -translate-x-1/2 bg-edge" style={{ left: `${x(shown)}%` }} />
        )}
        <span
          aria-hidden
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel"
          style={{ left: `${x(shown)}%`, top: `${y(points[shown].value)}%`, background: color }}
        />
      </div>

      <div className="readout mt-1.5 flex justify-between text-[10px] text-ink-label">
        <span>{formatTime(points[0].at)}</span>
        <span>{formatTime(points[last].at)}</span>
      </div>
    </div>
  )
}

const formatShort = (at: string) =>
  new Date(at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <dt className="engraved">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  )
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Well key={i} className="h-[62px] w-full" />
      ))}
    </div>
  )
}
