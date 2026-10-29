<script lang="ts">
export const toolStatusIcons = {
  pending: "lucide-clock text-ink-gray-5",
  running: "lucide-loader-circle animate-spin text-ink-gray-6",
  success: "lucide-check text-ink-gray-7",
  error: "lucide-circle-x text-ink-red-4",
  interrupted: "lucide-ban text-ink-gray-5",
};

export const toolStatusLabels = {
  pending: "Pending",
  running: "Running",
  success: "Completed",
  error: "Failed",
  interrupted: "Interrupted",
};
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  getDiffKind,
  getRequestedDiff,
  getToolCommand,
  getToolSource,
  splitToolName,
  type ToolCall,
} from "../tools.ts";

const props = defineProps<{ tool: ToolCall; isFlat?: boolean }>();
const diff = computed(() => props.tool.diff ?? getRequestedDiff(props.tool));
const isOutputOpen = ref(false);
// MCP tools are named mcp__<server>__<tool>; the row shows both parts.
const nameParts = computed(() => splitToolName(props.tool.name));
const command = computed(() => getToolCommand(props.tool));
const source = computed(() => getToolSource(props.tool));

// A long script may call many tools; the card keeps a bounded list.
const MAX_NESTED_ROWS = 6;
const nestedCalls = computed(() => props.tool.nested ?? []);
const visibleNested = computed(() => nestedCalls.value.slice(0, MAX_NESTED_ROWS));
const hiddenNestedCount = computed(() => Math.max(0, nestedCalls.value.length - MAX_NESTED_ROWS));

function nestedCommand(call: (typeof nestedCalls.value)[number]): string {
  return getToolCommand({
    id: call.id,
    name: call.name,
    arguments: call.arguments ?? {},
    status: call.status,
    output: "",
  });
}

function nestedDuration(durationMs?: number): string {
  if (!durationMs) return "";
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}
</script>

<template>
  <div
    :class="['min-w-0 overflow-hidden text-p-sm', { 'rounded-4 border border-outline-gray-2': !isFlat }]"
    :aria-label="`${tool.name}: ${toolStatusLabels[tool.status]}`"
  >
    <button
      type="button"
      :aria-expanded="isOutputOpen"
      :title="`${tool.name} ${command}`"
      class="flex w-full items-center gap-2 bg-surface-gray-1 px-3 py-2 text-left hover:bg-surface-gray-2 sm:py-1.5"
      @click="isOutputOpen = !isOutputOpen"
    >
      <span class="lucide-terminal size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
      <span v-if="nameParts.server" class="min-w-0 shrink truncate font-mono text-ink-gray-5">{{
        nameParts.server
      }}</span>
      <span class="min-w-0 shrink truncate font-medium text-ink-gray-9">{{ nameParts.tool }}</span>
      <span class="min-w-0 flex-1 truncate font-mono text-ink-gray-6">{{ command }}</span>
      <span
        :class="['size-4 shrink-0', toolStatusIcons[tool.status]]"
        role="img"
        :aria-label="toolStatusLabels[tool.status]"
        :title="toolStatusLabels[tool.status]"
      />
      <span
        :class="[
          isOutputOpen ? 'lucide-chevrons-down-up' : 'lucide-chevrons-up-down',
          'size-4 shrink-0 text-ink-gray-5',
        ]"
        aria-hidden="true"
      />
    </button>
    <ul v-if="nestedCalls.length" class="border-t border-outline-gray-1">
      <li
        v-for="call in visibleNested"
        :key="call.id"
        class="flex items-center gap-2 py-1.5 pl-6 pr-3 text-p-sm sm:py-1"
        :aria-label="`${call.name}: ${toolStatusLabels[call.status]}`"
      >
        <span :class="['size-3.5 shrink-0', toolStatusIcons[call.status]]" aria-hidden="true" />
        <span class="min-w-0 shrink truncate font-mono">{{ call.name }}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-ink-gray-6">{{ nestedCommand(call) }}</span>
        <span v-if="nestedDuration(call.durationMs)" class="shrink-0 text-ink-gray-5">{{
          nestedDuration(call.durationMs)
        }}</span>
      </li>
      <li v-if="hiddenNestedCount" class="px-3 py-1 text-ink-gray-5">{{ hiddenNestedCount }} more calls</li>
    </ul>
    <details v-if="diff" class="group border-t border-outline-gray-1" open>
      <summary
        class="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-ink-gray-6 hover:text-ink-gray-8 sm:py-1"
      >
        <span
          class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />{{ tool.diff ? "File diff" : "Requested changes" }}
      </summary>
      <pre
        class="max-h-96 overflow-y-auto border-t border-outline-gray-1 font-mono text-p-sm"
      ><code v-for="(line, index) in diff.split('\n')" :key="index"
        :class="['block whitespace-pre-wrap break-all px-3', { 'bg-surface-green-1 text-ink-green-8': getDiffKind(line) === 'added', 'bg-surface-red-1 text-ink-red-8': getDiffKind(line) === 'removed' }]">{{ line || ' ' }}</code></pre>
    </details>
    <div v-if="isOutputOpen" class="max-h-96 overflow-y-auto border-t border-outline-gray-1 font-mono text-p-sm">
      <pre class="whitespace-pre-wrap break-all px-3 py-2 text-ink-gray-9">{{ source }}</pre>
      <pre
        v-if="tool.output"
        class="whitespace-pre-wrap break-all border-t border-outline-gray-1 px-3 py-2 text-ink-gray-7"
        >{{ tool.output }}</pre>
    </div>
  </div>
</template>
