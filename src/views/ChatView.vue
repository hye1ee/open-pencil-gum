<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'

import AskUserCard from '@/components/Conversation/AskUserCard.vue'
import Composer from '@/components/Conversation/Composer.vue'
import ConversationShell from '@/components/Conversation/ConversationShell.vue'
import HandsOffAnnotationStage from '@/components/Conversation/HandsOffAnnotationStage.vue'
import MessageList from '@/components/Conversation/MessageList.vue'
import UserModelDrawer from '@/components/Conversation/UserModelDrawer.vue'
import StudyScenarioPanel from '@/components/StudyScenario/StudyScenarioPanel.vue'
import StudySessionSurveyOverlay from '@/components/StudySurvey/StudySessionSurveyOverlay.vue'
import { ConversationStore } from '@/app/conversation/session'
import {
  conversationApiKey,
  conversationApiKeyValue,
  conversationEnabledToolIds,
  conversationModelId,
  conversationModelIdValue,
  conversationModels,
  conversationToolsEnabled,
  conversationUsesEnvironmentKey,
  conversationUsesEnvironmentModel,
  CONVERSATION_TOOL_OPTIONS
} from '@/app/conversation/settings'
import { fadeOutGlobalLoader } from '@/app/editor/canvas/loader-overlay'
import {
  createStudyRuntimeConfig,
  isHandsOffDelegationCondition,
  resolveStudyCondition,
  setStudyRuntime
} from '@/app/study/runtime'
import type { ConversationFeedbackItem } from '@/app/conversation/types'
import type { HandsOffChatTextSelection } from '@/app/study/hands-off/chat-session'

useHead({
  title: 'LenChat',
  titleTemplate: null,
  link: [{ key: 'app-favicon', rel: 'icon', type: 'image/svg+xml', href: '/lenchat.svg?v=2' }]
})

const route = useRoute()
const runtime = computed(() =>
  createStudyRuntimeConfig('lenchat', resolveStudyCondition(route.meta.studyCondition))
)
setStudyRuntime('lenchat', runtime.value.condition)

const store = new ConversationStore({
  apiKey: conversationApiKeyValue,
  modelId: conversationModelIdValue,
  enabledTools: conversationEnabledToolIds,
  runtime: () => runtime.value
})
const {
  initialized,
  history,
  currentId,
  messages,
  status,
  feedbackNotes,
  feedbackPending,
  feedbackGenerating,
  reasoningReviews,
  askUserQuestion,
  revising,
  learning,
  propositions,
  configured,
  handsOffPhase,
  handsOffReasoningBlocks,
  handsOffAnnotations,
  handsOffFinalAnswerText,
  handsOffAnnotationPending,
  lastError
} = store

const handsOffActive = computed(() => isHandsOffDelegationCondition(runtime.value.condition))
const handsOffStageVisible = computed(
  () =>
    handsOffActive.value && handsOffPhase.value !== 'idle' && handsOffPhase.value !== 'completed'
)

const settingsOpen = ref(false)
const userModelOpen = ref(false)
const surveyOpen = ref(false)
const displayedConversationModelId = computed({
  get: conversationModelIdValue,
  set: (modelId: string) => {
    if (!conversationUsesEnvironmentModel) conversationModelId.value = modelId
  }
})
const currentModelName = computed(
  () =>
    conversationModels.find((model) => model.id === displayedConversationModelId.value)?.name ??
    displayedConversationModelId.value
)

onMounted(() => {
  // The design route removes the boot overlay when CanvasKit is ready. Chat
  // intentionally mounts no canvas, so it owns the equivalent ready handoff.
  fadeOutGlobalLoader()
  void store.initialize()
})

watch(runtime, async (next) => {
  setStudyRuntime('lenchat', next.condition)
  if (initialized.value) await store.reconfigure()
})

async function applySettings(): Promise<void> {
  settingsOpen.value = false
  await store.reconfigure()
}

function reviseFromFeedback(id: string, items: ConversationFeedbackItem[]): void {
  store.reviseFromFeedback(id, items)
}

function reviseFromReasoning(id: string, feedback: string, selectedReasoning: string | null): void {
  store.reviseFromReasoning(id, feedback, selectedReasoning)
}

function answerAskUser(answer: string, selectedOption: string | null): void {
  store.answerAskUser(answer, selectedOption)
}

function addHandsOffAnnotation(selection: HandsOffChatTextSelection): void {
  store.addHandsOffAnnotation(selection)
}

function finishHandsOffStage(): void {
  if (handsOffPhase.value === 'annotating-reasoning') store.finishHandsOffReasoningAnnotation()
  else store.finishHandsOffFinalAnswerAnnotation()
}
</script>

