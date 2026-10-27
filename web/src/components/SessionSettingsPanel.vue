<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Button, TextInput } from "frappe-ui";
import type { ModelChoice, SessionSettings } from "../../../server/src/protocol.ts";
import { getModelKey, loadRecentKeys, rememberModel } from "../recent-models.ts";

export type SettingsView = "main" | "models" | "effort";

const props = defineProps<{ settings: SessionSettings; disabled: boolean; isRunning: boolean; isSheet?: boolean }>();
const emit = defineEmits<{ model: [value: string]; thinking: [level: string] }>();
const titles: Record<SettingsView, string> = { main: "Select model", models: "More models", effort: "Effort" };
const view = defineModel<SettingsView>("view", { required: true });
const query = ref("");
const panel = ref<HTMLElement>();
const sheetHeight = ref<number>();
const recentKeys = ref(loadRecentKeys());
const isLocked = computed(() => props.disabled || props.isRunning);
const recentModels = computed(() => {
  const keys = props.settings.model ? [getModelKey(props.settings.model), ...recentKeys.value] : recentKeys.value;
  const models = [...new Set(keys)].map((key) => props.settings.models.find((model) => getModelKey(model) === key));
  return models.filter((model): model is ModelChoice => !!model).slice(0, 3);
});
const filteredModels = computed(() => {
  const text = query.value.trim().toLowerCase();
  return props.settings.models.filter((model) => `${model.name} ${getModelKey(model)}`.toLowerCase().includes(text));
});

watch(view, () => {
  query.value = "";
});
onMounted(() => {
  if (props.isSheet) sheetHeight.value = panel.value?.offsetHeight;
});

// A drag up grows the sheet to 60% of the screen. A drag down stays the sheet's close gesture.
let resizeStart: { y: number; height: number } | undefined;

function startResize(event: TouchEvent): void {
  if (!props.isSheet || !panel.value) return;
  const origin = event.target;
  if (!(origin instanceof Element)) return;
  // A swipe that starts on a form field belongs to the field, and a swipe that
  // starts inside a scrollable region (the model list) scrolls it. Growing the
  // sheet there would eat the gesture and its preventDefault would block the
  // native scroll, so the grow gesture only claims swipes that start elsewhere.
  if (origin.closest("input, textarea, select")) return;
  for (let el: Element | null = origin; el; el = el.parentElement) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return;
    }
    if (el === panel.value) break;
  }
  resizeStart = { y: event.touches[0].clientY, height: panel.value.offsetHeight };
}

function resize(event: TouchEvent): void {
  if (!resizeStart || !panel.value) return;
  const growth = resizeStart.y - event.touches[0].clientY;
  const height = Math.min(resizeStart.height + growth, window.innerHeight * 0.6);
  if (growth <= 0 || height <= panel.value.offsetHeight) return;
  sheetHeight.value = height;
  event.preventDefault();
}

function isSelected(model: ModelChoice): boolean {
  return !!props.settings.model && getModelKey(model) === getModelKey(props.settings.model);
}

function chooseModel(model: ModelChoice): void {
  recentKeys.value = rememberModel(recentKeys.value, model);
  emit("model", JSON.stringify([model.provider, model.id]));
  view.value = "main";
}

function chooseEffort(level: string): void {
  emit("thinking", level);
  view.value = "main";
}
</script>

