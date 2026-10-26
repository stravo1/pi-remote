<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button, Dialog, FormControl, Radio, RadioGroup } from "frappe-ui";
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
const providerId = ref<string | null>(null);
const method = ref<AuthType>();
const key = ref("");
const options = computed(() => props.providers.filter((provider) => provider.authTypes.length).map((provider) => ({ label: provider.name, value: provider.id })));
const selected = computed(() => props.providers.find((provider) => provider.id === providerId.value));
const progress = computed(() => ({ provider: 0, method: 1, key: 2, login: 2 })[step.value]);
const titles: Record<Step, string> = { provider: "Add provider", method: "Choose a sign-in method", key: "Enter API key", login: "Sign in" };
const title = computed(() => selected.value && step.value !== "provider" ? `${titles[step.value]}: ${selected.value.name}` : titles[step.value]);
const canContinue = computed(() => step.value === "provider" ? Boolean(selected.value) : Boolean(method.value));

watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  step.value = "provider";
  providerId.value = null;
  key.value = "";
});

watch(() => props.login, (login) => {
  if (login || step.value !== "login") return;
  if (props.error) step.value = selected.value!.authTypes.length > 1 ? "method" : "provider";
  else emit("update:open", false);
});

function next(): void {
  if (step.value === "provider") {
    method.value = selected.value!.authTypes[0];
    if (selected.value!.authTypes.length > 1) return void (step.value = "method");
  }
  if (method.value === "oauth") startLogin("oauth");
  else step.value = "key";
}

function startLogin(type: AuthType): void {
  step.value = "login";
  emit("login", selected.value!.id, type);
}

function saveKey(): void {
  if (!key.value.trim()) return;
  emit("saveKey", selected.value!.id, key.value.trim());
  emit("update:open", false);
}

function goBack(): void {
  if (step.value === "login") emit("cancel");
  step.value = step.value !== "method" && selected.value!.authTypes.length > 1 ? "method" : "provider";
}
</script>

<template>
  <Dialog :open="open" :title="title" size="md" :dismissible="step === 'provider'" :show-close-button="step !== 'login'" @update:open="emit('update:open', $event)">
    <div class="mb-5 flex items-center gap-1.5" aria-hidden="true">
      <span v-for="index in 3" :key="index" class="h-1 flex-1 rounded-full transition-colors" :class="index - 1 <= progress ? 'bg-surface-gray-10' : 'bg-surface-gray-3'" />
    </div>
    <FormControl v-if="step === 'provider'" v-model="providerId" type="combobox" label="Provider" placeholder="Search providers" :options="options" />
    <RadioGroup v-else-if="step === 'method' && selected" v-model="method" label="Sign-in method" padded>
      <Radio v-if="selected.authTypes.includes('oauth')" value="oauth" :label="selected.accountLabel ?? 'Sign in with an account'" />
      <Radio v-if="selected.authTypes.includes('api_key')" value="api_key" label="API key" />
    </RadioGroup>
    <form v-else-if="step === 'key' && selected" @submit.prevent="saveKey">
      <FormControl v-model="key" type="password" autocomplete="off" :label="`${selected.name} API key`" autofocus />
    </form>
    <ProviderLoginPanel v-else-if="step === 'login'" :event="login?.event" :notice="login?.notice" @answer="emit('answer', $event)" />
    <template #actions="{ close }">
      <div class="flex w-full justify-between gap-2">
        <Button v-if="step !== 'provider'" label="Back" @click="goBack" />
        <span v-else />
        <div class="flex gap-2">
          <Button v-if="step === 'key'" label="Guided setup" @click="startLogin('api_key')" />
          <Button v-else-if="step !== 'login'" label="Cancel" @click="close" />
          <Button v-if="step === 'key'" variant="solid" label="Save key" :disabled="!key.trim()" @click="saveKey" />
          <Button v-else-if="step !== 'login'" variant="solid" label="Continue" :disabled="!canContinue" @click="next" />
        </div>
      </div>
    </template>
  </Dialog>
</template>
