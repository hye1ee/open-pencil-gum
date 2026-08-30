<script setup lang="ts">
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'

defineEmits<{
  endSession: []
}>()

provideCollabPanel()
</script>

<template>
  <div class="flex w-full items-center justify-end gap-2">
    <CollabAvatarStack />
    <div class="flex-1" />
    <CollabSharePopover />
    <button
      type="button"
      data-test-id="study-end-session"
      class="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-none bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90"
      @click="$emit('endSession')"
    >
      <icon-lucide-flag class="size-3.5" />
      End session
    </button>
  </div>
</template>
