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
import { getDiffKind, getRequestedDiff, getToolCommand, type ToolCall } from "../tools.ts";

const props = defineProps<{ tool: ToolCall; isFlat?: boolean }>();
const diff = computed(() => props.tool.diff ?? getRequestedDiff(props.tool));
const isOutputOpen = ref(false);
</script>

<template>
  <div
    :class="['min-w-0 overflow-hidden text-p-sm', { 'rounded-4 border border-outline-gray-2': !isFlat }]"
    :aria-label="`${tool.name}: ${toolStatusLabels[tool.status]}`"
  >
    <button
      type="button"
      :aria-expanded="isOutputOpen"
      class="flex w-full items-center gap-2 bg-surface-gray-1 px-3 py-2 text-left hover:bg-surface-gray-2 sm:py-1.5"
      @click="isOutputOpen = !isOutputOpen"
    >
      <span class="lucide-terminal size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
      <span class="shrink-0 font-medium text-ink-gray-9">{{ tool.name }}</span>
      <span class="min-w-0 flex-1 truncate font-mono text-ink-gray-6">{{ getToolCommand(tool) }}</span>
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
      <pre class="whitespace-pre-wrap break-all px-3 py-2 text-ink-gray-9">{{ getToolCommand(tool) }}</pre>
      <pre
        v-if="tool.output"
        class="whitespace-pre-wrap break-all border-t border-outline-gray-1 px-3 py-2 text-ink-gray-7"
        >{{ tool.output }}</pre>
    </div>
  </div>
</template>
