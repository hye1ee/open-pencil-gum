<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import Prism from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-yaml'
import { computed } from 'vue'

import type { CodeNodeRendererProps } from 'vue-stream-markdown'

const { node } = defineProps<CodeNodeRendererProps>()

const LANGUAGE_ALIASES: Record<string, string> = {
  html: 'markup',
  js: 'javascript',
  jsx: 'jsx',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'markup',
  xml: 'markup',
  yml: 'yaml'
}

const code = computed(() => node.value ?? '')
const sourceLanguage = computed(() => node.lang?.trim().toLowerCase() || 'text')
const prismLanguage = computed(
  () => LANGUAGE_ALIASES[sourceLanguage.value] ?? sourceLanguage.value
)
const languageLabel = computed(() => sourceLanguage.value.replaceAll('-', ' '))

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const highlightedCode = computed(() => {
  const grammar = Prism.languages[prismLanguage.value]
  return grammar
    ? Prism.highlight(code.value, grammar, prismLanguage.value)
    : escapeHtml(code.value)
})

const { copy, copied } = useClipboard({ source: code, copiedDuring: 1600 })
</script>

<template>
  <figure
    data-test-id="lenchat-code-block"
    class="lenchat-code-block my-4 overflow-hidden rounded-xl bg-slate-50"
  >
    <figcaption
      class="lenchat-code-header flex items-center justify-between bg-slate-100/80"
    >
      <span class="font-mono text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
        {{ languageLabel }}
      </span>
      <button
        type="button"
        class="lenchat-code-copy flex cursor-pointer items-center gap-1.5 rounded-md text-[10px] font-medium text-slate-500 transition hover:bg-white hover:text-blue-700"
        :aria-label="copied ? 'Code copied' : 'Copy code'"
        @click="copy()"
      >
        <icon-lucide-check v-if="copied" class="size-3 text-emerald-600" />
        <icon-lucide-copy v-else class="size-3" />
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </figcaption>
    <div class="max-h-[32rem] overflow-auto">
      <pre
        class="lenchat-code-content min-w-max font-mono text-[13px] leading-6 text-slate-800 selection:bg-blue-200"
      ><code :class="`language-${prismLanguage}`" v-html="highlightedCode" /></pre>
    </div>
  </figure>
</template>

<style scoped>
.lenchat-code-block {
  border: 1px solid #e2e8f0;
}

.lenchat-code-header {
  border-bottom: 1px solid #e2e8f0;
  padding: 0.5rem 0.75rem;
}

.lenchat-code-copy {
  padding: 0.25rem 0.5rem;
}

.lenchat-code-content {
  padding: 1rem;
}

code :deep(.token.comment),
code :deep(.token.prolog),
code :deep(.token.doctype),
code :deep(.token.cdata) {
  color: #94a3b8;
  font-style: italic;
}

code :deep(.token.punctuation) {
  color: #64748b;
}

code :deep(.token.property),
code :deep(.token.tag),
code :deep(.token.boolean),
code :deep(.token.number),
code :deep(.token.constant),
code :deep(.token.symbol) {
  color: #dc2626;
}

code :deep(.token.selector),
code :deep(.token.attr-name),
code :deep(.token.string),
code :deep(.token.char),
code :deep(.token.builtin),
code :deep(.token.inserted) {
  color: #15803d;
}

code :deep(.token.operator),
code :deep(.token.entity),
code :deep(.token.url) {
  color: #b45309;
}

code :deep(.token.atrule),
code :deep(.token.attr-value),
code :deep(.token.keyword) {
  color: #7c3aed;
}

code :deep(.token.function),
code :deep(.token.class-name) {
  color: #2563eb;
}

code :deep(.token.regex),
code :deep(.token.important),
code :deep(.token.variable) {
  color: #c2410c;
}
</style>
