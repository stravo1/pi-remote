<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Alert, Button, Textarea } from "frappe-ui";

import { buttonSize } from "../button-size.ts";
import type { Snapshot } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ disabled: boolean; isSending: boolean; isRunning: boolean; error: string; queue: Snapshot["queue"] }>();
const emit = defineEmits<{ send: [text: string]; steer: [text: string]; abort: [] }>();
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
  emit("send", text.value);
  text.value = "";
}

function onEnter(event: KeyboardEvent): void {
  if (!hasKeyboard || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}
</script>

<template>
  <form ref="root" class="mx-auto w-full max-w-2xl shrink-0 space-y-2 px-3 pt-2 sm:space-y-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4" @submit.prevent="submit">
    <Alert v-if="error" role="alert" theme="red" :title="error" />
    <ul v-if="queue.steering.length || queue.followUp.length" class="max-h-36 divide-y divide-outline-gray-1 overflow-y-auto rounded-4 bg-surface-gray-1 text-p-sm" aria-label="Queued messages">
      <li v-for="(message, index) in queue.steering" :key="`steer-${index}`" class="flex items-start gap-2 px-3 py-2">
        <span class="lucide-corner-down-right mt-0.5 size-4 shrink-0 text-ink-gray-5" role="img" aria-label="After the current turn" />
        <p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink-gray-8">{{ message }}</p>
      </li>
      <li v-for="(message, index) in queue.followUp" :key="`follow-${index}`" class="flex items-start gap-2 px-3 py-1.5">
        <span class="lucide-clock mt-1 size-4 shrink-0 text-ink-gray-5" role="img" aria-label="After this run" />
        <p class="min-w-0 flex-1 self-center whitespace-pre-wrap break-words text-ink-gray-8">{{ message }}</p>
        <Button variant="ghost" size="sm" icon="lucide-arrow-up" aria-label="Send now" @click="emit('steer', message)" />
      </li>
    </ul>
    <div class="flex items-end gap-2 rounded-7 border border-outline-gray-2 bg-surface-base p-1.5 transition-colors hover:border-outline-gray-3 hover:shadow-sm focus-within:border-outline-gray-4 focus-within:shadow-sm">
      <Textarea v-model="text" class="min-w-0 flex-1 resize-none !py-2.5 sm:!min-h-8 sm:!py-1.5 !text-lg sm:!text-p-base" variant="ghost" size="md" :rows="1"
        :disabled="disabled" aria-label="Message" placeholder="Message pi"
        @keydown.enter="onEnter" />
      <Button v-if="isRunning" type="button" variant="solid" :size="buttonSize" class="shrink-0" icon="lucide-square" aria-label="Stop run" @click="emit('abort')" />
      <Button type="submit" variant="solid" :size="buttonSize" class="shrink-0" icon="lucide-arrow-up" :aria-label="isRunning ? 'Send follow-up' : 'Send prompt'" :disabled="!canSend" :loading="isSending" />
    </div>
  </form>
</template>
