<script setup lang="ts">
import type { TranscriptMessage } from "../transcript.ts";

defineProps<{ message: TranscriptMessage }>();

function splitToolCall(text: string): [string, string] {
  const [name, ...rest] = text.split(" ");
  return [name, rest.join(" ")];
}
</script>

<template>
  <article :class="['flex', message.role === 'user' ? 'justify-end' : 'justify-start']">
    <div v-if="message.role === 'user'" class="max-w-[85%] rounded-5 bg-surface-gray-2 px-4 py-2.5">
      <p v-for="(block, index) in message.content" :key="index" class="whitespace-pre-wrap break-words text-p-base text-ink-gray-9">{{ block.text }}</p>
    </div>
    <details v-else-if="message.role === 'toolResult'" class="w-full rounded-4 border border-outline-gray-1 text-p-sm">
      <summary class="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-ink-gray-5 hover:text-ink-gray-7">
        <span class="lucide-corner-down-right size-3.5" aria-hidden="true" />Output
      </summary>
      <pre v-for="(block, index) in message.content" :key="index"
        class="overflow-x-auto whitespace-pre-wrap break-words border-t border-outline-gray-1 bg-surface-gray-1 p-3 font-mono text-ink-gray-7">{{ block.text }}</pre>
    </details>
    <div v-else class="w-full min-w-0 space-y-3">
      <template v-for="(block, index) in message.content" :key="index">
        <details v-if="block.type === 'thinking'" class="text-p-sm text-ink-gray-5">
          <summary class="cursor-pointer select-none hover:text-ink-gray-7">Thinking</summary>
          <p class="mt-2 whitespace-pre-wrap break-words border-l-2 border-outline-gray-2 pl-3">{{ block.text }}</p>
        </details>
        <div v-else-if="block.type === 'toolCall'" class="flex items-center gap-2 rounded-4 border border-outline-gray-1 bg-surface-gray-1 px-3 py-2 text-p-sm">
          <span class="lucide-terminal size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <span class="font-medium text-ink-gray-8">{{ splitToolCall(block.text)[0] }}</span>
          <code class="min-w-0 flex-1 truncate font-mono text-ink-gray-6">{{ splitToolCall(block.text)[1] }}</code>
        </div>
        <p v-else-if="block.text" class="whitespace-pre-wrap break-words text-p-base leading-relaxed text-ink-gray-8">{{ block.text }}</p>
      </template>
    </div>
  </article>
</template>
