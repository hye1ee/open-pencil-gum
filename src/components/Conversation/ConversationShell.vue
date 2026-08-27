<script setup lang="ts">
import type { ConversationRecord } from '@/app/conversation/types'

const { history, currentId } = defineProps<{
  history: ConversationRecord[]
  currentId: string
}>()
defineEmits<{
  new: []
  open: [id: string]
  delete: [id: string]
  userModel: []
}>()
</script>

<template>
  <div
    data-test-id="conversation-shell"
    class="flex h-screen w-screen overflow-hidden bg-white text-slate-900 select-text [-webkit-user-select:text] selection:bg-blue-200"
  >
    <aside class="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50/80 md:flex">
      <div class="flex h-12 items-center gap-2 border-b border-slate-200 px-4">
        <icon-lucide-glasses data-test-id="lenchat-logo" class="size-5 text-blue-600" />
        <span class="text-sm font-semibold tracking-tight">LenChat</span>
      </div>
      <div class="border-b border-slate-200">
        <button
          data-test-id="conversation-new"
          class="w-full cursor-pointer text-xs font-medium text-slate-700 transition hover:bg-slate-100 hover:text-blue-700"
          @click="$emit('new')"
        >
          <span class="flex items-center gap-2 p-3">
            <icon-lucide-square-pen class="size-4" />New chat
          </span>
        </button>
        <button
          class="-mt-1 w-full cursor-pointer text-xs font-medium text-slate-700 transition hover:bg-slate-100 hover:text-blue-700"
          title="User Model"
          @click="$emit('userModel')"
        >
          <span class="flex items-center gap-2 p-3">
            <icon-lucide-user-round-cog class="size-4" />
            User Model
          </span>
        </button>
      </div>
      <nav class="flex-1 overflow-y-auto px-2 pb-3">
        <p class="px-2 py-2 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
          Recent
        </p>
        <div
          v-for="record in history"
          :key="record.id"
          class="group mb-0.5 flex min-w-0 items-center rounded-lg transition"
          :class="
            record.id === currentId
              ? 'bg-blue-50 text-blue-800'
              : 'text-slate-600 hover:bg-slate-100'
          "
        >
          <button
            class="min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-xs"
            :class="record.id === currentId ? 'font-medium' : ''"
            @click="$emit('open', record.id)"
          >
            {{ record.title }}
          </button>
          <button
            class="mr-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-white hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            :title="`Delete ${record.title}`"
            :aria-label="`Delete ${record.title}`"
            @click="$emit('delete', record.id)"
          >
            <icon-lucide-trash-2 class="size-3.5" />
          </button>
        </div>
      </nav>
      <div>
        <button
          class="flex w-full cursor-pointer items-center gap-2 p-3 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-blue-700"
          @click="$emit('new')"
        >
          <icon-lucide-refresh-cw class="size-4" />Reset
        </button>
      </div>
    </aside>

    <main class="relative flex min-w-0 flex-1 flex-col bg-white">
      <slot />
    </main>
  </div>
</template>
