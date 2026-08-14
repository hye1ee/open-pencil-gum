<script setup lang="ts">
import SteeringQuestions from './chat/SteeringQuestions.vue'
import SteeringRings from './chat/SteeringRings.vue'

/**
 * Sits under the properties tabs and stays visible whichever tab is open.
 * Height comes from the splitter around it.
 */
</script>

<template>
  <section
    data-test-id="reasoning-interaction-panel"
    class="flex min-h-0 flex-1 flex-col border-t border-border bg-panel"
  >
    <header class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3">
      <icon-lucide-message-circle class="size-3 text-muted" />
      <span class="text-xs font-semibold">Steering Space</span>
    </header>

    <SteeringRings />
    <SteeringQuestions />
  </section>
</template>
