import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TanStackDevtools } from '@tanstack/react-devtools'
import * as React from 'react'

import { AppSidebar } from '@/components/layout/app-sidebar'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'BoxToPlay Control Center' },
      { name: 'color-scheme', content: 'dark' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' as const },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: RootNotFound,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  )

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-ground text-ink antialiased font-sans" suppressHydrationWarning>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }]}
        />
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (pathname === '/login') {
    return (
      <main className="min-h-screen p-4">
        <Outlet />
      </main>
    )
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar />
      <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-[1480px]">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function RootNotFound() {
  return (
    <div className="panel p-6 md:p-8">
      <h1 className="text-xl font-semibold text-ink">Page introuvable</h1>
      <p className="mt-2 max-w-[68ch] text-sm text-ink-dim">Cette route n'existe pas.</p>
    </div>
  )
}