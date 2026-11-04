<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button, Select, TextInput } from "frappe-ui";
import { getDayCount, getRetentionChoice, getRetentionDays, retentionOptions } from "../retention.ts";

const props = defineProps<{ retentionDays?: number | null; isUpdating: boolean }>();
const emit = defineEmits<{ set: [days: number | null] }>();

const isEditingCustom = ref(false);
const customDays = ref("");
// The field stays open for a stored period that no preset names, so its day count is visible.
const isCustom = computed(
  () =>
    isEditingCustom.value ||
    (typeof props.retentionDays === "number" && getRetentionDays(String(props.retentionDays)) === undefined),
);
// The select shows the stored value, unless the reader is typing a custom count.
const choice = computed(() => (isCustom.value ? "custom" : getRetentionChoice(props.retentionDays)));
const customDayCount = computed(() => getDayCount(customDays.value));

watch(
  () => props.retentionDays,
  (days) => {
    isEditingCustom.value = false;
    if (typeof days === "number" && getRetentionDays(String(days)) === undefined) customDays.value = String(days);
  },
);

function choose(value: unknown): void {
  if (typeof value !== "string") return;
  const days = getRetentionDays(value);
  if (days === undefined) {
    isEditingCustom.value = true;
    customDays.value = typeof props.retentionDays === "number" ? String(props.retentionDays) : "";
    return;
  }
  isEditingCustom.value = false;
  emit("set", days);
}

function saveCustom(): void {
  if (customDayCount.value === undefined) return;
  isEditingCustom.value = false;
  emit("set", customDayCount.value);
}
</script>

<template>
  <section aria-labelledby="retention-heading">
    <div class="mb-2 flex min-h-7 items-center gap-1">
      <h2 id="retention-heading" class="min-w-0 flex-1 py-1 text-p-sm font-medium text-ink-gray-5">Auto delete</h2>
    </div>
    <div class="divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1">
      <div class="flex min-h-14 items-center gap-3 px-4 py-2 sm:min-h-12">
        <span class="min-w-0 flex-1">
          <span class="block text-base text-ink-gray-9">Sessions</span>
          <span class="block text-p-xs text-ink-gray-5">Delete a session after its last message.</span>
        </span>
        <Select
          class="w-32"
          aria-label="Auto delete sessions"
          :options="retentionOptions"
          :model-value="choice"
          :disabled="isUpdating"
          @update:model-value="choose"
        />
      </div>
      <form v-if="isCustom" class="flex min-h-14 items-center gap-2 px-4 py-2" @submit.prevent="saveCustom">
        <TextInput
          v-model="customDays"
          class="min-w-0 flex-1"
          type="number"
          min="1"
          inputmode="numeric"
          placeholder="Days"
          aria-label="Days to keep a session"
        />
        <Button
          type="submit"
          variant="solid"
          icon="lucide-check"
          aria-label="Save days"
          :disabled="customDayCount === undefined || isUpdating"
        />
      </form>
    </div>
    <p class="mt-2 px-1 text-p-sm text-ink-gray-5">A running session is kept.</p>
  </section>
</template>
