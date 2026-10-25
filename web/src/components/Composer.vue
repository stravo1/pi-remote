<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Alert, Button, Textarea } from "frappe-ui";

const props = defineProps<{ disabled: boolean; isSending: boolean; isRunning: boolean; error: string }>();
const emit = defineEmits<{ send: [text: string]; abort: [] }>();
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
  <form ref="root" class="mx-auto w-full max-w-2xl space-y-2 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4" @submit.prevent="submit">
    <Alert v-if="error" role="alert" theme="red" :title="error" />
    <div class="flex items-end gap-2 rounded-6 border border-outline-gray-2 bg-surface-base p-1.5 pl-4 shadow-sm transition-colors focus-within:border-outline-gray-4">
      <Textarea v-model="text" class="min-w-0 flex-1 resize-none !bg-transparent !px-0 !py-2 !text-lg sm:!text-p-base" variant="ghost" :rows="1"
        :disabled="disabled" aria-label="Message" :placeholder="isRunning ? 'pi is working…' : 'Message pi'"
        @keydown.enter="onEnter" />
      <Button v-if="isRunning" type="button" variant="solid" size="lg" class="shrink-0 !rounded-full" icon="lucide-square" aria-label="Stop run" @click="emit('abort')" />
      <Button v-else type="submit" variant="solid" size="lg" class="shrink-0 !rounded-full" icon="lucide-arrow-up" aria-label="Send prompt" :disabled="!canSend" :loading="isSending" />
    </div>
  </form>
</template>
