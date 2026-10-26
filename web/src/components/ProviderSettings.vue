<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Button, Password, toast } from "frappe-ui";
import type { ProviderLoginEvent, ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";
import AddProviderWizard from "./AddProviderWizard.vue";

const props = defineProps<{
  providers: Provider[]; error: string; providerKey?: { provider: string; apiKey: string };
  login?: { id?: string; event?: ProviderLoginEvent; notice?: ProviderLoginEvent };
}>();
const emit = defineEmits<{
  back: [];
  saveKey: [provider: string, key: string];
  loadKey: [provider: string];
  logout: [provider: string];
  login: [provider: string, type: "api_key" | "oauth"];
  answer: [value: string];
  cancel: [];
}>();
const isAdding = ref(false);
const editingId = ref<string>();
const key = ref("");
const keyInputs = ref<{ focus(): void }[]>([]);
const connected = computed(() => props.providers.filter((provider) => provider.isConfigured));

onBeforeUnmount(() => { if (props.login) emit("cancel"); });
watch(() => props.error, (message) => { if (message) toast.error(message); });
watch(() => props.providerKey, (loaded) => {
  if (loaded && loaded.provider === editingId.value && !key.value) key.value = loaded.apiKey;
});

function editKey(provider: string): void {
  key.value = "";
  editingId.value = provider;
  emit("loadKey", provider);
  void nextTick(() => keyInputs.value[0]?.focus());
}

function saveKey(): void {
  if (!key.value.trim()) return;
  emit("saveKey", editingId.value!, key.value.trim());
  editingId.value = undefined;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="shrink-0 border-b border-outline-gray-1 max-sm:order-2 max-sm:border-b-0 max-sm:border-t">
      <div class="flex h-14 w-full items-center gap-1 px-2 sm:h-11">
        <Button variant="ghost" icon="lucide-arrow-left" aria-label="All sessions" @click="emit('back')" />
        <h1 class="text-base font-medium text-ink-gray-9">Settings</h1>
      </div>
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto max-sm:order-1">
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:py-4">

      <section class="space-y-3" aria-labelledby="providers-heading">
        <div class="flex items-center gap-2">
          <h2 id="providers-heading" class="min-w-0 flex-1 text-base font-medium text-ink-gray-9">Providers</h2>
          <Button variant="subtle" icon="lucide-plus" aria-label="Add provider" @click="isAdding = true" />
        </div>
        <div v-if="!connected.length" class="flex flex-col items-center gap-2 rounded-4 border border-dashed border-outline-gray-2 px-4 py-10 text-center">
          <span class="lucide-key-round size-6 text-ink-gray-4" aria-hidden="true" />
          <p class="text-base font-medium text-ink-gray-9">No providers connected</p>
          <p class="text-p-sm text-ink-gray-5">Add a provider to start sessions with its models.</p>
        </div>
        <ul v-else class="divide-y divide-outline-gray-1 rounded-4 border border-outline-gray-2" aria-label="Connected providers">
          <li v-for="provider in connected" :key="provider.id" class="flex min-h-16 items-center gap-3 px-4 py-3">
            <form v-if="editingId === provider.id" class="flex w-full items-center gap-2" @submit.prevent="saveKey" @keydown.esc="editingId = undefined">
              <Password ref="keyInputs" v-model="key" class="min-w-0 flex-1" autocomplete="off" placeholder="New API key" :aria-label="`${provider.name} API key`" />
              <Button variant="ghost" icon="lucide-x" aria-label="Cancel" @click="editingId = undefined" />
              <Button type="submit" variant="solid" icon="lucide-check" aria-label="Save key" :disabled="!key.trim()" />
            </form>
            <template v-else>
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-base font-medium text-ink-gray-9">{{ provider.name }}</h3>
              <p class="truncate text-p-sm text-ink-gray-5">{{ provider.source ?? provider.id }}</p>
            </div>
            <Button v-if="provider.isUsingApiKey && provider.authTypes.includes('api_key')" variant="ghost" icon="lucide-pencil" aria-label="Edit key" @click="editKey(provider.id)" />
            <Button variant="ghost" theme="red" icon="lucide-trash-2" aria-label="Sign out" @click="emit('logout', provider.id)" />
            </template>
          </li>
        </ul>
      </section>
    </div>
    </main>
    <AddProviderWizard v-model:open="isAdding" :providers="providers" :login="login" :error="error"
      @login="(provider, type) => emit('login', provider, type)"
      @answer="emit('answer', $event)" @cancel="emit('cancel')" />
  </div>
</template>
