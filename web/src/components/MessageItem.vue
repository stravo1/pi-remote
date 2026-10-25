<script setup lang="ts">
import type { TranscriptMessage } from "../transcript.ts";

defineProps<{ message: TranscriptMessage }>();
</script>

<template>
  <article :class="['flex', message.role === 'user' ? 'justify-end' : 'justify-start']">
    <div :class="['min-w-0 space-y-2', message.role === 'user' ? 'max-w-[85%] rounded-5 bg-surface-gray-2 px-4 py-2.5' : 'w-full']">
      <p v-if="message.role === 'toolResult'" class="text-p-sm font-medium text-ink-gray-5">Tool result</p>
      <template v-for="(block, index) in message.content" :key="index">
        <details v-if="block.type === 'thinking'" class="text-p-sm text-ink-gray-5">
          <summary class="cursor-pointer select-none hover:text-ink-gray-7">Thinking</summary>
          <p class="mt-2 whitespace-pre-wrap break-words">{{ block.text }}</p>
        </details>
        <pre v-else-if="block.type === 'toolCall' || message.role === 'toolResult'"
          class="overflow-x-auto whitespace-pre-wrap break-words rounded-3 border border-outline-gray-1 bg-surface-gray-1 p-3 font-mono text-p-sm text-ink-gray-7">{{ block.text }}</pre>
        <p v-else class="whitespace-pre-wrap break-words text-p-base text-ink-gray-8">{{ block.text }}</p>
      </template>
    </div>
  </article>
</template>
