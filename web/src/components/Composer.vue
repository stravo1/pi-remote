<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Alert, Button, Textarea } from "frappe-ui";

import { buttonSize } from "../button-size.ts";
import type { CommandChoice, Snapshot } from "../../../server/src/pi-adapter.ts";
import { readImageFile, type AttachedImage } from "../images.ts";
import { getCommandMatches } from "../slash-commands.ts";

const props = defineProps<{
  disabled: boolean;
  isSending: boolean;
  isRunning: boolean;
  canSendImages: boolean;
  error: string;
  queue: Snapshot["queue"];
  commands: CommandChoice[];
  // Returns false when the text did not reach the socket.
  send: (text: string, images: { data: string; mimeType: string }[]) => boolean;
}>();
const emit = defineEmits<{
  steer: [text: string];
  abort: [];
}>();
const text = ref("");
const root = ref<HTMLElement>();
const queueList = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();
const images = ref<AttachedImage[]>([]);
const canSend = computed(
  () =>
    !props.disabled &&
    (text.value.trim() !== "" || images.value.length > 0) &&
    !(props.isRunning && images.value.length > 0),
);
const hasKeyboard = window.matchMedia("(pointer: fine)").matches;
const maxHeight = 160;
const highlighted = ref(0);
const isMenuDismissed = ref(false);
const matches = computed(() => (isMenuDismissed.value ? [] : getCommandMatches(text.value, props.commands)));

watch(text, async () => {
  highlighted.value = 0;
  isMenuDismissed.value = false;
  await nextTick();
  const element = root.value?.querySelector("textarea");
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
});

watch(
  () => props.queue.followUp.length,
  async (count, previous) => {
    if (count <= previous) return;
    await nextTick();
    queueList.value?.scrollTo({ top: queueList.value.scrollHeight });
  },
);

async function onFilesChosen(event: Event): Promise<void> {
  // Reading the FileList must precede clearing the input: the list is live
  // and clearing the value empties it.
  const files = Array.from((event.target as HTMLInputElement).files ?? []);
  (event.target as HTMLInputElement).value = "";
  if (!files.length) return;
  for (const file of files) {
    if (images.value.length >= 4) break;
    try {
      images.value.push(await readImageFile(file));
    } catch {
      // A file the browser cannot decode as an image is simply not attached.
    }
  }
}

function removeImage(image: AttachedImage): void {
  URL.revokeObjectURL(image.preview);
  images.value = images.value.filter((item) => item !== image);
}

function submit(): void {
  if (!canSend.value) return;
  const payloads = images.value.map(({ data, mimeType }) => ({ data, mimeType }));
  // A send that did not reach the socket keeps the draft and its images, so nothing is lost.
  if (!props.send(text.value, payloads)) return;
  for (const image of images.value) URL.revokeObjectURL(image.preview);
  images.value = [];
  text.value = "";
}

