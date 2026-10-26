<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, Combobox } from "frappe-ui";
import type { ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";

const props = defineProps<{ providers: Provider[] }>();
const emit = defineEmits<{ select: [provider: Provider, type: "api_key" | "oauth"] }>();
const choice = ref<string>();
const options = computed(() => props.providers.flatMap((provider) => provider.authTypes.map((type) => {
  const method = type === "oauth" ? provider.accountLabel ?? "Sign in with an account" : "API key";
  return { label: provider.name, value: `${provider.id}:${type}`, slots: { suffix: () => method } };
})));

function choose(value: string | number | null | undefined): void {
  const [id, type] = String(value ?? "").split(":");
  const provider = props.providers.find((candidate) => candidate.id === id);
  if (provider) emit("select", provider, type as "api_key" | "oauth");
  choice.value = undefined;
}
</script>

<template>
  <Combobox v-model="choice" :options="options" trigger="button" placeholder="Search providers" aria-label="Add provider" align="end" @update:model-value="choose">
    <template #trigger="{ open, setOpen }">
      <Button variant="subtle" icon="lucide-plus" aria-label="Add provider" @click="setOpen(!open)" />
    </template>
  </Combobox>
</template>
