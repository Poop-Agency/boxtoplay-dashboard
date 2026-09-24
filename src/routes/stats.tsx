import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Fault, PageHead, Panel, Readout, Well } from '@/components/ui/instrument'
import { formatPlayTime, totals } from '@/lib/stats'
import { getPlayerStats } from '@/server/stats'

export const Route = createFileRoute('/stats')({ component: StatsPage })

const n = (value: number) => value.toLocaleString('fr-FR')

function StatsPage() {
  const stats = useQuery({
    queryKey: ['player-stats'],
    queryFn: () => getPlayerStats(),
    // Le serveur met deja 5 min en cache: relire plus souvent ne montrerait rien.
    refetchInterval: 5 * 60_000,
    // Chaque essai relit tous les fichiers: pas de rafale de relances sur le quota partage.
    retry: 1,
  })

  const players = stats.data?.players ?? []
  const sum = totals(players)

  return (
    <div className="space-y-5">
      <PageHead
        title="Joueurs"
        note="Compteurs de toute la partie, lus dans les statistiques du monde. Mis à jour à chaque sauvegarde automatique du serveur."
      />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Readout label="Joueurs" value={stats.isSuccess ? n(sum.players) : '…'} />
        <Readout label="Temps de jeu cumulé" value={stats.isSuccess ? formatPlayTime(sum.playTimeS) : '…'} />
        <Readout label="Morts" value={stats.isSuccess ? n(sum.deaths) : '…'} />
        <Readout label="Mobs tués" value={stats.isSuccess ? n(sum.mobKills) : '…'} />
      </div>

      <Panel
        title="Par joueur"
        note={
          stats.data
            ? `Lu à ${new Date(stats.data.readAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
            : 'Classés par temps de jeu'
        }
      >
        {stats.isPending ? (
          <div className="space-y-2 p-4 sm:p-5">
            {[0, 1, 2].map((i) => (
              <Well key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : stats.isError ? (
          <div className="p-4 sm:p-5">
            <Fault>Statistiques illisibles : le serveur ou l'API fichiers de BoxToPlay n'a pas répondu.</Fault>
          </div>
        ) : players.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-dim sm:px-5">Personne n'a encore joué sur ce monde.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-edge-soft text-left">
                  {['Joueur', 'Temps joué', 'Morts', 'Mobs tués', 'PvP', 'Distance', 'Blocs minés', 'Tué surtout par'].map(
                    (label, i) => (
                      <th key={label} className={`engraved whitespace-nowrap px-4 py-2.5 font-normal sm:px-5 ${i > 0 && i < 7 ? 'text-right' : ''}`}>
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-soft whitespace-nowrap">
                {players.map((player) => (
                  <tr key={player.uuid}>
                    <td className="px-4 py-2.5 font-medium text-ink sm:px-5">{player.name}</td>
                    <td className="readout px-4 py-2.5 text-right text-ink sm:px-5">{formatPlayTime(player.playTimeS)}</td>
                    <td className="readout px-4 py-2.5 text-right text-ink sm:px-5">{n(player.deaths)}</td>
                    <td className="readout px-4 py-2.5 text-right text-ink-dim sm:px-5">{n(player.mobKills)}</td>
                    <td className="readout px-4 py-2.5 text-right text-ink-dim sm:px-5">{n(player.playerKills)}</td>
                    <td className="readout px-4 py-2.5 text-right text-ink-dim sm:px-5">{n(Math.round(player.distanceKm))} km</td>
                    <td className="readout px-4 py-2.5 text-right text-ink-dim sm:px-5">{n(player.blocksMined)}</td>
                    <td className="px-4 py-2.5 text-ink-dim sm:px-5">
                      {player.topKiller ? `${player.topKiller.name} (${n(player.topKiller.count)})` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
