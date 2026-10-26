<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Alert, Button, Textarea, Select } from "frappe-ui";

import type { SessionSettings, Snapshot } from "../../../server/src/pi-adapter.ts";

import SessionSettingsDrawer from "./SessionSettingsDrawer.vue";

const props = defineProps<{ disabled: boolean; isSending: boolean; isRunning: boolean; error: string; settings?: SessionSettings; queue: Snapshot["queue"]; isUpdatingSettings: boolean }>();
const emit = defineEmits<{ send: [text: string, mode: "follow_up" | "steer"]; abort: []; model: [value: string]; thinking: [level: string] }>();
const mode = ref<"follow_up" | "steer">("follow_up");
const isSettingsOpen = ref(false);
const text = ref("");
const root = ref<HTMLElement>();
const canSend = computed(() => !props.disabled && text.value.trim() !== "");
const hasKeyboard = window.matchMedia("(pointer: fine)").matches;
const maxHeight = 160;

watch(text, async () => {
  await nextTick();
  const element = root.value?.querySelector("textarea");
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
});

function submit(): void {
  if (!canSend.value) return;
  emit("send", text.value, mode.value);
  text.value = "";
}

function onEnter(event: KeyboardEvent): void {
  if (!hasKeyboard || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}
</script>

<template>
  <form ref="root" class="mx-auto w-full max-w-2xl space-y-2 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4" @submit.prevent="submit">
    <Alert v-if="error" role="alert" theme="red" :title="error" />
    <SessionSettingsDrawer v-if="settings" v-model:open="isSettingsOpen" :settings="settings" :is-running="isRunning"
      :disabled="disabled || isUpdatingSettings" :error="error" @model="(value) => emit('model', value)" @thinking="(level) => emit('thinking', level)" />
    <Button v-if="settings" type="button" variant="ghost" icon-left="lucide-sliders-horizontal"
      label="Session settings" class="max-w-full" @click="isSettingsOpen = true" />
    <div v-if="queue.steering.length || queue.followUp.length" class="max-h-28 space-y-1 overflow-y-auto rounded-4 bg-surface-gray-1 px-3 py-2 text-p-sm" aria-label="Queued messages">
      <p v-for="(message, index) in queue.steering" :key="`steer-${index}`" class="whitespace-pre-wrap break-words"><span class="font-medium">Steer:</span> {{ message }}</p>
      <p v-for="(message, index) in queue.followUp" :key="`follow-${index}`" class="whitespace-pre-wrap break-words"><span class="font-medium">Follow-up:</span> {{ message }}</p>
    </div>
    <div v-if="isRunning" class="flex items-center gap-2">
      <Select v-model="mode" aria-label="Message mode" :options="[{ label: 'Follow-up', value: 'follow_up' }, { label: 'Steer', value: 'steer' }]" />
      <span class="text-p-xs text-ink-gray-5">{{ mode === 'steer' ? 'After the current turn' : 'After this run' }}</span>
    </div>
    <div class="flex items-end gap-2 rounded-6 border border-outline-gray-2 bg-surface-base p-1.5 pl-4 shadow-sm transition-colors focus-within:border-outline-gray-4">
      <Textarea v-model="text" class="min-w-0 flex-1 resize-none !bg-transparent !px-0 !py-2 !text-lg sm:!text-p-base" variant="ghost" :rows="1"
        :disabled="disabled" aria-label="Message" :placeholder="isRunning ? 'Add a message while pi works' : 'Message pi'"
        @keydown.enter="onEnter" />
      <Button v-if="isRunning" type="button" variant="solid" size="lg" class="shrink-0 !rounded-full" icon="lucide-square" aria-label="Stop run" @click="emit('abort')" />
      <Button type="submit" variant="solid" size="lg" class="shrink-0 !rounded-full" icon="lucide-arrow-up" :aria-label="isRunning ? (mode === 'steer' ? 'Send steer' : 'Send follow-up') : 'Send prompt'" :disabled="!canSend" :loading="isSending" />
    </div>
  </form>
</template>
