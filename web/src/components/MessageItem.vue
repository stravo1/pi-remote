<script setup lang="ts">
import { renderMarkdown } from "../markdown.ts";
import { getSender, type TranscriptMessage } from "../transcript.ts";

const props = defineProps<{ message: TranscriptMessage; isGroupStart: boolean }>();

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function formatTime(): string {
  return props.message.timestamp ? timeFormat.format(props.message.timestamp) : "";
}

function splitToolCall(text: string): [string, string] {
  const [name, ...rest] = text.split(" ");
  return [name, rest.join(" ")];
}
</script>

<template>
  <article :class="isGroupStart ? 'mt-5 first:mt-0' : 'mt-1'">
    <div class="min-w-0 space-y-1.5">
      <header v-if="isGroupStart" class="flex items-baseline gap-2">
        <span class="text-lg font-medium text-ink-gray-9 sm:text-base">{{ getSender(message.role) }}</span>
        <time class="text-p-xs text-ink-gray-5">{{ formatTime() }}</time>
      </header>
      <details v-if="message.role === 'toolResult'" class="group rounded-4 border border-outline-gray-1 text-base sm:text-p-sm">
        <summary class="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-ink-gray-5 hover:text-ink-gray-7">
          <span class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />Output
        </summary>
        <pre v-for="(block, index) in message.content" :key="index"
          class="overflow-x-auto whitespace-pre-wrap break-words border-t border-outline-gray-1 bg-surface-gray-1 p-3 font-mono text-ink-gray-7">{{ block.text }}</pre>
      </details>
      <template v-else v-for="(block, index) in message.content" :key="index">
        <details v-if="block.type === 'thinking'" class="group text-base text-ink-gray-5 sm:text-p-sm">
          <summary class="flex cursor-pointer select-none list-none items-center gap-1.5 hover:text-ink-gray-7">
            <span class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />Thinking
          </summary>
          <p class="mt-2 whitespace-pre-wrap break-words border-l-2 border-outline-gray-2 pl-3">{{ block.text }}</p>
        </details>
        <div v-else-if="block.type === 'toolCall'" class="flex items-center gap-2 rounded-4 border border-outline-gray-1 bg-surface-gray-1 px-3 py-2 text-base sm:text-p-sm">
          <span class="lucide-terminal size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <span class="font-medium text-ink-gray-8">{{ splitToolCall(block.text)[0] }}</span>
          <code class="min-w-0 flex-1 truncate font-mono text-[0.9em] text-ink-gray-6">{{ splitToolCall(block.text)[1] }}</code>
        </div>
        <p v-else-if="block.text && message.role === 'user'" class="whitespace-pre-wrap break-words text-lg leading-relaxed text-ink-gray-8 sm:text-p-base">{{ block.text }}</p>
        <div v-else-if="block.text" class="markdown" v-html="renderMarkdown(block.text)" />
      </template>
    </div>
  </article>
</template>
