<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { computed, ref } from 'vue'

import { propositions, resetUserModel, userModel } from '@/app/user-model/store'
import { importUserModel } from '@/app/user-model/use'
import AppTextButton from '@/components/ui/AppTextButton.vue'

import type { PipelineStage, SavedProposition } from '@/app/user-model/pipeline'
import type { UserModelStatus } from '@/app/user-model/store'

/**
 * The user model this tab is building from its own screen captures — a live
 * view of `captures/user-model.json` as it is revised.
 *
 * Dev-only, like the capture that feeds it, so the labels here are plain
 * English rather than i18n keys.
 */

const STATUS_TEXT: Record<UserModelStatus, string> = {
  idle: 'Click anywhere to start observing',
  observing: 'Observing',
  unconfigured: 'Observing — needs an API key and VITE_OPENAI_API_KEY',
  stopped: 'Stopped'
}

const STAGE_TEXT: Record<PipelineStage, string> = {
  idle: '',
  proposing: 'reading frames…',
  revising: 'revising…',
  reasoning: 'working out why…'
}

const status = computed(() => STAGE_TEXT[userModel.stage] || STATUS_TEXT[userModel.status])
const live = computed(() => userModel.status === 'observing')

function timeOf(updatedAt: string): string {
  const at = new Date(updatedAt)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString()
}

/** Back to the 1-10 the model was asked for; 0-1 reads as noise in a list. */
function outOfTen(value: number): number {
  return Math.round(value * 9 + 1)
}

function onReset() {
  resetUserModel()
}

/**
 * The extension's own postMessage protocol — see extension/README.md and
 * extension/content-script.js. The extension shows its own confirm dialog
 * before it hands anything over, so a decline arrives as a normal response
 * rather than the request just going unanswered.
 */
interface ExtensionUserModelResponse {
  source: 'open-pencil-extension'
  type: 'USER_MODEL_RESPONSE'
  requestId: string
  declined: boolean
  payload: { updatedAt: string; propositions: SavedProposition[] } | null
  error?: string | null
}

const importNote = ref('')

function requestUserModelFromExtension(): void {
  const requestId = crypto.randomUUID()
  importNote.value = 'Waiting for the extension…'

  function onMessage(event: MessageEvent): void {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data as Partial<ExtensionUserModelResponse> | null
    if (!data || data.source !== 'open-pencil-extension') return
    if (data.type !== 'USER_MODEL_RESPONSE' || data.requestId !== requestId) return
    window.removeEventListener('message', onMessage)

    if (data.declined) {
      importNote.value = 'Declined in the extension.'
      return
    }
    if (data.error) {
      importNote.value = `Extension error: ${data.error}`
      return
    }
    if (!data.payload || data.payload.propositions.length === 0) {
      importNote.value = 'The extension has nothing captured yet.'
      return
    }
    void importUserModel(data.payload.propositions)
    importNote.value = ''
  }

  window.addEventListener('message', onMessage)
  window.postMessage(
    { source: 'open-pencil-site', type: 'REQUEST_USER_MODEL', requestId },
    window.location.origin
  )
}
</script>

<template>
  <div data-test-id="user-model-panel-root" class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5"
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="[
            live ? 'bg-success' : 'bg-muted/50',
            userModel.stage === 'idle' ? '' : 'animate-pulse'
          ]"
        />
        <span class="truncate text-[11px] text-muted">{{ status }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <span class="text-[11px] text-muted/60">
          {{ userModel.frames }} frames<template v-if="userModel.idleBatches">
            · {{ userModel.idleBatches }} still</template
          >
          · {{ propositions.length }}
        </span>
        <AppTextButton
          v-if="userModel.canReset"
          test-id="user-model-panel-reset"
          :ui="{ base: 'rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover' }"
          @click="onReset"
        >
          Reset
        </AppTextButton>
      </div>
    </div>

    <div
      v-if="userModel.lastError"
      data-test-id="user-model-panel-error"
      class="shrink-0 border-b border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200"
    >
      {{ userModel.lastError }}
    </div>

    <div
      v-if="propositions.length === 0"
      data-test-id="user-model-panel-empty"
      class="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
    >
      <icon-lucide-brain class="size-5 text-muted/40" />
      <span class="text-xs text-muted">Nothing inferred yet</span>
      <span class="text-[11px] text-muted/60">
        The screen is read every 5s; every 6 frames become propositions, which are then merged into
        the ones already here.
      </span>
      <AppTextButton
        test-id="user-model-panel-import-from-extension"
        :ui="{ base: 'mt-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover' }"
        @click="requestUserModelFromExtension"
      >
        Load user model from extension
      </AppTextButton>
      <span v-if="importNote" class="text-[11px] text-muted/60">{{ importNote }}</span>
    </div>

    <ScrollAreaRoot v-else data-test-id="user-model-panel" class="min-h-0 flex-1">
      <ScrollAreaViewport class="size-full">
        <ul class="flex flex-col gap-px p-2">
          <li
            v-for="proposition in propositions"
            :key="proposition.id"
            data-test-id="user-model-proposition"
            class="rounded px-2 py-1.5 hover:bg-hover"
            :title="proposition.reasoning"
          >
            <p
              class="text-xs leading-5"
              :class="proposition.confidence < 0.25 ? 'text-muted line-through' : 'text-surface'"
            >
              {{ proposition.text }}
            </p>
            <p class="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted/60">
              <span :title="`confidence ${outOfTen(proposition.confidence)}/10`">
                ●{{ outOfTen(proposition.confidence) }}
              </span>
              <span :title="`decays at ${outOfTen(proposition.decay)}/10`">
                ↓{{ outOfTen(proposition.decay) }}
              </span>
              <span>{{ proposition.observations }}× seen</span>
              <span>{{ timeOf(proposition.updatedAt) }}</span>
            </p>
          </li>
        </ul>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
        <ScrollAreaThumb class="relative flex-1 rounded-full bg-white/10" />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  </div>
</template>
