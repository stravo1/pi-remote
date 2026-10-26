<script setup lang="ts">
import { ref } from "vue";
import { Button, TextInput } from "frappe-ui";
import type { ProviderSettings as Provider } from "../../../server/src/pi-adapter.ts";

defineProps<{ provider: Provider }>();
const emit = defineEmits<{ save: [key: string]; guided: []; cancel: [] }>();
const key = ref("");

function save(): void {
  if (key.value.trim()) emit("save", key.value.trim());
}
</script>

<template>
  <form class="space-y-3 rounded-4 border border-outline-gray-2 p-3" @submit.prevent="save">
    <div class="flex gap-2">
      <TextInput v-model="key" class="min-w-0 flex-1" type="password" autocomplete="off"
        :placeholder="`${provider.name} API key`" :aria-label="`${provider.name} API key`" autofocus />
      <Button variant="solid" type="submit" label="Save key" :disabled="!key.trim()" />
    </div>
    <div class="flex gap-2">
      <Button variant="ghost" label="Guided key setup" @click="emit('guided')" />
      <Button variant="ghost" label="Cancel" @click="emit('cancel')" />
    </div>
  </form>
</template>
