<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, Password, TextInput } from "frappe-ui";
import type { ProviderLoginEvent } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ event?: ProviderLoginEvent; notice?: ProviderLoginEvent }>();
const emit = defineEmits<{ answer: [value: string] }>();
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
  <section class="w-full space-y-3" aria-label="Provider login">
    <template v-if="notice?.type === 'auth_url'">
      <p class="text-p-sm text-ink-gray-7">{{ notice.instructions ?? 'Open the sign-in page to continue.' }}</p>
      <Button variant="solid" icon-left="lucide-external-link" label="Open sign-in page" :href="notice.url" target="_blank" rel="noopener noreferrer" />
    </template>
    <template v-if="notice?.type === 'device_code'">
      <p class="text-p-sm text-ink-gray-7">Open <a class="text-ink-gray-9 underline" :href="notice.verificationUri" target="_blank" rel="noopener noreferrer">{{ notice.verificationUri }}</a> and enter this code.</p>
      <p class="font-mono text-lg font-semibold tracking-wider text-ink-gray-9">{{ notice.userCode }}</p>
    </template>
    <p v-if="event?.type === 'info' || event?.type === 'progress'" class="text-p-sm text-ink-gray-7">{{ event.message }}</p>
    <p v-if="!event" class="text-p-sm text-ink-gray-5">Starting sign-in...</p>
    <div v-if="prompt?.type === 'select'" class="flex flex-wrap gap-2" role="listbox" :aria-label="prompt.message">
      <Button v-for="option in prompt.options" :key="option.id" variant="subtle" :label="option.label" @click="emit('answer', option.id)" />
    </div>
    <form v-else-if="prompt" class="space-y-2" @submit.prevent="submit">
      <p class="text-p-sm text-ink-gray-7">{{ prompt.message }}</p>
      <div class="flex gap-2">
      <component :is="prompt.type === 'secret' ? Password : TextInput" v-model="answer" class="min-w-0 flex-1" autocomplete="off"
        :placeholder="placeholder" :aria-label="prompt.message" autofocus />
      <Button type="submit" label="Continue" :disabled="!answer.trim()" />
      </div>
    </form>
  </section>
</template>
