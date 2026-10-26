<script setup lang="ts">
import { computed } from "vue";
import { Alert, BottomSheet, Button, Combobox, Select } from "frappe-ui";
import type { SessionSettings } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ open: boolean; settings: SessionSettings; disabled: boolean; isRunning: boolean; error: string }>();
const emit = defineEmits<{ "update:open": [value: boolean]; model: [value: string]; thinking: [level: string] }>();
const modelOptions = computed(() => props.settings.models.map((model) => ({
  label: `${model.name} (${model.provider}/${model.id})`, name: model.name, description: `${model.provider}/${model.id}`, value: JSON.stringify([model.provider, model.id]),
})));
const selectedModel = computed(() => props.settings.model
  ? JSON.stringify([props.settings.model.provider, props.settings.model.id]) : undefined);
</script>

<template>
  <BottomSheet :open="open" title="Session settings" @update:open="emit('update:open', $event)">
    <div data-session-settings class="space-y-4 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      <Alert v-if="error" theme="red" :title="error" />
      <p v-if="isRunning" class="text-p-sm text-ink-gray-5">You can change settings after this run.</p>
      <Combobox label="Model" trigger="button" align="start" placeholder="Search models" empty-text="No matching models" size="lg" :model-value="selectedModel" :options="modelOptions" :disabled="disabled || isRunning"
        @update:model-value="(value) => emit('model', String(value))">
        <template #item-label="{ item }">
          <div class="truncate">{{ item.name }}</div>
          <div class="truncate text-p-xs text-ink-gray-5">{{ item.description }}</div>
        </template>
      </Combobox>
      <Select label="Thinking" size="lg" :model-value="settings.thinkingLevel" :options="settings.thinkingLevels"
        :disabled="disabled || isRunning || settings.thinkingLevels.length < 2"
        @update:model-value="(value) => emit('thinking', String(value))" />
      <p class="text-p-sm text-ink-gray-5">Settings apply to this session on every device.</p>
      <div class="flex justify-end">
        <Button label="Close" @click="emit('update:open', false)" />
      </div>
    </div>
  </BottomSheet>
</template>

<style>
.bottom-sheet-content:has([data-session-settings]) {
  @apply max-w-sm;
}
[data-selection]:has(input[placeholder="Search models"]) {
  width: var(--reka-combobox-trigger-width);
  max-width: calc(100vw - 2rem);
  max-height: var(--reka-combobox-content-available-height);
}
[data-selection]:has(input[placeholder="Search models"]) [data-reka-combobox-viewport] {
  max-height: min(15rem, calc(var(--reka-combobox-content-available-height) - 3rem));
}
</style>
