<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { Button, TextInput, toast } from "frappe-ui";

const props = defineProps<{ error: string }>();
const emit = defineEmits<{ submit: [name: string]; cancel: [] }>();
const name = ref("");
const isSubmitted = ref(false);
const input = ref<{ focus(): void }>();

onMounted(() => input.value?.focus());

watch(() => props.error, (message) => { if (isSubmitted.value && message) toast.error(message); });

function submit(): void {
  if (!name.value.trim()) return;
  isSubmitted.value = true;
  emit("submit", name.value.trim());
}
</script>

<template>
  <form class="flex items-center gap-2" aria-label="New project" @submit.prevent="submit" @keydown.esc="emit('cancel')">
    <TextInput ref="input" v-model="name" class="min-w-0 flex-1" placeholder="Folder name" aria-label="Folder name" />
    <Button variant="ghost" icon="lucide-x" aria-label="Cancel" @click="emit('cancel')" />
    <Button type="submit" variant="solid" icon="lucide-check" aria-label="Create" :disabled="!name.trim()" />
  </form>
</template>
