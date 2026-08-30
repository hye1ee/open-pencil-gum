<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClipboard, useTimeoutFn } from '@vueuse/core'

import { seedStudyUserModel, studyScenarioFixture } from '@/app/study/scenario-fixture'
import type { StudyCondition, StudyHost } from '@/app/study/runtime'

const { host, condition } = defineProps<{
  host: StudyHost
  condition: StudyCondition
}>()

const fixture = computed(() => studyScenarioFixture(host, condition))
const isDevelopment = import.meta.env.DEV
const seeded = ref(false)
const saving = ref(false)
const { copy, copied } = useClipboard({ source: computed(() => fixture.value.prompt) })
const { start: clearSeeded } = useTimeoutFn(() => (seeded.value = false), 2500, {
  immediate: false
})

async function seed(): Promise<void> {
  saving.value = true
  try {
    await seedStudyUserModel(fixture.value)
    seeded.value = true
    clearSeeded()
  } finally {
    saving.value = false
  }
}

function selectPrompt(event: FocusEvent): void {
  if (event.currentTarget instanceof HTMLTextAreaElement) event.currentTarget.select()
}
</script>

<template>
  <aside
    v-if="isDevelopment"
    data-test-id="study-scenario-panel"
    class="fixed bottom-3 left-3 z-[100] w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-amber-300 bg-amber-50 p-3 text-slate-800 shadow-xl"
  >
    <div class="mb-2 flex items-center justify-between gap-3">
      <div>
        <p class="text-[10px] font-bold tracking-wider text-amber-700 uppercase">Temporary test</p>
        <p class="text-xs font-semibold">{{ fixture.title }} · 20 propositions</p>
      </div>
      <button
        type="button"
        data-test-id="study-seed-user-model"
        :disabled="saving"
        class="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        @click="seed"
      >
        {{ saving ? 'Saving…' : seeded ? 'Added ✓' : 'Add to user model' }}
      </button>
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
  </aside>
</template>