<template>
  <ConversationShell
    :history="history"
    :current-id="currentId"
    @new="store.newChat()"
    @open="store.openConversation($event)"
    @delete="store.removeConversation($event)"
    @user-model="userModelOpen = true"
    @end-session="surveyOpen = true"
  >
    <div v-if="!initialized" class="flex flex-1 items-center justify-center text-sm text-slate-500">
      <icon-lucide-loader-circle class="mr-2 size-4 animate-spin text-blue-600" />
      Loading conversations…
    </div>
    <template v-else>
      <MessageList
        :key="currentId"
        :messages="messages"
        :status="status"
        :feedback-notes="feedbackNotes"
        :feedback-generating="feedbackGenerating"
        :reasoning-reviews="reasoningReviews"
        :revising="revising"
        :propositions="propositions"
        :hide-assistant-messages="handsOffActive && handsOffPhase !== 'completed'"
        @continue="store.continueFromFeedback($event)"
        @feedback="reviseFromFeedback"
        @continue-reasoning="store.continueReasoningReview($event)"
        @reasoning-feedback="reviseFromReasoning"
      />
      <div v-if="lastError" class="mx-auto w-full max-w-3xl px-6 pb-2 text-xs text-red-600">
        {{ lastError }}
      </div>
      <HandsOffAnnotationStage
        v-if="handsOffStageVisible"
        :phase="handsOffPhase"
        :reasoning-blocks="handsOffReasoningBlocks"
        :final-answer-text="handsOffFinalAnswerText"
        :annotations="handsOffAnnotations"
        @annotate="addHandsOffAnnotation"
        @done="finishHandsOffStage"
      />
      <AskUserCard
        v-if="askUserQuestion"
        :question="askUserQuestion"
        @answer="answerAskUser"
        @stop="store.stop()"
      />
      <Composer
        v-else
        :status="status"
        :configured="configured"
        :blocked="feedbackPending || handsOffAnnotationPending"
        :model-name="currentModelName"
        @submit="store.send($event)"
        @stop="store.stop()"
        @settings="settingsOpen = true"
      />
    </template>

    <div
      v-if="settingsOpen"
      class="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-[1px]"
      @click.self="settingsOpen = false"
    >
      <form
        class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        @submit.prevent="applySettings"
      >
        <div class="mb-5 flex items-start justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-900">Model Setting</h2>
            <p class="mt-1 text-xs text-slate-500">
              Configure the Gemini model, API key, and available tools.
            </p>
          </div>
          <button
            type="button"
            class="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            @click="settingsOpen = false"
          >
            <icon-lucide-x class="size-4" />
          </button>
        </div>
        <label class="mb-4 block">
          <span class="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-700">
            Google AI API key
            <span
              v-if="conversationUsesEnvironmentKey"
              class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
            >
              Loaded from .env
            </span>
          </span>
          <input
            v-model="conversationApiKey"
            type="password"
            autocomplete="off"
            :placeholder="conversationUsesEnvironmentKey ? 'Using VITE_API_KEY_GOOGLE' : 'AIza…'"
            :disabled="conversationUsesEnvironmentKey"
            class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        <label class="mb-5 block">
          <span class="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-700">
            Gemini model
            <span
              v-if="conversationUsesEnvironmentModel"
              class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
            >
              Loaded from .env
            </span>
          </span>
          <select
            v-model="displayedConversationModelId"
            :disabled="conversationUsesEnvironmentModel"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option
              v-if="!conversationModels.some((model) => model.id === displayedConversationModelId)"
              :value="displayedConversationModelId"
            >
              {{ currentModelName }}
            </option>
            <option v-for="model in conversationModels" :key="model.id" :value="model.id">
              {{ model.name }}
            </option>
          </select>
        </label>
        <fieldset class="mb-5">
          <legend class="mb-2 text-xs font-medium text-slate-700">Tools</legend>
          <div class="divide-y divide-slate-100 rounded-xl border border-slate-200">
            <label
              v-for="tool in CONVERSATION_TOOL_OPTIONS"
              :key="tool.id"
              class="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5"
            >
              <span class="min-w-0">
                <span class="block text-sm font-medium text-slate-700">{{ tool.name }}</span>
                <span class="block text-[11px] leading-4 text-slate-500">{{
                  tool.description
                }}</span>
              </span>
              <input
                v-model="conversationToolsEnabled[tool.id]"
                type="checkbox"
                class="peer sr-only"
              />
              <span
                aria-hidden="true"
                class="relative h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-blue-200"
                :class="conversationToolsEnabled[tool.id] ? 'bg-blue-600' : 'bg-slate-200'"
              >
                <span
                  class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="conversationToolsEnabled[tool.id] ? 'translate-x-4' : ''"
                />
              </span>
            </label>
          </div>
        </fieldset>
        <div class="flex items-center justify-between">
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            class="text-xs font-medium text-blue-700 hover:underline"
            >Get an API key</a
          >
          <button
            type="submit"
            class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </form>
    </div>

    <UserModelDrawer
      :open="userModelOpen"
      :propositions="propositions"
      :learning="learning"
      @close="userModelOpen = false"
      @clear="store.clearUserModel()"
    />
  </ConversationShell>
  <StudyScenarioPanel host="lenchat" :condition="runtime.condition" />
  <StudySessionSurveyOverlay :open="surveyOpen" @close="surveyOpen = false" />
</template>
