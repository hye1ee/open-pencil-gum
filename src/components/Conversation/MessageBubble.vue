<script setup lang="ts">
import { getToolName, isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai'
import { computed } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'

import LenChatCodeBlock from '@/components/Conversation/LenChatCodeBlock.vue'
import ReasoningStatus from '@/components/Conversation/ReasoningStatus.vue'
import SearchResults from '@/components/Conversation/SearchResults.vue'
import ToolActivityList from '@/components/Conversation/ToolActivityList.vue'
import type { ConversationToolActivity } from '@/app/conversation/types'
import type { SourceUrlUIPart, UIMessage } from 'ai'

const { message, active, reasoningChunks, reasoningHighlight } = defineProps<{
  message: UIMessage
  active: boolean
  reasoningChunks: string[]
  reasoningHighlight: string
}>()
const conversationNodeRenderers = { code: LenChatCodeBlock }
const conversationPreload = { nodeRenderers: [] }
const reasoning = computed(() =>
  message.parts
    .filter(isReasoningUIPart)
    .map((part) => part.text)
    .join('\n')
)
const reasoningActive = computed(
  () =>
    active &&
    (reasoning.value === '' ||
      message.parts.some((part) => isReasoningUIPart(part) && part.state === 'streaming'))
)
const searchSources = computed<SourceUrlUIPart[]>(() =>
  message.parts.filter((part): part is SourceUrlUIPart => part.type === 'source-url')
)

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    google_search: 'Google Search',
    code_execution: 'Code execution',
    url_context: 'URL context'
  }
  return labels[name] ?? name.replaceAll('_', ' ')
}

const toolActivities = computed<ConversationToolActivity[]>(() =>
  message.parts.flatMap((part, index) => {
    if (!isToolUIPart(part)) return []
    const name = getToolName(part)
    let state: ConversationToolActivity['state'] = 'running'
    if (part.state === 'output-available') state = 'complete'
    else if (part.state === 'output-error' || part.state === 'output-denied') state = 'failed'
    const output = part.state === 'output-available' ? part.output : undefined
    const errorText = part.state === 'output-error' ? part.errorText : undefined
    return [
      {
        id: part.toolCallId || `${message.id}-${index}`,
        name,
        label: toolLabel(name),
        state,
        input: part.input,
        output,
        errorText,
        providerExecuted: part.providerExecuted
      }
    ]
  })
)
</script>

<template>
  <article
    :data-test-id="`conversation-message-${message.role}`"
    class="mx-auto flex w-full max-w-3xl gap-3 px-4 py-5 sm:px-6"
    :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <div
      v-if="message.role === 'assistant'"
      class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm"
    >
      <icon-lucide-glasses class="size-3.5" />
    </div>
    <div
      class="min-w-0"
      :class="
        message.role === 'user'
          ? 'max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-white'
          : 'flex-1'
      "
    >
      <template v-if="message.role === 'assistant'">
        <ReasoningStatus
          :reasoning="reasoning"
          :active="active"
          :reasoning-active="reasoningActive"
          :reasoning-chunks="reasoningChunks"
          :highlight="reasoningHighlight"
        />
        <ToolActivityList :tools="toolActivities" />
        <slot name="meta-agent" />
        <template v-for="(part, index) in message.parts" :key="`${message.id}-${index}`">
          <div
            v-if="isTextUIPart(part) && part.text"
            class="conversation-markdown text-[15px] leading-7 text-slate-800"
          >
            <Markdown
              :content="part.text"
              :mermaid="false"
              :mode="active ? 'streaming' : 'static'"
              :enable-animate="active"
              :node-renderers="conversationNodeRenderers"
              :preload="conversationPreload"
            />
          </div>
        </template>
        <SearchResults :sources="searchSources" />
      </template>
      <p v-else class="text-[15px] leading-6 whitespace-pre-wrap">
        {{
          message.parts
            .filter(isTextUIPart)
            .map((part) => part.text)
            .join('')
        }}
      </p>
    </div>
  </article>
</template>
