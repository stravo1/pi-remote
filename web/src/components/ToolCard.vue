<script setup lang="ts">
import { computed } from "vue";
import { getDiffKind, getRequestedDiff, getToolCommand, type ToolCall } from "../tools.ts";

const props = defineProps<{ tool: ToolCall }>();
const diff = computed(() => props.tool.diff ?? getRequestedDiff(props.tool));
const statusLabels = { pending: "Pending", running: "Running", success: "Completed", error: "Failed", interrupted: "Interrupted" };
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-4 border border-outline-gray-2 text-p-sm" :aria-label="`${tool.name}: ${statusLabels[tool.status]}`">
    <div class="flex items-start gap-2 bg-surface-gray-1 px-3 py-2 sm:py-1.5">
      <span class="lucide-terminal mt-0.5 size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-medium text-ink-gray-9">{{ tool.name }}</span>
          <span :class="['text-p-xs', tool.status === 'error' ? 'text-ink-red-4' : 'text-ink-gray-5']" role="status">{{ statusLabels[tool.status] }}</span>
        </div>
        <pre class="mt-1 whitespace-pre-wrap break-all font-mono text-ink-gray-7">{{ getToolCommand(tool) }}</pre>
      </div>
    </div>
    <details v-if="diff" class="group border-t border-outline-gray-1" open>
      <summary class="cursor-pointer px-3 py-2 text-ink-gray-6 sm:py-1">{{ tool.diff ? 'File diff' : 'Requested changes' }}</summary>
      <pre class="max-h-96 overflow-y-auto border-t border-outline-gray-1 font-mono text-p-sm"><code v-for="(line, index) in diff.split('\n')" :key="index"
        :class="['block whitespace-pre-wrap break-all px-3', { 'bg-surface-green-1 text-ink-green-4': getDiffKind(line) === 'added', 'bg-surface-red-1 text-ink-red-4': getDiffKind(line) === 'removed' }]">{{ line || ' ' }}</code></pre>
    </details>
    <details v-if="tool.output" class="group border-t border-outline-gray-1">
      <summary class="cursor-pointer px-3 py-2 text-ink-gray-6 sm:py-1">Output</summary>
      <pre class="max-h-96 overflow-y-auto whitespace-pre-wrap break-all border-t border-outline-gray-1 p-3 font-mono text-p-sm text-ink-gray-7">{{ tool.output }}</pre>
    </details>
  </div>
</template>
