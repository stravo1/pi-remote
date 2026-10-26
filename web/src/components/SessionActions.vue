<script setup lang="ts">
import { computed, ref } from "vue";
import { Button, Dialog, Dropdown, Textarea, TextInput } from "frappe-ui";
import { buttonSize } from "../button-size.ts";

const props = defineProps<{ title: string; disabled: boolean; isRunning: boolean }>();
const emit = defineEmits<{ rename: [name: string]; compact: [instructions: string]; showInfo: [] }>();
const openDialog = ref<"rename" | "compact">();
const name = ref("");
const instructions = ref("");

const options = computed(() => [
  { label: "Rename", icon: "lucide-pencil", disabled: props.disabled, onClick: () => openRename() },
  {
    label: "Compact",
    icon: "lucide-fold-vertical",
    disabled: props.disabled || props.isRunning,
    onClick: () => openCompact(),
  },
  { label: "Session info", icon: "lucide-info", onClick: () => emit("showInfo") },
]);

function openRename(): void {
  name.value = props.title;
  openDialog.value = "rename";
}

function openCompact(): void {
  instructions.value = "";
  openDialog.value = "compact";
}

function rename(): void {
  if (!name.value.trim()) return;
  emit("rename", name.value);
  openDialog.value = undefined;
}

function compact(): void {
  emit("compact", instructions.value);
  openDialog.value = undefined;
}

function setOpen(value: boolean): void {
  if (!value) openDialog.value = undefined;
}
</script>

<template>
  <span class="contents">
    <Dropdown :options="options" align="end">
      <Button variant="ghost" :size="buttonSize" icon="lucide-ellipsis" aria-label="Session actions" />
    </Dropdown>
    <Dialog :open="openDialog === 'rename'" title="Rename session" size="md" @update:open="setOpen">
      <form id="rename-form" @submit.prevent="rename">
        <TextInput v-model="name" size="lg" aria-label="Session name" autofocus />
      </form>
      <template #actions="{ close }">
        <div class="flex justify-end gap-2">
          <Button label="Cancel" @click="close" />
          <Button type="submit" form="rename-form" variant="solid" label="Save" :disabled="!name.trim()" />
        </div>
      </template>
    </Dialog>
    <Dialog :open="openDialog === 'compact'" title="Compact context" size="md" @update:open="setOpen">
      <p class="mb-3 text-p-base text-ink-gray-7">
        pi replaces older messages with a summary, so the session uses fewer tokens.
      </p>
      <Textarea
        v-model="instructions"
        :rows="3"
        placeholder="What the summary should keep (optional)"
        aria-label="Compaction instructions"
      />
      <template #actions="{ close }">
        <div class="flex justify-end gap-2">
          <Button label="Cancel" @click="close" />
          <Button variant="solid" label="Compact" @click="compact" />
        </div>
      </template>
    </Dialog>
  </span>
</template>
