<script setup lang="ts">
import type { ConversationToolActivity } from '@/app/conversation/types'

const { tools } = defineProps<{
  tools: ConversationToolActivity[]
}>()

interface CodeInput {
  language: string
  code: string
}

interface CodeOutput {
  outcome: string
  output: string
}

function objectValue(value: unknown): object | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value
  }
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function codeInput(tool: ConversationToolActivity): CodeInput | null {
  if (tool.name !== 'code_execution') return null
  const input = objectValue(tool.input)
  if (!input) return null
  const code = Reflect.get(input, 'code')
  const language = Reflect.get(input, 'language')
  if (typeof code !== 'string') return null
  return {
    language: typeof language === 'string' ? language : 'code',
    code
  }
}

function codeOutput(tool: ConversationToolActivity): CodeOutput | null {
  if (tool.name !== 'code_execution') return null
  const output = objectValue(tool.output)
  if (!output) return null
  const outcome = Reflect.get(output, 'outcome')
  const outputText = Reflect.get(output, 'output')
  return {
    outcome: typeof outcome === 'string' ? outcome : '',
    output: typeof outputText === 'string' ? outputText : ''
  }
}
</script>

<template>
  <section
    v-if="tools.length"
    data-test-id="conversation-tool-activity"
    class="mb-3 flex w-full flex-col gap-1.5"
  >
    <article
      v-for="tool in tools"
      :key="`${tool.id}-${tool.state}`"
      class="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
    >
      <header class="flex min-h-8 items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-slate-600">
        <icon-lucide-search v-if="tool.name === 'google_search'" class="size-3.5" />
        <icon-lucide-code-2 v-else-if="tool.name === 'code_execution'" class="size-3.5" />
        <icon-lucide-link v-else-if="tool.name === 'url_context'" class="size-3.5" />
        <icon-lucide-wrench v-else class="size-3.5" />
        <span class="font-medium">{{ tool.label }}</span>
        <span v-if="codeInput(tool)" class="text-[9px] text-slate-400 uppercase">
          {{ codeInput(tool)?.language }}
        </span>
        <span class="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
          <icon-lucide-loader-circle
            v-if="tool.state === 'running'"
            class="size-3 animate-spin text-blue-600"
          />
          <icon-lucide-check
            v-else-if="tool.state === 'complete'"
            class="size-3 text-emerald-600"
          />
          <icon-lucide-circle-alert v-else class="size-3 text-red-500" />
          {{ tool.state }}
        </span>
      </header>

      <div v-if="codeInput(tool)" class="border-t border-slate-200 bg-white">
        <pre
          class="max-h-48 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-5 text-slate-700 select-text [-webkit-user-select:text]"
        ><code>{{ codeInput(tool)?.code }}</code></pre>
      </div>
      <div
        v-if="codeOutput(tool)"
        class="flex items-start gap-2 border-t border-slate-200 px-2.5 py-2"
      >
        <span class="shrink-0 text-[9px] font-semibold tracking-wide text-slate-400 uppercase">
          Output
        </span>
        <pre
          class="min-w-0 flex-1 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap text-slate-700 select-text [-webkit-user-select:text]"
          >{{ codeOutput(tool)?.output || codeOutput(tool)?.outcome }}</pre
        >
      </div>
      <p v-if="tool.errorText" class="border-t border-red-100 px-2.5 py-2 text-[11px] text-red-600">
        {{ tool.errorText }}
      </p>
    </article>
  </section>
</template>