<template>
  <div
    ref="panel"
    data-session-settings
    @touchstart="startResize"
    @touchmove="resize"
    @touchend="resizeStart = undefined"
    :style="isSheet && sheetHeight ? { height: `${sheetHeight}px` } : undefined"
    :class="[
      'flex flex-col gap-3 overflow-y-auto px-4 pb-4 sm:px-2 sm:pb-2',
      isSheet ? 'max-h-[calc(90dvh-1.625rem)]' : view === 'models' ? 'h-[min(60dvh,26rem)]' : '',
    ]"
  >
    <header v-if="isSheet" class="flex shrink-0 items-center gap-2">
      <Button
        v-if="view !== 'main'"
        variant="ghost"
        icon="lucide-chevron-left"
        aria-label="Back"
        @click="view = 'main'"
      />
      <h2 :class="['flex-1 text-center text-lg font-semibold text-ink-gray-9', view !== 'main' && 'pr-7']">
        {{ titles[view] }}
      </h2>
    </header>
    <Button
      v-else-if="view !== 'main'"
      class="shrink-0 self-start"
      variant="ghost"
      icon-left="lucide-chevron-left"
      label="Back"
      @click="view = 'main'"
    />
    <p v-if="isRunning" class="px-1 text-p-sm text-ink-gray-5">You can change settings after this run.</p>
    <template v-if="view === 'main'">
      <div
        class="shrink-0 divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1"
        role="listbox"
        aria-label="Recent models"
      >
        <button
          v-for="model in recentModels"
          :key="getModelKey(model)"
          type="button"
          role="option"
          :disabled="isLocked"
          :aria-selected="isSelected(model)"
          class="flex min-h-14 sm:min-h-10 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-60"
          @click="chooseModel(model)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-base text-ink-gray-9">{{ model.name }}</span>
            <span class="block truncate text-p-sm text-ink-gray-5">{{ getModelKey(model) }}</span>
          </span>
          <span v-if="isSelected(model)" class="lucide-check size-5 shrink-0 text-ink-gray-9" aria-hidden="true" />
        </button>
      </div>
      <div class="shrink-0 divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1">
        <button
          type="button"
          class="flex min-h-14 sm:min-h-10 w-full items-center gap-3 px-4 text-left disabled:opacity-50"
          :disabled="isLocked || settings.thinkingLevels.length < 2"
          @click="view = 'effort'"
        >
          <span class="flex-1 text-base text-ink-gray-9">Effort</span>
          <span class="text-base capitalize text-ink-gray-5">{{ settings.thinkingLevel }}</span>
          <span class="lucide-chevron-right size-5 text-ink-gray-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="flex min-h-14 sm:min-h-10 w-full items-center gap-3 px-4 text-left disabled:opacity-50"
          :disabled="isLocked"
          @click="view = 'models'"
        >
          <span class="flex-1 text-base text-ink-gray-9">More models</span>
          <span class="lucide-chevron-right size-5 text-ink-gray-4" aria-hidden="true" />
        </button>
      </div>
      <p class="px-1 text-p-sm text-ink-gray-5">Settings apply to this session on every device.</p>
    </template>
    <template v-else-if="view === 'models'">
      <TextInput
        v-model="query"
        class="shrink-0"
        size="lg"
        type="search"
        placeholder="Search models"
        aria-label="Search models"
      />
      <p v-if="!filteredModels.length" class="px-1 text-p-base text-ink-gray-5">No matching models</p>
      <div
        v-else
        class="min-h-0 flex-1 divide-y divide-outline-gray-1 overflow-y-auto rounded-4 bg-surface-gray-1"
        role="listbox"
        aria-label="Models"
      >
        <button
          v-for="model in filteredModels"
          :key="getModelKey(model)"
          type="button"
          role="option"
          :aria-selected="isSelected(model)"
          class="flex min-h-14 sm:min-h-10 w-full items-center gap-3 px-4 py-2 text-left"
          @click="chooseModel(model)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-base text-ink-gray-9">{{ model.name }}</span>
            <span class="block truncate text-p-sm text-ink-gray-5">{{ getModelKey(model) }}</span>
          </span>
          <span v-if="isSelected(model)" class="lucide-check size-5 shrink-0 text-ink-gray-9" aria-hidden="true" />
        </button>
      </div>
    </template>
    <div
      v-else
      class="min-h-0 divide-y divide-outline-gray-1 overflow-y-auto rounded-4 bg-surface-gray-1"
      role="listbox"
      aria-label="Effort"
    >
      <button
        v-for="level in settings.thinkingLevels"
        :key="level"
        type="button"
        role="option"
        :aria-selected="level === settings.thinkingLevel"
        class="flex min-h-14 sm:min-h-10 w-full items-center gap-3 px-4 text-left"
        @click="chooseEffort(level)"
      >
        <span class="flex-1 text-base capitalize text-ink-gray-9">{{ level }}</span>
        <span
          v-if="level === settings.thinkingLevel"
          class="lucide-check size-5 shrink-0 text-ink-gray-9"
          aria-hidden="true"
        />
      </button>
    </div>
  </div>
</template>
