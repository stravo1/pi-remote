<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BottomSheet, Button, TextInput } from "frappe-ui";
import type { ModelChoice, SessionSettings } from "../../../server/src/pi-adapter.ts";
import { getModelKey, loadRecentKeys, rememberModel } from "../recent-models.ts";

type View = "main" | "models" | "effort";

const props = defineProps<{ settings: SessionSettings; disabled: boolean; isRunning: boolean }>();
const emit = defineEmits<{ model: [value: string]; thinking: [level: string] }>();
const isOpen = ref(false);
const view = ref<View>("main");
const query = ref("");
const recentKeys = ref(loadRecentKeys());
const titles: Record<View, string> = { main: "Select model", models: "More models", effort: "Effort" };
const isLocked = computed(() => props.disabled || props.isRunning);
const recentModels = computed(() => {
  const keys = props.settings.model ? [getModelKey(props.settings.model), ...recentKeys.value] : recentKeys.value;
  const models = [...new Set(keys)].map((key) => props.settings.models.find((model) => getModelKey(model) === key));
  return models.filter((model): model is ModelChoice => !!model).slice(0, 4);
});
const filteredModels = computed(() => {
  const text = query.value.trim().toLowerCase();
  return props.settings.models.filter((model) => `${model.name} ${model.provider}/${model.id}`.toLowerCase().includes(text));
});

watch(isOpen, (value) => { if (!value) { view.value = "main"; query.value = ""; } });

function isSelected(model: ModelChoice): boolean {
  return !!props.settings.model && getModelKey(model) === getModelKey(props.settings.model);
}

function chooseModel(model: ModelChoice): void {
  recentKeys.value = rememberModel(recentKeys.value, model);
  emit("model", JSON.stringify([model.provider, model.id]));
  view.value = "main";
}

function chooseEffort(level: string): void {
  emit("thinking", level);
  view.value = "main";
}
</script>

<template>
  <Button variant="ghost" size="lg" icon="lucide-sliders-horizontal" aria-label="Session settings" @click="isOpen = true" />
  <BottomSheet v-model:open="isOpen" :title="titles[view]">
    <div data-session-settings :class="['flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]', view === 'models' ? 'h-[60dvh]' : '']">
      <Button v-if="view !== 'main'" class="shrink-0 self-start" variant="ghost" icon-left="lucide-chevron-left" label="Back" @click="view = 'main'" />
      <p v-if="isRunning" class="px-1 text-p-sm text-ink-gray-5">You can change settings after this run.</p>
      <template v-if="view === 'main'">
        <div class="divide-y divide-outline-gray-1 rounded-4 bg-surface-gray-1" role="listbox" aria-label="Recent models">
          <button v-for="model in recentModels" :key="getModelKey(model)" type="button" role="option" :disabled="isLocked"
            :aria-selected="isSelected(model)" class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-60" @click="chooseModel(model)">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-lg text-ink-gray-9">{{ model.name }}</span>
              <span class="block truncate text-p-sm text-ink-gray-5">{{ getModelKey(model) }}</span>
            </span>
            <span v-if="isSelected(model)" class="lucide-check size-5 shrink-0 text-ink-blue-3" aria-hidden="true" />
          </button>
        </div>
        <div class="divide-y divide-outline-gray-1 rounded-4 bg-surface-gray-1">
          <button type="button" class="flex min-h-14 w-full items-center gap-3 px-4 text-left disabled:opacity-50" :disabled="isLocked || settings.thinkingLevels.length < 2" @click="view = 'effort'">
            <span class="flex-1 text-lg text-ink-gray-9">Effort</span>
            <span class="text-lg capitalize text-ink-gray-5">{{ settings.thinkingLevel }}</span>
            <span class="lucide-chevron-right size-5 text-ink-gray-4" aria-hidden="true" />
          </button>
          <button type="button" class="flex min-h-14 w-full items-center gap-3 px-4 text-left disabled:opacity-50" :disabled="isLocked" @click="view = 'models'">
            <span class="flex-1 text-lg text-ink-gray-9">More models</span>
            <span class="lucide-chevron-right size-5 text-ink-gray-4" aria-hidden="true" />
          </button>
        </div>
        <p class="px-1 text-p-sm text-ink-gray-5">Settings apply to this session on every device.</p>
      </template>
      <template v-else-if="view === 'models'">
        <TextInput v-model="query" class="shrink-0" size="lg" type="search" placeholder="Search models" aria-label="Search models" />
        <p v-if="!filteredModels.length" class="px-1 text-p-base text-ink-gray-5">No matching models</p>
        <div v-else class="min-h-0 flex-1 divide-y divide-outline-gray-1 overflow-y-auto rounded-4 bg-surface-gray-1" role="listbox" aria-label="Models">
          <button v-for="model in filteredModels" :key="getModelKey(model)" type="button" role="option"
            :aria-selected="isSelected(model)" class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left" @click="chooseModel(model)">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-lg text-ink-gray-9">{{ model.name }}</span>
              <span class="block truncate text-p-sm text-ink-gray-5">{{ getModelKey(model) }}</span>
            </span>
            <span v-if="isSelected(model)" class="lucide-check size-5 shrink-0 text-ink-blue-3" aria-hidden="true" />
          </button>
        </div>
      </template>
      <div v-else class="divide-y divide-outline-gray-1 rounded-4 bg-surface-gray-1" role="listbox" aria-label="Effort">
        <button v-for="level in settings.thinkingLevels" :key="level" type="button" role="option"
          :aria-selected="level === settings.thinkingLevel" class="flex min-h-14 w-full items-center gap-3 px-4 text-left" @click="chooseEffort(level)">
          <span class="flex-1 text-lg capitalize text-ink-gray-9">{{ level }}</span>
          <span v-if="level === settings.thinkingLevel" class="lucide-check size-5 shrink-0 text-ink-blue-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  </BottomSheet>
</template>
