<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button, Dialog, FormControl, Radio, RadioGroup } from "frappe-ui";
import type { ProviderLoginEvent, ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";
import ProviderLoginPanel from "./ProviderLoginPanel.vue";

type AuthType = "api_key" | "oauth";
type Step = "provider" | "method" | "login";

const props = defineProps<{
  open: boolean;
  providers: Provider[];
  error: string;
  login?: { id?: string; event?: ProviderLoginEvent; notice?: ProviderLoginEvent };
}>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  login: [provider: string, type: AuthType];
  answer: [value: string];
  cancel: [];
}>();
const step = ref<Step>("provider");
const providerId = ref<string | null>(null);
const method = ref<AuthType>();
const options = computed(() =>
  props.providers
    .filter((provider) => provider.authTypes.length)
    .map((provider) => ({ label: provider.name, value: provider.id })),
);
const selected = computed(() => props.providers.find((provider) => provider.id === providerId.value));
const hasMethodStep = computed(() => (selected.value?.authTypes.length ?? 2) > 1);
const progress = computed(() =>
  step.value === "provider" ? 0 : step.value === "method" ? 1 : hasMethodStep.value ? 2 : 1,
);
const title = computed(() => {
  if (step.value === "provider" || !selected.value) return "Add provider";
  if (step.value === "method") return `Choose a sign-in method: ${selected.value.name}`;
  return `${method.value === "api_key" ? "Enter API key" : "Sign in"}: ${selected.value.name}`;
});
const canContinue = computed(() => (step.value === "provider" ? Boolean(selected.value) : Boolean(method.value)));

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    step.value = "provider";
    providerId.value = null;
  },
);

watch(
  () => props.login,
  (login) => {
    if (login || step.value !== "login") return;
    if (props.error) step.value = hasMethodStep.value ? "method" : "provider";
    else emit("update:open", false);
  },
);

function next(): void {
  if (step.value === "provider") {
    method.value = selected.value!.authTypes[0];
    if (hasMethodStep.value) return void (step.value = "method");
  }
  step.value = "login";
  emit("login", selected.value!.id, method.value!);
}

function goBack(): void {
  if (step.value === "login") emit("cancel");
  step.value = step.value === "login" && hasMethodStep.value ? "method" : "provider";
}
</script>

<template>
  <Dialog
    :open="open"
    :title="title"
    size="md"
    :dismissible="step === 'provider'"
    :show-close-button="step !== 'login'"
    @update:open="emit('update:open', $event)"
  >
    <div class="mb-5 flex items-center gap-1.5" aria-hidden="true">
      <span
        v-for="index in hasMethodStep ? 3 : 2"
        :key="index"
        class="h-1 flex-1 rounded-full transition-colors"
        :class="index - 1 <= progress ? 'bg-surface-gray-10' : 'bg-surface-gray-3'"
      />
    </div>
    <FormControl
      v-if="step === 'provider'"
      v-model="providerId"
      type="combobox"
      label="Provider"
      placeholder="Search providers"
      :options="options"
    />
    <RadioGroup v-else-if="step === 'method' && selected" v-model="method" label="Sign-in method" padded>
      <Radio
        v-if="selected.authTypes.includes('oauth')"
        value="oauth"
        :label="selected.accountLabel ?? 'Sign in with an account'"
      />
      <Radio v-if="selected.authTypes.includes('api_key')" value="api_key" label="API key" />
    </RadioGroup>
    <ProviderLoginPanel v-else :event="login?.event" :notice="login?.notice" @answer="emit('answer', $event)" />
    <template #actions="{ close }">
      <div class="flex w-full justify-between gap-2">
        <Button v-if="step !== 'provider'" label="Back" @click="goBack" />
        <span v-else />
        <div v-if="step !== 'login'" class="flex gap-2">
          <Button label="Cancel" @click="close" />
          <Button variant="solid" label="Continue" :disabled="!canContinue" @click="next" />
        </div>
      </div>
    </template>
  </Dialog>
</template>
