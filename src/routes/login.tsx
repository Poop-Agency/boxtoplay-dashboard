import { createFileRoute } from '@tanstack/react-router'

import { Fault, Panel } from '@/components/ui/instrument'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { error?: boolean } => ({
    error: search.error ? true : undefined,
  }),
  component: LoginPage,
})

// Formulaire HTML natif poste vers /api/login: fonctionne avant l'hydratation
// et laisse le serveur poser le cookie HttpOnly.
function LoginPage() {
  const { error } = Route.useSearch()

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Panel title="BoxToPlay Control Center" note="Accès protégé" className="w-full max-w-sm">
        <form method="post" action="/api/login" className="space-y-4 p-4 sm:p-5">
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            placeholder="Mot de passe"
            aria-label="Mot de passe"
            className="recess w-full rounded-[2px] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-label focus:outline-none focus-visible:outline-2 focus-visible:outline-ink-dim"
          />
          {error && <Fault>Mot de passe incorrect.</Fault>}
          <button
            type="submit"
            className="raise w-full rounded-[2px] px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-edge"
          >
            Entrer
          </button>
        </form>
      </Panel>
    </div>
  )
}
