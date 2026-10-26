<script setup lang="ts">
import { computed, ref } from "vue";
import { getDiffKind, getRequestedDiff, getToolCommand, type ToolCall } from "../tools.ts";

const props = defineProps<{ tool: ToolCall }>();
const diff = computed(() => props.tool.diff ?? getRequestedDiff(props.tool));
const isOutputOpen = ref(false);
const statusIcons = {
  pending: "lucide-clock text-ink-gray-5",
  running: "lucide-loader-circle animate-spin text-ink-gray-6",
  success: "lucide-check text-ink-gray-7",
  error: "lucide-circle-x text-ink-red-4",
  interrupted: "lucide-ban text-ink-gray-5",
};
const statusLabels = {
  pending: "Pending",
  running: "Running",
  success: "Completed",
  error: "Failed",
  interrupted: "Interrupted",
};
</script>

<template>
  <div
    class="min-w-0 overflow-hidden rounded-4 border border-outline-gray-2 text-p-sm"
    :aria-label="`${tool.name}: ${statusLabels[tool.status]}`"
  >
    <component
      :is="tool.output ? 'button' : 'div'"
      :type="tool.output ? 'button' : undefined"
      :aria-expanded="tool.output ? isOutputOpen : undefined"
      :class="[
        'flex w-full flex-wrap items-center gap-x-2 bg-surface-gray-1 px-3 py-2 text-left sm:flex-nowrap sm:py-1.5',
        tool.output && 'hover:bg-surface-gray-2',
      ]"
      @click="tool.output && (isOutputOpen = !isOutputOpen)"
    >
      <span class="lucide-terminal size-4 shrink-0 self-center text-ink-gray-6" aria-hidden="true" />
      <span class="order-1 min-w-0 flex-1 font-medium text-ink-gray-9 sm:flex-none">{{ tool.name }}</span>
      <span
        :class="['order-2 size-4 shrink-0 sm:order-3', statusIcons[tool.status]]"
        role="img"
        :aria-label="statusLabels[tool.status]"
        :title="statusLabels[tool.status]"
      />
      <span
        v-if="tool.output"
        :class="[
          isOutputOpen ? 'lucide-chevrons-down-up' : 'lucide-chevrons-up-down',
          'order-3 size-4 shrink-0 self-center text-ink-gray-5 sm:order-4',
        ]"
        aria-hidden="true"
      />
      <span
        class="order-4 mt-1 block w-full whitespace-pre-wrap break-all font-mono text-ink-gray-7 sm:order-2 sm:mt-0 sm:w-auto sm:min-w-0 sm:flex-1"
        >{{ getToolCommand(tool) }}</span
      >
    </component>
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
        :class="['block whitespace-pre-wrap break-all px-3', { 'bg-surface-gray-2 text-ink-gray-9': getDiffKind(line) === 'added', 'bg-surface-red-1 text-ink-red-4': getDiffKind(line) === 'removed' }]">{{ line || ' ' }}</code></pre>
    </details>
    <pre
      v-if="tool.output && isOutputOpen"
      class="max-h-96 overflow-y-auto whitespace-pre-wrap break-all border-t border-outline-gray-1 p-3 font-mono text-p-sm text-ink-gray-7"
      >{{ tool.output }}</pre>
  </div>
</template>
