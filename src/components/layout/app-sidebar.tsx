'use client'

import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { hasSession } from '@/server/session'

const navItems = [
  { to: '/', label: 'Tableau de bord' },
  { to: '/stats', label: 'Joueurs' },
  { to: '/modpacks', label: 'Modpacks' },
  { to: '/backups', label: 'Sauvegardes' },
  { to: '/console', label: 'Console' },
] as const

// La destination courante est une plaque en relief, pas une bande de couleur
// sur le bord: le relief se lit sans percevoir la teinte.
export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [open, setOpen] = useState(false)
  const session = useQuery({ queryKey: ['session'], queryFn: () => hasSession() })

  return (
    <>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
        aria-expanded={open}
        className="raise fixed bottom-5 right-5 z-50 rounded-[2px] px-4 py-3 text-xs font-semibold uppercase tracking-[0.09em] text-ink md:hidden"
      >
        {open ? 'Fermer' : 'Menu'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-ground/80 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-full w-56 flex-col border-r border-edge-soft bg-recess transition-transform duration-200 ease-out md:relative md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-edge-soft px-4 py-5">
          <p className="text-sm font-semibold tracking-tight text-ink">BoxToPlay</p>
          <p className="engraved mt-1.5">Control Center</p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const active = pathname === item.to

            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-[2px] px-3 py-2.5 text-sm transition-colors duration-150 ${
                  active
                    ? 'raise font-medium text-ink'
                    : 'text-ink-dim hover:bg-raised/40 hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-edge-soft px-4 py-4">
          <p className="readout text-[11px] text-ink-label">v2 · rotation 8 h</p>
          {session.data ? (
            <form method="post" action="/api/logout">
              <button type="submit" className="text-xs text-ink-dim underline-offset-4 hover:text-ink hover:underline">
                Déconnexion
              </button>
            </form>
          ) : (
            <Link to="/login" className="text-xs text-ink-dim underline-offset-4 hover:text-ink hover:underline">
              Connexion
            </Link>
          )}
        </div>
      </aside>
    </>
  )
}
