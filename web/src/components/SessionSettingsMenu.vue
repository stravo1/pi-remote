<script setup lang="ts">
import { ref, watch } from "vue";
import { BottomSheet, Button, Popover } from "frappe-ui";
import type { SessionSettings } from "../../../server/src/pi-adapter.ts";
import { buttonSize } from "../button-size.ts";
import SessionSettingsPanel, { type SettingsView } from "./SessionSettingsPanel.vue";

defineProps<{ settings: SessionSettings; disabled: boolean; isRunning: boolean }>();
const emit = defineEmits<{ model: [value: string]; thinking: [level: string] }>();
const desktopQuery = window.matchMedia("(min-width: 640px)");
const isDesktop = ref(desktopQuery.matches);
const isOpen = ref(false);
const view = ref<SettingsView>("main");

desktopQuery.addEventListener("change", (event) => { isDesktop.value = event.matches; });
watch(isOpen, (value) => { if (!value) view.value = "main"; });
</script>

<template>
  <span class="contents">
    <Popover v-if="isDesktop" v-model:open="isOpen" side="bottom" align="end">
      <template #trigger>
        <Button variant="ghost" :size="buttonSize" icon="lucide-sliders-horizontal" aria-label="Session settings" />
      </template>
      <div class="w-[min(24rem,calc(100vw-2rem))] pt-3">
        <SessionSettingsPanel v-model:view="view" :settings="settings" :disabled="disabled" :is-running="isRunning"
          @model="(value) => emit('model', value)" @thinking="(level) => emit('thinking', level)" />
      </div>
    </Popover>
    <template v-else>
      <Button variant="ghost" :size="buttonSize" icon="lucide-sliders-horizontal" aria-label="Session settings" @click="isOpen = true" />
      <BottomSheet v-model:open="isOpen">
        <SessionSettingsPanel v-model:view="view" is-sheet :settings="settings" :disabled="disabled" :is-running="isRunning"
          class="pb-[max(1rem,env(safe-area-inset-bottom))]" @model="(value) => emit('model', value)" @thinking="(level) => emit('thinking', level)" />
      </BottomSheet>
    </template>
  </span>
</template>
