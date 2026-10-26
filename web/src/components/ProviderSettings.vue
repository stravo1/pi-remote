<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, TextInput } from "frappe-ui";
import type { ProviderLoginEvent, ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ providers: Provider[]; login?: { id?: string; event?: ProviderLoginEvent }; error: string }>();
const emit = defineEmits<{
  back: [];
  saveKey: [provider: string, key: string];
  logout: [provider: string];
  login: [provider: string, type: "api_key" | "oauth"];
  answer: [value: string];
  cancel: [];
}>();
const keys = ref<Record<string, string>>({});
const answer = ref("");
const activeEvent = computed(() => props.login?.event);
const activePrompt = computed(() => activeEvent.value?.type === "prompt" ? activeEvent.value.prompt : undefined);
const promptPlaceholder = computed(() => activePrompt.value && "placeholder" in activePrompt.value ? activePrompt.value.placeholder : undefined);
const isSecretPrompt = computed(() => activePrompt.value?.type === "secret");

function saveKey(provider: string): void {
  const key = keys.value[provider]?.trim();
  if (!key) return;
  emit("saveKey", provider, key);
  keys.value[provider] = "";
}

function submitAnswer(): void {
  if (!answer.value.trim()) return;
  emit("answer", answer.value);
  answer.value = "";
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:py-4">
      <header class="flex items-center gap-2">
        <Button variant="ghost" icon="lucide-arrow-left" aria-label="All sessions" @click="emit('back')" />
        <div class="min-w-0 flex-1">
          <h1 class="text-lg font-semibold text-ink-gray-9">Provider settings</h1>
          <p class="text-p-sm text-ink-gray-5">Credentials stay on this host and are never shown again.</p>
        </div>
      </header>

      <section v-if="login" class="space-y-3 rounded-4 border border-outline-gray-2 bg-surface-gray-1 p-4" aria-label="Provider login">
        <p v-if="activeEvent?.type === 'auth_url'" class="text-p-sm text-ink-gray-7">{{ activeEvent.instructions ?? 'Open this link to continue.' }}</p>
        <a v-if="activeEvent?.type === 'auth_url'" class="break-all text-p-sm text-ink-blue-3 underline" :href="activeEvent.url" target="_blank" rel="noopener noreferrer">{{ activeEvent.url }}</a>
        <template v-if="activeEvent?.type === 'device_code'">
          <p class="text-p-sm text-ink-gray-7">Open <a class="text-ink-blue-3 underline" :href="activeEvent.verificationUri" target="_blank" rel="noopener noreferrer">{{ activeEvent.verificationUri }}</a> and enter this code.</p>
          <p class="font-mono text-lg font-semibold tracking-wider text-ink-gray-9">{{ activeEvent.userCode }}</p>
        </template>
        <p v-if="activeEvent?.type === 'info' || activeEvent?.type === 'progress'" class="text-p-sm text-ink-gray-7">{{ activeEvent.message }}</p>
        <p v-if="activeEvent?.type === 'failed'" role="alert" class="text-p-sm text-ink-red-4">{{ activeEvent.message }}</p>
        <div v-if="activePrompt?.type === 'select'" class="flex flex-wrap gap-2" role="listbox" :aria-label="activePrompt.message">
          <Button v-for="option in activePrompt.options" :key="option.id" variant="subtle" :label="option.label" @click="emit('answer', option.id)" />
        </div>
        <form v-else-if="activePrompt" class="flex gap-2" @submit.prevent="submitAnswer">
          <TextInput v-model="answer" class="min-w-0 flex-1" :type="isSecretPrompt ? 'password' : 'text'"
            :placeholder="promptPlaceholder" :aria-label="activePrompt.message" autofocus />
          <Button type="submit" label="Continue" :disabled="!answer.trim()" />
        </form>
        <div class="flex justify-end"><Button variant="subtle" label="Cancel" @click="emit('cancel')" /></div>
      </section>

      <p v-if="error" role="alert" class="text-p-sm text-ink-red-4">{{ error }}</p>

      <p v-if="!providers.length" class="text-p-base text-ink-gray-5">No AI providers are available.</p>
      <section v-for="provider in providers" :key="provider.id" class="rounded-4 border border-outline-gray-2 bg-surface-base p-4">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-medium text-ink-gray-9">{{ provider.name }}</h2>
            <p class="text-p-sm text-ink-gray-5">{{ provider.id }}</p>
          </div>
          <span :class="['rounded-full px-2 py-1 text-p-xs', provider.isConfigured ? 'bg-surface-gray-2 text-ink-gray-7' : 'bg-surface-red-1 text-ink-red-4']">{{ provider.isConfigured ? 'Connected' : 'Not connected' }}</span>
        </div>
        <p v-if="provider.source" class="mt-2 text-p-sm text-ink-gray-5">{{ provider.source }}</p>
        <form v-if="provider.authTypes.includes('api_key')" class="mt-3 flex gap-2" @submit.prevent="saveKey(provider.id)">
          <TextInput v-model="keys[provider.id]" class="min-w-0 flex-1" type="password" autocomplete="off" :placeholder="`${provider.name} API key`" :aria-label="`${provider.name} API key`" />
          <Button type="button" label="Save key" :disabled="!keys[provider.id]?.trim()" @click="saveKey(provider.id)" />
        </form>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button v-if="provider.authTypes.includes('oauth')" variant="subtle" label="Sign in" @click="emit('login', provider.id, 'oauth')" />
          <Button v-if="provider.authTypes.includes('api_key')" variant="subtle" label="Set up key" @click="emit('login', provider.id, 'api_key')" />
          <Button v-if="provider.isConfigured" variant="subtle" theme="red" label="Sign out" @click="emit('logout', provider.id)" />
        </div>
      </section>
    </div>
  </div>
</template>
