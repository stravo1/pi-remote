<script setup lang="ts">
import { computed, ref } from "vue";
import { Alert, Button, Textarea } from "frappe-ui";

const props = defineProps<{ disabled: boolean; isSending: boolean; isRunning: boolean; error: string }>();
const emit = defineEmits<{ send: [text: string]; abort: [] }>();
const text = ref("");
const canSend = computed(() => !props.disabled && text.value.trim() !== "");

function submit(): void {
  if (!canSend.value) return;
  emit("send", text.value);
  text.value = "";
}
</script>

<template>
  <form class="mx-auto w-full max-w-2xl space-y-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]" @submit.prevent="submit">
    <Alert v-if="error" role="alert" theme="red" :title="error" />
    <div class="flex items-end gap-2 rounded-6 border border-outline-gray-2 bg-surface-base py-2 pr-2 pl-4 shadow-sm focus-within:border-outline-gray-4">
      <Textarea v-model="text" class="flex-1 resize-none !bg-transparent" variant="ghost" :rows="2" :disabled="disabled" aria-label="Message"
        :placeholder="isRunning ? 'pi is working…' : 'Message pi'"
        @keydown.enter.exact.prevent="submit" />
      <Button v-if="isRunning" type="button" variant="solid" icon="lucide-square" aria-label="Stop run" @click="emit('abort')" />
      <Button v-else type="submit" variant="solid" icon="lucide-arrow-up" aria-label="Send prompt" :disabled="!canSend" :loading="isSending" />
    </div>
  </form>
</template>
