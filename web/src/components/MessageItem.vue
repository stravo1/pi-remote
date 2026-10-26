<script setup lang="ts">
import ToolCard from "./ToolCard.vue";
import type { ToolCall } from "../tools.ts";
import { renderMarkdown } from "../markdown.ts";
import type { TranscriptMessage } from "../transcript.ts";

const props = defineProps<{ message: TranscriptMessage; isGroupStart: boolean; tools: Record<string, ToolCall> }>();
</script>

<template>
  <article v-if="message.role !== 'toolResult' || !message.toolCallId || !tools[message.toolCallId]" :class="isGroupStart ? 'mt-8 first:mt-0 sm:mt-5' : 'mt-3 sm:mt-1.5'">
    <div class="min-w-0 space-y-3 sm:space-y-1.5">
      <details v-if="message.role === 'toolResult'" class="group overflow-hidden rounded-4 border border-outline-gray-1 text-p-sm">
        <summary class="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-ink-gray-5 sm:py-1 hover:text-ink-gray-7">
          <span class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />Output
        </summary>
        <pre v-for="(block, index) in message.content" :key="index"
          class="overflow-x-auto whitespace-pre-wrap break-words border-t border-outline-gray-1 bg-surface-gray-1 p-3 font-mono text-ink-gray-7">{{ block.text }}</pre>
      </details>
      <template v-else v-for="(block, index) in message.content" :key="index">
        <details v-if="block.type === 'thinking'" class="group text-p-sm text-ink-gray-5">
          <summary class="flex cursor-pointer select-none list-none items-center gap-1.5 py-1 sm:py-0 hover:text-ink-gray-7">
            <span class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />Thinking
          </summary>
          <p class="mt-2 whitespace-pre-wrap break-words border-l-2 border-outline-gray-2 pl-3">{{ block.text }}</p>
        </details>
        <ToolCard v-else-if="block.toolCall && tools[block.toolCall.id]" :tool="tools[block.toolCall.id]" />
        <p v-else-if="block.text && message.role === 'user'" class="whitespace-pre-wrap break-words rounded-4 bg-surface-gray-2 px-4 py-3 sm:px-3 sm:py-2 leading-relaxed text-ink-gray-8 text-p-base">{{ block.text }}</p>
        <div v-else-if="block.text" class="markdown" v-html="renderMarkdown(block.text)" />
      </template>
    </div>
  </article>
</template>
