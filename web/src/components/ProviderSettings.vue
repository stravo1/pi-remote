<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Button, toast } from "frappe-ui";
import type { ProviderLoginEvent, ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";
import AddProviderWizard from "./AddProviderWizard.vue";

const props = defineProps<{ providers: Provider[]; login?: { id?: string; event?: ProviderLoginEvent; notice?: ProviderLoginEvent }; error: string }>();
const emit = defineEmits<{
  back: [];
  saveKey: [provider: string, key: string];
  logout: [provider: string];
  login: [provider: string, type: "api_key" | "oauth"];
  answer: [value: string];
  cancel: [];
}>();
const isAdding = ref(false);
const connected = computed(() => props.providers.filter((provider) => provider.isConfigured));

onBeforeUnmount(() => { if (props.login) emit("cancel"); });
watch(() => props.error, (message) => { if (message) toast.error(message); });
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
          <li v-for="provider in connected" :key="provider.id" class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-base font-medium text-ink-gray-9">{{ provider.name }}</h3>
              <p class="truncate text-p-sm text-ink-gray-5">{{ provider.source ?? provider.id }}</p>
            </div>
            <Button variant="ghost" theme="red" label="Sign out" @click="emit('logout', provider.id)" />
          </li>
        </ul>
      </section>
    </div>
    </main>
    <AddProviderWizard v-model:open="isAdding" :providers="providers" :login="login" :error="error"
      @save-key="(provider, key) => emit('saveKey', provider, key)" @login="(provider, type) => emit('login', provider, type)"
      @answer="emit('answer', $event)" @cancel="emit('cancel')" />
  </div>
</template>