function onEnter(event: KeyboardEvent): void {
  if (!hasKeyboard || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  const command = matches.value[highlighted.value];
  if (command && text.value !== `/${command.name}`) chooseCommand(command);
  else submit();
}

function chooseCommand(command: CommandChoice): void {
  text.value = `/${command.name} `;
  root.value?.querySelector("textarea")?.focus();
}

// Arrow keys move through the matches, Tab picks one, and Escape hides them.
function onMenuKey(event: KeyboardEvent): void {
  if (!matches.value.length) return;
  const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
  if (event.key in moves) {
    highlighted.value = (highlighted.value + moves[event.key] + matches.value.length) % matches.value.length;
  } else if (event.key === "Tab") chooseCommand(matches.value[highlighted.value]);
  else if (event.key === "Escape") isMenuDismissed.value = true;
  else return;
  event.preventDefault();
}
</script>

<template>
  <form
    ref="root"
    class="mx-auto w-full shrink-0 border-t border-outline-gray-1 sm:max-w-2xl sm:border-t-0 sm:px-4"
    @submit.prevent="submit"
  >
    <div class="sm:rounded-t-6 sm:border sm:border-b-0 sm:border-outline-gray-2 sm:bg-surface-base">
      <div
        v-if="error || matches.length || queue.steering.length || queue.followUp.length"
        class="space-y-2 px-3 pt-2 sm:px-2"
      >
        <Alert v-if="error" role="alert" theme="red" :title="error" />
        <ul
          v-if="matches.length"
          id="command-matches"
          class="max-h-60 divide-y divide-outline-gray-1 overflow-y-auto rounded-4 bg-surface-gray-1"
          role="listbox"
          aria-label="Commands"
        >
          <li
            v-for="(command, index) in matches"
            :key="command.name"
            role="option"
            :aria-selected="index === highlighted"
            :class="[
              'flex min-h-12 cursor-pointer flex-col justify-center px-3 py-1.5 sm:min-h-9',
              index === highlighted && hasKeyboard && 'bg-surface-gray-3',
            ]"
            @mousedown.prevent
            @click="chooseCommand(command)"
          >
            <span class="truncate text-base text-ink-gray-9">
              /{{ command.name }}
              <span v-if="command.argumentHint" class="text-ink-gray-5">{{ command.argumentHint }}</span>
            </span>
            <span v-if="command.description" class="truncate text-p-sm text-ink-gray-5">{{ command.description }}</span>
          </li>
        </ul>
        <ul
          v-if="queue.steering.length || queue.followUp.length"
          ref="queueList"
          class="max-h-[7.625rem] divide-y divide-outline-gray-1 overflow-y-auto rounded-4 bg-surface-gray-1 text-p-sm"
          aria-label="Queued messages"
        >
          <li
            v-for="(message, index) in queue.steering"
            :key="`steer-${index}`"
            class="flex min-h-10 items-start gap-2 px-3 py-2"
          >
            <span
              class="lucide-corner-down-right mt-0.5 size-4 shrink-0 text-ink-gray-5"
              role="img"
              aria-label="After the current turn"
            />
            <p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink-gray-8">{{ message }}</p>
          </li>
          <li
            v-for="(message, index) in queue.followUp"
            :key="`follow-${index}`"
            class="flex min-h-10 items-start gap-2 px-3 py-1.5"
          >
            <span class="lucide-clock mt-1 size-4 shrink-0 text-ink-gray-5" role="img" aria-label="After this run" />
            <p class="min-w-0 flex-1 self-center whitespace-pre-wrap break-words text-ink-gray-8">{{ message }}</p>
            <Button
              variant="ghost"
              size="sm"
              icon="lucide-arrow-up"
              aria-label="Send now"
              @click="emit('steer', message)"
            />
          </li>
        </ul>
      </div>
      <div v-if="images.length" class="flex flex-wrap gap-2 px-3 pt-2 sm:px-2" role="list" aria-label="Attached images">
        <div v-for="(image, index) in images" :key="image.preview" class="relative" role="listitem">
          <img :src="image.preview" alt="" class="size-14 rounded-4 border border-outline-gray-2 object-cover" />
          <Button
            variant="ghost"
            size="sm"
            class="absolute -right-1 -top-1 !h-5 !w-5 rounded-full bg-surface-gray-3"
            icon="lucide-x"
            :aria-label="`Remove image ${index + 1}`"
            @click="removeImage(image)"
          />
        </div>
      </div>
      <div class="flex items-end gap-1.5 px-2 py-2 sm:px-1.5 sm:py-1.5">
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          class="sr-only"
          aria-label="Choose images"
          @change="onFilesChosen"
        />
        <Button
          v-if="canSendImages"
          type="button"
          variant="ghost"
          :size="buttonSize"
          class="shrink-0"
          icon="lucide-paperclip"
          :aria-label="images.length ? 'Attach more images' : 'Attach images'"
          :disabled="disabled"
          @click="fileInput?.click()"
        />
        <Textarea
          v-model="text"
          class="min-w-0 flex-1 resize-none !py-2 sm:!min-h-10 sm:!py-1.5 !text-lg sm:!text-p-base"
          variant="ghost"
          size="md"
          :rows="1"
          aria-label="Message"
          placeholder="Message pi"
          :aria-controls="matches.length ? 'command-matches' : undefined"
          @keydown.enter="onEnter"
          @keydown="onMenuKey"
        />
        <Button
          v-if="isRunning"
          type="button"
          variant="solid"
          :size="buttonSize"
          class="shrink-0"
          icon="lucide-square"
          aria-label="Stop run"
          @click="emit('abort')"
        />
        <Button
          type="submit"
          variant="solid"
          :size="buttonSize"
          class="shrink-0"
          icon="lucide-arrow-up"
          :aria-label="isRunning ? 'Send follow-up' : 'Send prompt'"
          :disabled="!canSend"
          :loading="isSending"
        />
      </div>
    </div>
  </form>
</template>
