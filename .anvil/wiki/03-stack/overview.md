# Stack — boxtoplay-dashboard

## Frontend

- React 19
- TanStack Router / Start
- TanStack Query
- Tailwind CSS + composants UI locaux (`src/components/ui/*`)

Source: [`package.json`](../../../../package.json), [`src/routes/__root.tsx`](../../../../src/routes/__root.tsx).

## Back/Server-side dans l’app

- Server Functions TanStack (`createServerFn`) pour appels externes

Source: [`src/server/dashboard.ts`](../../../../src/server/dashboard.ts), [`src/server/modpacks.ts`](../../../../src/server/modpacks.ts).

## APIs externes

- GitHub API (workflows)
- BoxToPlay API (modpacks, statut, stats et historique du serveur)
