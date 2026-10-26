<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button, toast } from "frappe-ui";
import type { ProviderLoginEvent, ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";
import AddProviderMenu from "./AddProviderMenu.vue";
import ApiKeyForm from "./ApiKeyForm.vue";
import ProviderLoginPanel from "./ProviderLoginPanel.vue";

const props = defineProps<{ providers: Provider[]; login?: { id?: string; event?: ProviderLoginEvent; notice?: ProviderLoginEvent }; error: string }>();
const emit = defineEmits<{
  back: [];
  saveKey: [provider: string, key: string];
  logout: [provider: string];
  login: [provider: string, type: "api_key" | "oauth"];
  answer: [value: string];
  cancel: [];
}>();
const keyProvider = ref<Provider>();
const connected = computed(() => props.providers.filter((provider) => provider.isConfigured));

watch(connected, (current, previous) => { if (current.length > previous.length) keyProvider.value = undefined; });
watch(() => props.error, (message) => { if (message) toast.error(message); });

function addProvider(provider: Provider, type: "api_key" | "oauth"): void {
  if (type === "api_key") keyProvider.value = provider;
  else emit("login", provider.id, type);
}

function startGuidedSetup(provider: string): void {
  keyProvider.value = undefined;
  emit("login", provider, "api_key");
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="shrink-0 border-b border-outline-gray-1">
      <div class="flex h-14 w-full items-center gap-1 px-2 sm:h-11">
        <Button variant="ghost" icon="lucide-arrow-left" aria-label="All sessions" @click="emit('back')" />
        <h1 class="text-base font-medium text-ink-gray-9">Settings</h1>
      </div>
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:py-4">
      <ProviderLoginPanel v-if="login" :event="login.event" :notice="login.notice" @answer="emit('answer', $event)" @cancel="emit('cancel')" />

      <section class="space-y-3" aria-labelledby="providers-heading">
        <div class="flex items-center gap-2">
          <h2 id="providers-heading" class="min-w-0 flex-1 text-base font-medium text-ink-gray-9">Providers</h2>
          <AddProviderMenu :providers="providers" @select="addProvider" />
        </div>
        <ApiKeyForm v-if="keyProvider" :key="keyProvider.id" :provider="keyProvider" @save="(key) => emit('saveKey', keyProvider!.id, key)"
          @guided="startGuidedSetup(keyProvider!.id)" @cancel="keyProvider = undefined" />
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
  </div>
</template>
