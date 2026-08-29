import { computed, ref, watch } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  apiKey,
  customAPIType,
  customBaseURL,
  customModelID,
  isACPProvider,
  isConfigured as isSettingsConfigured,
  maxOutputTokens,
  modelID,
  pexelsApiKey,
  providerDef,
  providerID,
  registerAIChatEffects,
  setAPIKey,
  unsplashAccessKey
} from '@/app/ai/chat/storage'
import { createChatSessionManager } from '@/app/ai/chat/transports'
import { resolveModelSlot } from '@/app/ai/model-routing'
import { exposeChatTransportOverride } from '@/app/browser-bridge'
import { getActiveEditorStore } from '@/app/editor/active-store'
import { getStudyRuntime, studyRuntime } from '@/app/study/runtime'

/** The right-hand panel's tabs. `user-model` only exists in dev builds. */
export type PanelTab = 'design' | 'code' | 'ai' | 'user-model'

const activeTab = ref<PanelTab>('design')

/** Whether the design agent's model came from `.env` rather than the panel. */
const taskSlotFromEnv = computed(() => resolveModelSlot('task').source !== 'settings')

/**
 * `ChatPanel` shows the provider setup screen while this is false. Widened past
 * the panel's own settings so a machine configured entirely through `.env` never
 * has to open it — that is the whole point of putting the routing there.
 */
const isConfigured = computed(() => isSettingsConfigured.value || taskSlotFromEnv.value)

/**
 * An ACP agent is a subprocess, not a model to call, so it cannot serve a slot.
 * When `.env` names a task model it has to win, or the panel's leftover ACP
 * selection would quietly route the run somewhere else.
 */
const useACPTransport = computed(() => isACPProvider.value && !taskSlotFromEnv.value)

const chatSession = createChatSessionManager({
  isConfigured,
  isACPProvider: useACPTransport,
  providerID,
  maxOutputTokens,
  getActiveEditorStore,
  getStudyRuntime
})

watch(studyRuntime, chatSession.markTransportDirty, { flush: 'sync' })

registerAIChatEffects(chatSession.markTransportDirty)

if (IS_BROWSER) {
  exposeChatTransportOverride((factory) => {
    chatSession.setOverrideTransport(factory)
  })
}

export function useAIChat() {
  return {
    providerID,
    providerDef,
    apiKey,
    setAPIKey,
    modelID,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    pexelsApiKey,
    unsplashAccessKey,
    activeTab,
    isConfigured,
    ensureChat: chatSession.ensureChat,
    noteUserRequest: chatSession.noteUserRequest,
    resetChat: chatSession.resetChat,
    askUserQuestion: chatSession.askUserQuestion,
    answerAskUser: chatSession.answerAskUser,
    stopAskUser: chatSession.stopAskUser
  }
}
