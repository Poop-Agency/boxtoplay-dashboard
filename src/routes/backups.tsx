import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Fault, PageHead, Panel, Readout, Well } from '@/components/ui/instrument'
import { classifyBackups, LEGACY_ROTATION_FILE } from '@/lib/backups'
import { deleteBackupFile, getBackupsList, getFileRevisions, restoreFullState } from '@/server/backups'
import type { BackupFile, FileRevision } from '@/server/backups'

export const Route = createFileRoute('/backups')({ component: BackupsPage })

// Chaque rotation depose desormais son propre fichier horodate (purge a 7
// jours). Les revisions Drive ne servent plus qu'aux archives d'avant le
// 2026-09-02, quand un seul fichier etait reecrit sur place.

function formatBytes(bytes: string | number): string {
  const value = typeof bytes === 'string' ? Number.parseInt(bytes, 10) : bytes
  if (!Number.isFinite(value)) return '—'

  const mb = value / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} Go` : `${mb.toFixed(0)} Mo`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function BackupsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BackupFile | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupFile | null>(null)
  const [versionTarget, setVersionTarget] = useState<BackupFile | null>(null)
  const [restoreVersionId, setRestoreVersionId] = useState('')

  const backups = useQuery({
    queryKey: ['backups-list'],
    queryFn: () => getBackupsList(),
    staleTime: 0,
    refetchOnMount: true,
  })

  const revisions = useQuery({
    queryKey: ['file-revisions', versionTarget?.id],
    queryFn: () =>
      versionTarget
        ? getFileRevisions({ data: { fileId: versionTarget.id } })
        : Promise.resolve([] as FileRevision[]),
    enabled: !!versionTarget,
  })

  const remove = useMutation({
    mutationFn: (fileId: string) => deleteBackupFile({ data: { fileId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups-list'] })
      toast.success('Sauvegarde supprimée')
      setDeleteTarget(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Suppression échouée')
    },
  })

  const restore = useMutation({
    mutationFn: (input: { fileId: string; modpackName: string; modpackVersionId?: string }) =>
      restoreFullState({ data: input }),
    onSuccess: () => {
      toast.success('Restauration lancée. Le serveur est reconfiguré dans les minutes qui viennent.')
      setRestoreTarget(null)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Restauration impossible')
    },
  })

  const { rotations, restorePoints } = useMemo(
    () => classifyBackups(backups.data ?? []),
    [backups.data],
  )

  const stats = useMemo(() => {
    const all = backups.data ?? []
    const bytes = all.reduce((sum, file) => sum + (Number.parseInt(file.size, 10) || 0), 0)
    const latest = all.reduce<string | null>(
      (newest, file) =>
        !newest || new Date(file.createdTime) > new Date(newest) ? file.createdTime : newest,
      null,
    )

    return { count: all.length, bytes, latest }
  }, [backups.data])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return restorePoints

    return restorePoints.filter(
      (file) =>
        file.name.toLowerCase().includes(needle) ||
        file.associatedModpack.toLowerCase().includes(needle),
    )
  }, [restorePoints, search])

  return (
    <div className="space-y-5">
      <Toaster position="top-right" theme="dark" />

      <PageHead
        title="Sauvegardes"
        note="Archives du monde sur Google Drive. Une archive par rotation, gardée 7 jours, et les points de restauration figés."
      />

      <Panel title="Stock">
        <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-3 sm:p-5">
          <Readout label="Archives" value={backups.isPending ? '…' : String(stats.count)} />
          <Readout label="Poids total" value={backups.isPending ? '…' : formatBytes(stats.bytes)} />
          <Readout
            label="Dernière écriture"
            value={backups.isPending ? '…' : stats.latest ? formatDate(stats.latest) : '—'}
          />
        </div>
      </Panel>

      {rotations.length > 0 && (
        <Panel
          title="Rotations"
          note="Une archive par rotation, la plus récente en tête. Drive les purge au bout de 7 jours."
        >
          <ul className="divide-y divide-edge-soft">
            {rotations.map((backup, index) => (
              <li
                key={backup.id}
                className="arrive flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
              >
                <div className="min-w-0">
                  <p className="readout truncate text-[15px] text-ink">{backup.name}</p>
                  <p className="readout mt-1 text-xs text-ink-dim">
                    {formatDate(backup.createdTime)} · {formatBytes(backup.size)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {/* Revisions: seules les archives d'avant le 2026-09-02 en ont,
                      elles etaient reecrites sur place. */}
                  {backup.name.toLowerCase().includes(LEGACY_ROTATION_FILE) && (
                    <Control onClick={() => setVersionTarget(backup)}>Versions</Control>
                  )}
                  {backup.webContentLink && (
                    <ControlLink href={backup.webContentLink}>Télécharger</ControlLink>
                  )}
                  <Control tone="fault" onClick={() => setDeleteTarget(backup)}>
                    Supprimer
                  </Control>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Points de restauration"
        note="Un état complet: monde, modpack et configuration."
        aside={
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filtrer"
            aria-label="Filtrer les points de restauration"
            className="recess w-40 rounded-[2px] px-3 py-1.5 text-sm text-ink placeholder:text-ink-label focus:outline-none"
          />
        }
      >
        {backups.isPending ? (
          <div className="space-y-2 p-4 sm:p-5">
            {[0, 1, 2].map((i) => (
              <Well key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : backups.isError ? (
          <div className="p-4 sm:p-5">
            <Fault>
              Google Drive n'a pas répondu. Vérifier <span className="readout">RCLONE_CONFIG_GDRIVE</span>.
            </Fault>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-dim sm:px-5">
            {search.trim() ? 'Aucune archive ne correspond.' : 'Aucun point de restauration enregistré.'}
          </p>
        ) : (
          <ul className="divide-y divide-edge-soft">
            {filtered.map((backup, index) => (
              <li
                key={backup.id}
                className="arrive flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">
                    {backup.associatedModpack || backup.name.replace(/\.zip$/, '')}
                  </p>
                  <p className="readout mt-1 text-xs text-ink-dim">
                    {formatDate(backup.createdTime)} · {formatBytes(backup.size)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Control
                    onClick={() => {
                      setRestoreVersionId('')
                      setRestoreTarget(backup)
                    }}
                  >
                    Restaurer
                  </Control>
                  {backup.webContentLink && (
                    <ControlLink href={backup.webContentLink}>Télécharger</ControlLink>
                  )}
                  <Control tone="fault" onClick={() => setDeleteTarget(backup)}>
                    Supprimer
                  </Control>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Historique Drive: une liste que seul un panneau dedie peut porter. */}
      <Dialog open={!!versionTarget} onOpenChange={(open) => !open && setVersionTarget(null)}>
        <DialogContent className="panel max-w-2xl border-edge-soft bg-panel text-ink">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-ink">Historique des versions</DialogTitle>
            <DialogDescription className="readout text-xs text-ink-dim">
              {versionTarget?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {revisions.isPending && [0, 1, 2].map((i) => <Well key={i} className="h-12 w-full" />)}

            {revisions.isError && <Fault>Historique illisible.</Fault>}

            {revisions.isSuccess && revisions.data.length === 0 && (
              <p className="py-6 text-center text-sm text-ink-dim">Drive ne garde aucune version.</p>
            )}

            {revisions.isSuccess &&
              revisions.data.map((revision, index) => (
                <div
                  key={revision.id}
                  className="recess flex items-center justify-between gap-4 rounded-[2px] px-3.5 py-3"
                >
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="readout shrink-0 text-xs text-ink-label">
                      v{revisions.data.length - index}
                    </span>
                    <span className="readout truncate text-sm text-ink">
                      {formatDate(revision.modifiedTime)}
                    </span>
                    <span className="readout shrink-0 text-xs text-ink-dim">
                      {formatBytes(revision.size)}
                    </span>
                  </div>
                  {revision.downloadUrl ? (
                    <ControlLink href={revision.downloadUrl}>Télécharger</ControlLink>
                  ) : (
                    <span className="text-xs text-ink-label">Lien indisponible</span>
                  )}
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="panel border-edge-soft bg-panel text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-ink">
              Supprimer cette sauvegarde ?
            </AlertDialogTitle>
            <AlertDialogDescription className="max-w-[68ch] text-sm text-ink-dim">
              L'archive part définitivement de Google Drive, avec toutes ses versions. Rien ne la
              récupère ensuite.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="raise rounded-[2px] border-0 text-ink hover:bg-edge">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              className="raise rounded-[2px] text-fault hover:bg-edge"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Suppression…' : 'Supprimer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent className="panel border-edge-soft bg-panel text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold text-ink">
              Restaurer cet état complet ?
            </AlertDialogTitle>
            <AlertDialogDescription className="max-w-[68ch] text-sm text-ink-dim">
              Le serveur s'arrête, réinstalle{' '}
              <span className="text-ink">{restoreTarget?.associatedModpack || 'le modpack associé'}</span>{' '}
              et écrase la map actuelle par celle de cette archive. La partie en cours est perdue.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-1">
            <label htmlFor="restore-version" className="engraved">
              Id de version du modpack
            </label>
            <input
              id="restore-version"
              value={restoreVersionId}
              onChange={(event) => setRestoreVersionId(event.target.value)}
              placeholder="18334"
              inputMode="numeric"
              className="recess readout mt-2 w-full rounded-[2px] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-label focus:outline-none"
            />
            <p className="mt-2 max-w-[68ch] text-xs text-ink-label">
              Laisser vide pour que le worker garde la version courante. L'id se lit sur la page
              Modpacks, en ouvrant le pack voulu.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="raise rounded-[2px] border-0 text-ink hover:bg-edge">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              className="raise rounded-[2px] text-warn hover:bg-edge"
              onClick={() =>
                restoreTarget &&
                restore.mutate({
                  fileId: restoreTarget.id,
                  modpackName: restoreTarget.associatedModpack,
                  modpackVersionId: restoreVersionId.trim() || undefined,
                })
              }
              disabled={restore.isPending}
            >
              {restore.isPending ? 'Lancement…' : 'Confirmer la restauration'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// -----------------------------------------------------------------------------

function Control({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'fault'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`raise rounded-[2px] px-3 py-1.5 text-xs font-medium transition-colors duration-150 hover:bg-edge ${
        tone === 'fault' ? 'text-fault' : 'text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ControlLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="raise rounded-[2px] px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:bg-edge"
    >
      {children}
    </a>
  )
}
