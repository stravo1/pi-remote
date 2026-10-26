<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button, Dialog, TextInput } from "frappe-ui";
import type { ProviderLoginEvent, ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";
import ProviderLoginPanel from "./ProviderLoginPanel.vue";

type AuthType = "api_key" | "oauth";
type Step = "provider" | "method" | "key" | "login";

const props = defineProps<{
  open: boolean; providers: Provider[]; error: string;
  login?: { id?: string; event?: ProviderLoginEvent; notice?: ProviderLoginEvent };
}>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  saveKey: [provider: string, key: string];
  login: [provider: string, type: AuthType];
  answer: [value: string];
  cancel: [];
}>();
const step = ref<Step>("provider");
const query = ref("");
const key = ref("");
const selected = ref<Provider>();
const matches = computed(() => {
  const text = query.value.trim().toLowerCase();
  return props.providers.filter((provider) => provider.authTypes.length && `${provider.name} ${provider.id}`.toLowerCase().includes(text));
});
const titles: Record<Step, string> = { provider: "Add provider", method: "Choose a sign-in method", key: "Enter API key", login: "Sign in" };
const title = computed(() => selected.value && step.value !== "provider" ? `${titles[step.value]}: ${selected.value.name}` : titles[step.value]);

watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  step.value = "provider";
  query.value = "";
  key.value = "";
  selected.value = undefined;
});

watch(() => props.login, (login) => {
  if (login || step.value !== "login") return;
  if (props.error) step.value = "method";
  else emit("update:open", false);
});

function choose(provider: Provider): void {
  selected.value = provider;
  key.value = "";
  if (provider.authTypes.length > 1) step.value = "method";
  else start(provider.authTypes[0]);
}

function start(type: AuthType): void {
  if (!selected.value) return;
  if (type === "oauth") startLogin("oauth");
  else step.value = "key";
}

function startLogin(type: AuthType): void {
  step.value = "login";
  emit("login", selected.value!.id, type);
}

function cancelLogin(): void {
  step.value = "method";
  emit("cancel");
}

function saveKey(): void {
  if (!selected.value || !key.value.trim()) return;
  emit("saveKey", selected.value.id, key.value.trim());
  emit("update:open", false);
}

function goBack(): void {
  step.value = step.value === "key" && selected.value!.authTypes.length > 1 ? "method" : "provider";
}
</script>

<template>
  <Dialog :open="open" :title="title" size="md" :dismissible="step !== 'login'" :show-close="step !== 'login'" @update:open="emit('update:open', $event)">
    <div v-if="step === 'provider'" class="space-y-3">
      <TextInput v-model="query" size="lg" placeholder="Search providers" aria-label="Search providers" autofocus />
      <ul class="max-h-72 overflow-y-auto" aria-label="Providers">
        <li v-for="provider in matches" :key="provider.id">
          <button type="button" class="flex w-full items-center gap-3 rounded-3 px-2 py-2 text-left hover:bg-surface-gray-2" @click="choose(provider)">
            <span class="min-w-0 flex-1 truncate text-base text-ink-gray-9">{{ provider.name }}</span>
            <span class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <p v-if="!matches.length" class="py-4 text-center text-p-sm text-ink-gray-5">No provider matches "{{ query }}".</p>
    </div>
    <div v-else-if="step === 'method' && selected" class="space-y-2">
      <button v-if="selected.authTypes.includes('oauth')" type="button" class="flex w-full items-center gap-3 rounded-3 border border-outline-gray-2 px-3 py-3 text-left hover:bg-surface-gray-2" @click="start('oauth')">
        <span class="min-w-0 flex-1 text-base text-ink-gray-9">{{ selected.accountLabel ?? "Sign in with an account" }}</span>
        <span class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
      </button>
      <button v-if="selected.authTypes.includes('api_key')" type="button" class="flex w-full items-center gap-3 rounded-3 border border-outline-gray-2 px-3 py-3 text-left hover:bg-surface-gray-2" @click="start('api_key')">
        <span class="min-w-0 flex-1 text-base text-ink-gray-9">API key</span>
        <span class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
      </button>
    </div>
    <form v-else-if="step === 'key' && selected" @submit.prevent="saveKey">
      <TextInput v-model="key" size="lg" type="password" autocomplete="off" :placeholder="`${selected.name} API key`" :aria-label="`${selected.name} API key`" autofocus />
    </form>
    <ProviderLoginPanel v-else-if="step === 'login'" :event="login?.event" :notice="login?.notice" @answer="emit('answer', $event)" @cancel="cancelLogin" />
    <template #actions>
      <div v-if="step !== 'provider' && step !== 'login'" class="flex w-full gap-2">
        <Button variant="ghost" icon-left="lucide-arrow-left" label="Back" @click="goBack" />
        <div class="flex-1" />
        <Button v-if="step === 'key'" variant="subtle" label="Guided setup" @click="startLogin('api_key')" />
        <Button v-if="step === 'key'" variant="solid" label="Save key" :disabled="!key.trim()" @click="saveKey" />
      </div>
    </template>
  </Dialog>
</template>
