<script setup lang="ts">
import { ref, watch } from "vue";
import { Button, Dialog, TextInput } from "frappe-ui";

const props = defineProps<{ open: boolean; root?: string; error: string }>();
const emit = defineEmits<{ "update:open": [open: boolean]; submit: [name: string] }>();
const name = ref("");

watch(() => props.open, (isOpen) => { if (isOpen) name.value = ""; });

function submit(): void {
  if (name.value.trim()) emit("submit", name.value.trim());
}
</script>

<template>
  <Dialog :open="open" title="New group" size="sm" @update:open="emit('update:open', $event)">
    <form class="space-y-2" @submit.prevent="submit">
      <TextInput v-model="name" size="lg" placeholder="Folder name" aria-label="Folder name" autofocus />
      <p class="text-p-sm text-ink-gray-5">Creates <code class="font-mono">{{ root }}/{{ name || "name" }}</code> if it does not exist.</p>
      <p v-if="error" role="alert" class="text-p-sm text-ink-red-3">{{ error }}</p>
    </form>
    <template #actions>
      <Button variant="solid" label="Create group" :disabled="!name.trim()" @click="submit" />
    </template>
  </Dialog>
</template>
