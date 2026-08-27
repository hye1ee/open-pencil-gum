import { normalizePath, type Plugin, type ServerOptions } from 'vite'

const WATCHED_MARKDOWN_ROOTS = ['/src/', '/packages/core/src/', '/packages/vue/src/']

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

        server.config.logger.info(`  ➜  Chat:   ${new URL('/chat', rootUrl).href}`)
        server.config.logger.info(`  ➜  Canvas: ${new URL('/canvas', rootUrl).href}`)
      }
    }
  }
}
