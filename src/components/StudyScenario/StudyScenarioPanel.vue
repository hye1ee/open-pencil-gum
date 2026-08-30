<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClipboard, useTimeoutFn } from '@vueuse/core'

import { replaceUserModelFromJson } from '@/app/study/hands-off/user-model-injection'
import { seedStudyUserModel, studyScenarioFixture } from '@/app/study/scenario-fixture'
import { normalizeParticipantId } from '@/app/study/survey/participant'
import {
  loadStoredParticipantId,
  storeParticipantId
} from '@/app/study/survey/participant-storage'
import { captureStudyBaselineNow } from '@/app/study/survey/storage'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'

const { host, condition } = defineProps<{
  host: StudyHost
  condition: StudyCondition
}>()

const fixture = computed(() => studyScenarioFixture(host, condition))
const isDevelopment = import.meta.env.DEV
const panelCollapsed = ref(true)
const seeded = ref(false)
const saving = ref(false)
const { copy, copied } = useClipboard({ source: computed(() => fixture.value.prompt) })
const { start: clearSeeded } = useTimeoutFn(() => (seeded.value = false), 2500, {
  immediate: false
})

const participantId = ref(loadStoredParticipantId())
const seedError = ref('')

function updateParticipantId(): void {
  participantId.value = normalizeParticipantId(participantId.value)
  storeParticipantId(participantId.value)
}

async function seed(): Promise<void> {
  saving.value = true
  seedError.value = ''
  try {
    await seedStudyUserModel(fixture.value)
    await captureStudyBaselineNow(participantId.value)
    seeded.value = true
    clearSeeded()
  } catch (error) {
    seedError.value = error instanceof Error ? error.message : String(error)
  } finally {
    saving.value = false
  }
}

function selectPrompt(event: FocusEvent): void {
  if (event.currentTarget instanceof HTMLTextAreaElement) event.currentTarget.select()
}

const injectionJson = ref('')
const injecting = ref(false)
const injectionResult = ref('')
const injectionError = ref('')

async function injectUserModel(): Promise<void> {
  injecting.value = true
  injectionResult.value = ''
  injectionError.value = ''
  try {
    const count = await replaceUserModelFromJson(injectionJson.value)
    await captureStudyBaselineNow(participantId.value)
    injectionResult.value = `Replaced the user model with ${count} propositions. Baseline saved.`
  } catch (error) {
    injectionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    injecting.value = false
  }
}
</script>

<template>
  <button
    v-if="isDevelopment && panelCollapsed"
    type="button"
    data-test-id="study-scenario-panel-expand"
    class="fixed bottom-3 left-3 z-[100] flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800 shadow-lg hover:bg-amber-100"
    @click="panelCollapsed = false"
  >
    <icon-lucide-flask-conical class="size-3.5" />
    Study
  </button>
  <aside
    v-if="isDevelopment && !panelCollapsed"
    data-test-id="study-scenario-panel"
    class="fixed bottom-3 left-3 z-[100] w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-amber-300 bg-amber-50 p-3 text-slate-800 shadow-xl"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-bold tracking-wider text-amber-700 uppercase">Temporary test</p>
        <p class="text-xs font-semibold">{{ fixture.title }} · 20 propositions</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          data-test-id="study-seed-user-model"
          :disabled="saving"
          class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          @click="seed"
        >
          {{ saving ? 'Saving…' : seeded ? 'Added ✓' : 'Add to user model' }}
        </button>
        <button
          type="button"
          data-test-id="study-scenario-panel-collapse"
          aria-label="Collapse the study panel"
          class="flex size-7 cursor-pointer items-center justify-center rounded-lg text-amber-700 hover:bg-amber-100"
          @click="panelCollapsed = true"
        >
          <icon-lucide-chevron-down class="size-4" />
        </button>
      </div>
    </div>
    <textarea
      :value="fixture.prompt"
      readonly
      rows="4"
      data-test-id="study-scenario-prompt"
      class="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs leading-4 outline-none focus:border-amber-500"
      @focus="selectPrompt"
    />
    <button
      type="button"
      data-test-id="study-copy-prompt"
      class="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline"
      @click="copy()"
    >
      <icon-lucide-copy class="size-3" />
      {{ copied ? 'Copied' : 'Copy test prompt' }}
    </button>
    <div class="mt-2 border-t border-amber-200 pt-2">
      <p class="mb-1 text-[10px] font-bold tracking-wider text-amber-700 uppercase">
        Participant ID
      </p>
      <input
        v-model="participantId"
        type="text"
        data-test-id="study-participant-id"
        placeholder="p01"
        class="mb-2 w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-amber-500"
        @blur="updateParticipantId"
        @keydown.enter="updateParticipantId"
      />
      <p v-if="seedError" class="mb-1 text-[11px] text-red-600">{{ seedError }}</p>
      <p class="mb-1 text-[10px] font-bold tracking-wider text-amber-700 uppercase">
        Inject user model (JSON)
      </p>
      <textarea
        v-model="injectionJson"
        rows="3"
        data-test-id="study-inject-user-model-json"
        placeholder='{"propositions": [{"text": "…", "confidence": 0.8}]} or a bare array'
        class="w-full resize-y rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs leading-4 outline-none focus:border-amber-500"
      />
      <div class="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          data-test-id="study-inject-user-model"
          :disabled="injecting || injectionJson.trim() === ''"
          class="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          @click="injectUserModel"
        >
          {{ injecting ? 'Replacing…' : 'Replace user model' }}
        </button>
        <p v-if="injectionResult" class="text-[11px] text-emerald-700">{{ injectionResult }}</p>
        <p v-if="injectionError" class="text-[11px] text-red-600">{{ injectionError }}</p>
      </div>
    </div>
  </aside>
</template>
