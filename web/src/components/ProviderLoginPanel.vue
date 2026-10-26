<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, TextInput } from "frappe-ui";
import type { ProviderLoginEvent } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ event?: ProviderLoginEvent }>();
const emit = defineEmits<{ answer: [value: string]; cancel: [] }>();
const answer = ref("");
const prompt = computed(() => props.event?.type === "prompt" ? props.event.prompt : undefined);
const placeholder = computed(() => prompt.value && "placeholder" in prompt.value ? prompt.value.placeholder : undefined);

function submit(): void {
  if (!answer.value.trim()) return;
  emit("answer", answer.value);
  answer.value = "";
}
</script>

<template>
  <section class="space-y-3 rounded-4 border border-outline-gray-2 bg-surface-gray-1 p-4" aria-label="Provider login">
    <p v-if="event?.type === 'auth_url'" class="text-p-sm text-ink-gray-7">{{ event.instructions ?? 'Open this link to continue.' }}</p>
    <a v-if="event?.type === 'auth_url'" class="break-all text-p-sm text-ink-gray-9 underline" :href="event.url" target="_blank" rel="noopener noreferrer">{{ event.url }}</a>
    <template v-if="event?.type === 'device_code'">
      <p class="text-p-sm text-ink-gray-7">Open <a class="text-ink-gray-9 underline" :href="event.verificationUri" target="_blank" rel="noopener noreferrer">{{ event.verificationUri }}</a> and enter this code.</p>
      <p class="font-mono text-lg font-semibold tracking-wider text-ink-gray-9">{{ event.userCode }}</p>
    </template>
    <p v-if="event?.type === 'info' || event?.type === 'progress'" class="text-p-sm text-ink-gray-7">{{ event.message }}</p>
    <p v-if="event?.type === 'failed'" role="alert" class="text-p-sm text-ink-red-4">{{ event.message }}</p>
    <p v-if="!event" class="text-p-sm text-ink-gray-5">Starting sign-in...</p>
    <div v-if="prompt?.type === 'select'" class="flex flex-wrap gap-2" role="listbox" :aria-label="prompt.message">
      <Button v-for="option in prompt.options" :key="option.id" variant="subtle" :label="option.label" @click="emit('answer', option.id)" />
    </div>
    <form v-else-if="prompt" class="flex gap-2" @submit.prevent="submit">
      <TextInput v-model="answer" class="min-w-0 flex-1" :type="prompt.type === 'secret' ? 'password' : 'text'"
        :placeholder="placeholder" :aria-label="prompt.message" autofocus />
      <Button type="submit" label="Continue" :disabled="!answer.trim()" />
    </form>
    <div class="flex justify-end"><Button variant="subtle" label="Cancel" @click="emit('cancel')" /></div>
  </section>
</template>
