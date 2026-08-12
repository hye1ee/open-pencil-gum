<script setup lang="ts">
import {
  SplitterGroup,
  SplitterPanel,
  SplitterResizeHandle,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'
import { useAIChat } from '@/app/ai/chat/use'

import ChatPanel from './ChatPanel.vue'
import CodePanel from './CodePanel.vue'
import DesignPanel from './DesignPanel.vue'
import ReasoningInteractionPanel from './ReasoningInteractionPanel.vue'
import UserModelPanel from './UserModelPanel.vue'
import ZoomDropdown from './ZoomDropdown.vue'

const { activeTab } = useAIChat()
const { panels } = useI18n()

/** Rides along with page capture, which is dev-only, so it needs no i18n key. */
const showUserModel = import.meta.env.DEV
</script>

<template>
  <aside
    data-test-id="properties-panel"
    class="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-panel"
    style="contain: paint layout style"
  >
    <SplitterGroup direction="vertical" auto-save-id="properties-layout" class="flex-1 overflow-hidden">
      <SplitterPanel :default-size="60" :min-size="20" class="flex flex-col overflow-hidden">
        <TabsRoot v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
          <!-- Scrolls rather than wraps: the dev-only fourth tab can outgrow a narrow panel. -->
          <TabsList
            class="scrollbar-none flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2"
          >
            <TabsTrigger
              value="design"
              data-test-id="properties-tab-design"
              class="shrink-0 rounded px-2.5 py-1 text-xs whitespace-nowrap text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
            >
              {{ panels.design }}
            </TabsTrigger>
            <TabsTrigger
              value="code"
              data-test-id="properties-tab-code"
              class="flex shrink-0 items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
            >
              <icon-lucide-code class="size-3" />
              {{ panels.code }}
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              data-test-id="properties-tab-ai"
              class="flex shrink-0 items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
            >
              <icon-lucide-sparkles class="size-3" />
              {{ panels.ai }}
            </TabsTrigger>
            <TabsTrigger
              v-if="showUserModel"
              value="user-model"
              data-test-id="properties-tab-user-model"
              class="flex shrink-0 items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap text-muted hover:text-surface data-[state=active]:font-semibold data-[state=active]:text-surface"
            >
              <icon-lucide-brain class="size-3" />
              User Model
            </TabsTrigger>
            <ZoomDropdown v-if="activeTab === 'design'" />
          </TabsList>

          <TabsContent
            value="design"
            class="flex min-h-0 flex-1 flex-col"
            :force-mount="true"
            :hidden="activeTab !== 'design'"
          >
            <DesignPanel />
          </TabsContent>

          <TabsContent
            value="code"
            class="flex min-h-0 flex-1 flex-col"
            :force-mount="true"
            :hidden="activeTab !== 'code'"
          >
            <CodePanel />
          </TabsContent>

          <TabsContent
            value="ai"
            class="flex min-h-0 flex-1 flex-col"
            :force-mount="true"
            :hidden="activeTab !== 'ai'"
          >
            <ChatPanel />
          </TabsContent>

          <TabsContent
            v-if="showUserModel"
            value="user-model"
            class="flex min-h-0 flex-1 flex-col"
            :force-mount="true"
            :hidden="activeTab !== 'user-model'"
          >
            <UserModelPanel />
          </TabsContent>
        </TabsRoot>
      </SplitterPanel>
      <SplitterResizeHandle class="group relative z-10 -my-1 h-2 cursor-row-resize">
        <div
          class="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border"
        />
      </SplitterResizeHandle>
      <SplitterPanel :default-size="40" :min-size="10" class="flex flex-col overflow-hidden">
        <ReasoningInteractionPanel />
      </SplitterPanel>
    </SplitterGroup>
  </aside>
</template>
