<script setup lang="ts">
import { computed, ref } from "vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import ToolCard from "./ToolCard.vue";
import type { ToolCall } from "../tools.ts";
import type { TranscriptMessage } from "../transcript.ts";

const props = defineProps<{
  steps: TranscriptMessage[];
  tools: Record<string, ToolCall>;
  isGroupStart: boolean;
}>();
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
type Status = keyof typeof statusIcons;
type RunEntity = { type: "thinking"; text: string } | { type: "tool"; tool: ToolCall };

const entities = computed<RunEntity[]>(() =>
  props.steps.flatMap((step): RunEntity[] =>
    step.content.flatMap((block): RunEntity[] => {
      if (block.type === "thinking") return [{ type: "thinking", text: block.text }];
      const tool = block.toolCall && props.tools[block.toolCall.id];
      return tool ? [{ type: "tool", tool }] : [];
    }),
  ),
);
const calls = computed(() => entities.value.flatMap((entity) => (entity.type === "tool" ? [entity.tool] : [])));
// One state for the whole run: anything running keeps it live, then any failure wins.
const status = computed<Status>(() => {
  const statuses = calls.value.map((tool) => tool.status);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("running") || statuses.includes("pending")) return "running";
  if (statuses.includes("interrupted")) return "interrupted";
  return "success";
});
</script>

<template>
  <div
    :class="[
      isGroupStart ? 'mt-8 first:mt-0 sm:mt-5' : 'mt-3 sm:mt-1.5',
      // `clip` keeps the rounded corners without creating a scroll container, so the header can stick
      // to the transcript while its expanded list scrolls past.
      'min-w-0 overflow-clip rounded-4 border border-outline-gray-2 text-p-sm',
    ]"
  >
    <button
      type="button"
      :aria-expanded="isOutputOpen"
      class="sticky top-0 z-10 flex w-full items-center gap-2 bg-surface-gray-1 px-3 py-2 text-left hover:bg-surface-gray-2 sm:py-1.5"
      @click="isOutputOpen = !isOutputOpen"
    >
      <span class="lucide-terminal size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-ink-gray-9">Ran {{ calls.length }} commands</span>
      <span
        :class="['size-4 shrink-0', statusIcons[status]]"
        role="img"
        :aria-label="statusLabels[status]"
        :title="statusLabels[status]"
      />
      <span
        :class="[
          isOutputOpen ? 'lucide-chevrons-down-up' : 'lucide-chevrons-up-down',
          'size-4 shrink-0 text-ink-gray-5',
        ]"
        aria-hidden="true"
      />
    </button>
    <div v-if="isOutputOpen" class="divide-y divide-outline-gray-1">
      <template v-for="(entity, index) in entities" :key="index">
        <div v-if="entity.type === 'thinking'" class="px-3 py-2">
          <ThinkingBlock :text="entity.text" />
        </div>
        <ToolCard v-else :tool="entity.tool" is-flat />
      </template>
    </div>
  </div>
</template>
