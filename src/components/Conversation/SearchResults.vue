<script setup lang="ts">
import { computed } from 'vue'

import type { SourceUrlUIPart } from 'ai'

interface SearchResult {
  id: string
  url: string
  title: string
}

const { sources } = defineProps<{
  sources: SourceUrlUIPart[]
}>()

const results = computed<SearchResult[]>(() => {
  const seen = new Set<string>()
  return sources.flatMap((source) => {
    if (seen.has(source.url)) return []

    try {
      const url = new URL(source.url)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return []
      seen.add(source.url)
      const host = url.hostname.replace(/^www\./, '')
      return [
        {
          id: source.sourceId,
          url: source.url,
          title: source.title?.trim() || host
        }
      ]
    } catch {
      return []
    }
  })
})
</script>

<template>
  <section v-if="results.length" data-test-id="conversation-search-results" class="mt-4 w-full">
    <div class="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
      <icon-lucide-search class="size-3.5 text-blue-600" />
      <span>Search results</span>
      <span class="font-normal text-slate-400">{{ results.length }}</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <a
        v-for="result in results"
        :key="`${result.id}-${result.url}`"
        :href="result.url"
        target="_blank"
        rel="noreferrer"
        :title="result.title"
        class="group inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800"
      >
        <span class="truncate">{{ result.title }}</span>
        <icon-lucide-external-link
          class="size-3 shrink-0 text-slate-400 group-hover:text-blue-600"
        />
      </a>
    </div>
  </section>
</template>
