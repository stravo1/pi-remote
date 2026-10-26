<script setup lang="ts">
import { computed } from "vue";
import { Button, Switch } from "frappe-ui";

const props = defineProps<{
  publicKey?: string | null;
  isSupported: boolean;
  permission: NotificationPermission;
  isOn: boolean;
  isUpdating: boolean;
}>();
const emit = defineEmits<{ enable: []; disable: []; test: [] }>();

const notice = computed(() => {
  if (props.publicKey === null) return "Push is not set up on this server. Add push settings to its configuration.";
  if (!props.isSupported) return "On iPhone and iPad, add pi remote to the Home Screen and open it from there.";
  if (props.permission === "denied") return "This browser blocks notifications. Allow them in its site settings.";
  return "";
});

function toggle(value: boolean): void {
  if (value) emit("enable");
  else emit("disable");
}
</script>

<template>
  <section aria-labelledby="notifications-heading">
    <div class="mb-2 flex min-h-7 items-center gap-1">
      <h2 id="notifications-heading" class="min-w-0 flex-1 py-1 text-p-sm font-medium text-ink-gray-5">
        Notifications
      </h2>
    </div>
    <div class="divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1">
      <div class="flex min-h-14 items-center gap-3 px-4 py-2 sm:min-h-12">
        <span class="min-w-0 flex-1">
          <span class="block text-base text-ink-gray-9">Push notifications</span>
          <span class="block text-p-xs text-ink-gray-5">Notify this device when a run finishes.</span>
        </span>
        <Switch
          :model-value="isOn"
          :disabled="!!notice || publicKey === undefined || isUpdating"
          aria-label="Push notifications"
          @update:model-value="toggle"
        />
      </div>
      <div v-if="isOn" class="flex min-h-14 items-center gap-3 px-4 py-2 sm:min-h-12">
        <span class="min-w-0 flex-1 text-base text-ink-gray-9">Test notification</span>
        <Button label="Send" :disabled="isUpdating" @click="emit('test')" />
      </div>
    </div>
    <p v-if="notice" class="mt-2 px-1 text-p-sm text-ink-gray-5">{{ notice }}</p>
  </section>
</template>
