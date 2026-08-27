<script setup lang="ts">
import type { ChatProposition } from '@/app/user-model-chat/types'

const { open, propositions, learning } = defineProps<{
  open: boolean
  propositions: ChatProposition[]
  learning: boolean
}>()
defineEmits<{ close: []; clear: [] }>()
</script>

<template>
  <div
    v-if="open"
    class="absolute inset-0 z-40 flex justify-end bg-slate-900/20 backdrop-blur-[1px]"
    @click.self="$emit('close')"
  >
    <aside
      class="flex h-full w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl"
    >
      <header class="flex items-center justify-between px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-slate-900">User Model</h2>
        </div>
        <button
          class="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          @click="$emit('close')"
        >
          <icon-lucide-x class="size-4" />
        </button>
      </header>
      <div
        v-if="learning"
        class="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700"
      >
        <icon-lucide-loader-circle class="size-3.5 animate-spin" />Updating from your feedback…
      </div>
      <div class="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <div
          v-if="propositions.length === 0"
          class="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs leading-5 text-slate-500"
        >
          Preferences learned from reviewed chat decisions will appear here.
        </div>
        <article
          v-for="item in propositions"
          :key="item.id"
          class="rounded-xl border border-slate-200 p-3"
        >
          <div class="mb-2 flex items-start justify-between gap-3">
            <p class="text-sm leading-5 font-medium text-slate-800">{{ item.text }}</p>
            <span
              class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
              >{{ Math.round(item.confidence * 9 + 1) }}/10</span
            >
          </div>
          <p v-if="item.rationale" class="text-xs leading-5 text-slate-500">{{ item.rationale }}</p>
        </article>
      </div>
      <div class="p-4">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="learning || propositions.length === 0"
          @click="$emit('clear')"
        >
          <icon-lucide-trash-2 class="size-3.5" />Clear
        </button>
      </div>
    </aside>
  </div>
</template>
