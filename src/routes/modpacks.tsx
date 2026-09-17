import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import * as React from 'react'

import { Fault, Lamp, PageHead, Panel, Well } from '@/components/ui/instrument'
import { defaultVersionId, formatDownloads, splitGameVersion } from '@/lib/modpacks'
import { getModpackVersions, searchModpacks, triggerModpackSwitch } from '@/server/modpacks'
import { requireSession } from '@/server/session'

export const Route = createFileRoute('/modpacks')({
  beforeLoad: requireSession,
  component: ModpacksPage,
})

// Une ligne = un modpack. Les versions n'apparaissent qu'une fois la ligne
// ouverte: elles ne veulent rien dire tant que le pack n'est pas choisi, et
// les faire figurer dans la liste rendait le catalogue illisible.
function ModpacksPage() {
  const [term, setTerm] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [openId, setOpenId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(term), 300)
    return () => window.clearTimeout(timeout)
  }, [term])

  React.useEffect(() => {
    setPage(0)
    setOpenId(null)
  }, [query])

  const catalog = useQuery({
    queryKey: ['modpacks', query, page],
    queryFn: () => searchModpacks({ data: { query, pageId: page } }),
    placeholderData: (previous) => previous,
  })

  const modpacks = catalog.data?.modpacks ?? []

  return (
    <div className="space-y-5">
      <PageHead
        title="Modpacks"
        note="Choisir un pack, puis une de ses versions. Le catalogue est un instantané publié par le worker."
      />

      <Panel
        title={query ? 'Résultats' : 'Catalogue'}
        note={catalogNote(catalog.data)}
        aside={
          <div className="flex items-center gap-2">
            <span className="readout text-xs text-ink-label">p. {page + 1}</span>
            <PagerButton
              label="Page précédente"
              disabled={page === 0 || catalog.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </PagerButton>
            <PagerButton
              label="Page suivante"
              disabled={!catalog.data?.hasNextPage || catalog.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              ›
            </PagerButton>
          </div>
        }
      >
        <div className="border-b border-edge-soft p-3 sm:p-4">
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Chercher un modpack"
            aria-label="Chercher un modpack"
            className="recess w-full rounded-[2px] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-label focus:outline-none focus-visible:outline-2 focus-visible:outline-ink-dim"
          />
        </div>

        {catalog.isPending ? (
          <ul className="divide-y divide-edge-soft">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                <Well className="h-12 w-12 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Well className="h-3.5 w-1/3" />
                  <Well className="h-3 w-2/3" />
                </div>
              </li>
            ))}
          </ul>
        ) : catalog.isError ? (
          <div className="px-4 py-6 sm:px-5">
            <Fault>
              Catalogue illisible : l'instantané <span className="readout">modpacks_catalog.json</span>{' '}
              est absent du Gist ou n'a pas pu être chargé.
            </Fault>
          </div>
        ) : modpacks.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-dim sm:px-5">
            Aucun modpack ne porte ce nom.
          </p>
        ) : (
          <ul className="divide-y divide-edge-soft">
            {modpacks.map((modpack, index) => (
              <ModpackRow
                key={modpack.id}
                modpack={modpack}
                open={openId === modpack.id}
                onToggle={() => setOpenId((current) => (current === modpack.id ? null : modpack.id))}
                index={index}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

/**
 * L'instantané vieillit entre deux passes du worker. Son âge est une donnée de
 * l'écran, pas un détail à taire: un pack sorti hier n'y sera pas.
 */
function catalogNote(data: { total?: number; updatedAt?: string | null } | undefined): string {
  if (!data) return 'Chargement'

  const count = typeof data.total === 'number' ? `${data.total} packs` : ''
  const stamp = data.updatedAt
    ? `instantané du ${new Date(data.updatedAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
      })}`
    : 'date d\'instantané inconnue'

  return [count, stamp].filter(Boolean).join(' · ')
}

// -----------------------------------------------------------------------------

function ModpackRow({
  modpack,
  open,
  onToggle,
  index,
}: {
  modpack: { id: string; name: string; logo: string | null; downloads: number | null; summary: string | null }
  open: boolean
  onToggle: () => void
  index: number
}) {
  const downloads = formatDownloads(modpack.downloads)

  return (
    <li
      className="arrive"
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-raised/40 sm:px-5"
      >
        <Cover src={modpack.logo} name={modpack.name} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">{modpack.name}</span>
          {modpack.summary && (
            <span className="mt-1 block truncate text-xs text-ink-dim">{modpack.summary}</span>
          )}
        </span>

        {downloads && (
          <span className="readout hidden shrink-0 text-xs text-ink-label sm:block">
            {downloads}
          </span>
        )}

        <span
          aria-hidden
          className={`shrink-0 text-ink-label transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {open && <VersionPicker modpackId={modpack.id} modpackName={modpack.name} />}
    </li>
  )
}

/**
 * Les jaquettes viennent du CDN CurseForge et manquent parfois. L'initiale
 * dans un creux vaut mieux qu'une icone generique repetee sur toute la liste.
 */
function Cover({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = React.useState(false)

  if (!src || broken) {
    return (
      <span className="recess flex h-12 w-12 shrink-0 items-center justify-center rounded-[2px] text-lg font-semibold text-ink-label">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      width={48}
      height={48}
      onError={() => setBroken(true)}
      className="h-12 w-12 shrink-0 rounded-[2px] object-cover"
    />
  )
}

// -----------------------------------------------------------------------------

function VersionPicker({ modpackId, modpackName }: { modpackId: string; modpackName: string }) {
  const [chosen, setChosen] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)

  const versions = useQuery({
    queryKey: ['modpack-versions', modpackId],
    queryFn: () => getModpackVersions({ data: { modpackId } }),
  })

  React.useEffect(() => {
    if (versions.data && chosen === null) {
      setChosen(defaultVersionId(versions.data))
    }
  }, [versions.data, chosen])

  const install = useMutation({
    mutationFn: async () => {
      if (!chosen) return
      await triggerModpackSwitch({ data: { modpackName, modpackVersionId: chosen } })
    },
    onSettled: () => setConfirming(false),
  })

  if (versions.isPending) {
    return (
      <div className="space-y-2 border-t border-edge-soft bg-ground/40 px-4 py-4 sm:px-5">
        {[0, 1, 2].map((i) => (
          <Well key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (versions.isError) {
    return (
      <div className="border-t border-edge-soft bg-ground/40 px-4 py-4 sm:px-5">
        <Fault>Versions indisponibles pour ce pack.</Fault>
      </div>
    )
  }

  if (versions.data.length === 0) {
    return (
      <div className="border-t border-edge-soft bg-ground/40 px-4 py-4 sm:px-5">
        <p className="text-sm text-ink-dim">Ce pack n'expose aucune version installable.</p>
      </div>
    )
  }

  return (
    <div className="border-t border-edge-soft bg-ground/40 px-4 py-4 sm:px-5">
      <p className="engraved">Version</p>

      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
        {versions.data.map((version) => {
          const { loader, minecraft } = splitGameVersion(version.gameVersion)
          const selected = chosen === version.id

          return (
            <label
              key={version.id}
              className={`flex cursor-pointer items-center gap-3 rounded-[2px] px-3 py-2 transition-colors duration-150 ${
                selected ? 'raise' : 'hover:bg-raised/40'
              }`}
            >
              <input
                type="radio"
                name={`version-${modpackId}`}
                value={version.id}
                checked={selected}
                onChange={() => setChosen(version.id)}
                className="sr-only"
              />
              <Lamp signal={selected ? 'live' : 'idle'} />
              <span className="readout min-w-0 flex-1 truncate text-[13px] text-ink">
                {version.name}
              </span>
              {minecraft && (
                <span className="readout shrink-0 text-xs text-ink-label">
                  {loader ? `${loader} · ${minecraft}` : minecraft}
                </span>
              )}
            </label>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => install.mutate()}
              disabled={install.isPending}
              className="raise rounded-[2px] px-4 py-2 text-sm font-semibold text-warn transition-colors duration-150 hover:bg-edge disabled:opacity-50"
            >
              {install.isPending ? 'Envoi…' : 'Confirmer le remplacement'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-2 py-2 text-sm text-ink-dim underline-offset-4 hover:underline"
            >
              Annuler
            </button>
            <p className="w-full max-w-[68ch] text-xs text-ink-dim">
              Le monde actuel part sur Drive avant la bascule, puis le serveur redémarre sur le
              nouveau pack. La partie en cours est interrompue.
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!chosen}
            className="raise rounded-[2px] px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-edge disabled:opacity-50"
          >
            Installer cette version
          </button>
        )}

        {install.isSuccess && !confirming && (
          <span className="flex items-center gap-2 text-sm text-live">
            <Lamp signal="live" />
            Workflow lancé
          </span>
        )}
        {install.isError && (
          <span className="flex items-center gap-2 text-sm text-fault">
            <Lamp signal="fault" />
            Le déclenchement a échoué
          </span>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------

function PagerButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="raise h-8 w-8 rounded-[2px] text-ink-dim transition-colors duration-150 hover:bg-edge hover:text-ink disabled:opacity-35 disabled:hover:bg-raised"
    >
      {children}
    </button>
  )
}
