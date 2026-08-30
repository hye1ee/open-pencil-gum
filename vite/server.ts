import { normalizePath, type Plugin, type ServerOptions } from 'vite'

const WATCHED_MARKDOWN_ROOTS = ['/src/', '/packages/core/src/', '/packages/vue/src/']

const STUDY_CONDITION_LINKS = [
  { label: 'UserLens', path: 'userlens' },
  { label: 'Ask User', path: 'ask-user' },
  { label: 'User Initiated', path: 'user-initiated' },
  { label: 'Hands-off', path: 'hands-off' }
] as const

function ignoreMarkdownOutsideSource(path: string): boolean {
  const normalized = normalizePath(path)
  if (!normalized.endsWith('.md')) return false
  return !WATCHED_MARKDOWN_ROOTS.some((root) => normalized.includes(root))
}

export const WATCH_IGNORED = [
  // A frame lands here every few seconds while page capture is running; without
  // this the watcher fires on every one of them mid-session.
  '**/captures/**',
  '**/desktop/**',
  '**/packages/cli/**',
  '**/packages/mcp/**',
  '**/packages/docs/**',
  '**/tests/**',
  '**/.worktrees/**',
  '**/.github/**',
  '**/.pi/**',
  ignoreMarkdownOutsideSource
]

export function createDevServerOptions(host: string | undefined): ServerOptions {
  return {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: WATCH_IGNORED
    }
  }
}

export function devRouteLinksPlugin(): Plugin {
  return {
    name: 'open-pencil-dev-route-links',
    apply: 'serve',
    configureServer(server) {
      const printUrls = server.printUrls.bind(server)

      server.printUrls = () => {
        printUrls()

        const rootUrl = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0]
        if (!rootUrl) return

        const printHostLinks = (label: string, route: 'chat' | 'canvas'): void => {
          server.config.logger.info(`  ➜  ${label}`)
          for (const condition of STUDY_CONDITION_LINKS) {
            const url = new URL(`/${route}/${condition.path}`, rootUrl).href
            server.config.logger.info(`     ${condition.label.padEnd(14)} ${url}`)
          }
        }

        server.config.logger.info('')
        printHostLinks('LenChat', 'chat')
        printHostLinks('LenCanvas', 'canvas')
      }
    }
  }
}
