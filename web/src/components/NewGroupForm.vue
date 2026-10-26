<script setup lang="ts">
import { ref } from "vue";
import { Button, TextInput } from "frappe-ui";

defineProps<{ error: string }>();
const emit = defineEmits<{ submit: [name: string]; cancel: [] }>();
const name = ref("");
const isSubmitted = ref(false);

function submit(): void {
  if (!name.value.trim()) return;
  isSubmitted.value = true;
  emit("submit", name.value.trim());
}
</script>

<template>
  <form class="space-y-1.5" aria-label="New project" @submit.prevent="submit" @keydown.esc="emit('cancel')">
    <div class="flex items-center gap-2">
      <TextInput v-model="name" class="min-w-0 flex-1" placeholder="Folder name" aria-label="Folder name" autofocus />
      <Button label="Cancel" @click="emit('cancel')" />
      <Button type="submit" variant="solid" label="Create" :disabled="!name.trim()" />
    </div>
    <p v-if="isSubmitted && error" role="alert" class="text-p-sm text-ink-red-3">{{ error }}</p>
  </form>
</template>
