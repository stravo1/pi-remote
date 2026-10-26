<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, Combobox, TextInput } from "frappe-ui";
import type { ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ providers: Provider[] }>();
const emit = defineEmits<{
  saveKey: [provider: string, key: string];
  login: [provider: string, type: "api_key" | "oauth"];
}>();
const choice = ref<string>();
const key = ref("");
const options = computed(() => props.providers.flatMap((provider) => provider.authTypes.map((type) => {
  const method = type === "oauth" ? provider.accountLabel ?? "Sign in with an account" : "API key";
  return { label: provider.name, value: `${provider.id}:${type}`, slots: { suffix: () => method } };
})));
const selected = computed(() => {
  const [id, type] = (choice.value ?? "").split(":");
  const provider = props.providers.find((candidate) => candidate.id === id);
  return provider && { provider, type: type as "api_key" | "oauth" };
});

function choose(value: string | number | undefined): void {
  key.value = "";
  if (!value) return;
  const [id, type] = String(value).split(":");
  if (type === "oauth") emit("login", id, "oauth");
}

function saveKey(): void {
  if (selected.value && key.value.trim()) emit("saveKey", selected.value.provider.id, key.value.trim());
}
</script>

<template>
  <div class="space-y-3 rounded-4 border border-outline-gray-2 p-3">
    <Combobox v-model="choice" :options="options" trigger="button" size="md" placeholder="Search providers" aria-label="Provider" @update:model-value="choose" />
    <template v-if="selected?.type === 'api_key'">
      <form class="flex gap-2" @submit.prevent="saveKey">
        <TextInput v-model="key" class="min-w-0 flex-1" type="password" autocomplete="off"
          :placeholder="`${selected.provider.name} API key`" :aria-label="`${selected.provider.name} API key`" autofocus />
        <Button variant="solid" type="submit" label="Save key" :disabled="!key.trim()" />
      </form>
      <Button variant="ghost" label="Guided key setup" @click="emit('login', selected.provider.id, 'api_key')" />
    </template>
  </div>
</template>
