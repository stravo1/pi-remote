<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Alert, Button, Textarea } from "frappe-ui";

import { buttonSize } from "../button-size.ts";
import type { CommandChoice, Snapshot } from "../../../server/src/protocol.ts";
import { readImageFile, maxImages, type AttachedImage } from "../images.ts";
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
  steer: [id: string];
  abort: [];
}>();
const text = ref("");
const root = ref<HTMLElement>();
const queueList = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();
const images = ref<AttachedImage[]>([]);
const canSend = computed(() => !props.disabled && (text.value.trim() !== "" || images.value.length > 0));
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
  await addFiles(files);
}

async function addFiles(files: File[]): Promise<void> {
  if (!props.canSendImages) return;
  for (const file of files) {
    if (images.value.length >= maxImages) break;
    try {
      images.value.push(await readImageFile(file));
    } catch {
      // A file the browser cannot decode as an image is simply not attached.
    }
  }
}

function onPaste(event: ClipboardEvent): void {
  if (!props.canSendImages) return;
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  void addFiles(files);
}

// The depth counter keeps the highlight steady while the pointer crosses
// child elements, which fires dragleave for each of them.
const dragDepth = ref(0);
const isDragging = computed(() => dragDepth.value > 0);

function hasFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

// The whole window takes files, so a drop on the transcript or the header
// still attaches to this input, which is the only place an image can go.
function onDragEnter(event: DragEvent): void {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  if (props.canSendImages) dragDepth.value++;
}

function onDragOver(event: DragEvent): void {
  if (!hasFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = props.canSendImages ? "copy" : "none";
}

function onDragLeave(event: DragEvent): void {
  if (!hasFileDrag(event)) return;
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function onDrop(event: DragEvent): void {
  if (!hasFileDrag(event)) return;
  // Stop the browser from opening the dropped file, even when it is not an image.
  event.preventDefault();
  dragDepth.value = 0;
  if (!props.canSendImages) return;
  const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  void addFiles(files);
  root.value?.querySelector("textarea")?.focus();
}

onMounted(() => {
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
  window.addEventListener("paste", onPaste);
});

onBeforeUnmount(() => {
  window.removeEventListener("dragenter", onDragEnter);
  window.removeEventListener("dragover", onDragOver);
  window.removeEventListener("dragleave", onDragLeave);
  window.removeEventListener("drop", onDrop);
  window.removeEventListener("paste", onPaste);
});

function removeImage(image: AttachedImage): void {
  URL.revokeObjectURL(image.preview);
  images.value = images.value.filter((item) => item !== image);
}

function imageUrl(image: { data: string; mimeType: string }): string {
  return `data:${image.mimeType};base64,${image.data}`;
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
    :class="[
      'mx-auto w-full shrink-0 border-t border-outline-gray-1 sm:max-w-2xl sm:border-t-0 sm:px-4',
      isDragging && 'sm:rounded-t-6 sm:outline sm:outline-2 sm:-outline-offset-2 sm:outline-outline-gray-3',
    ]"
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
          <li v-for="message in queue.steering" :key="message.id" class="flex min-h-10 items-start gap-2 px-3 py-2">
            <span
              class="lucide-corner-down-right mt-0.5 size-4 shrink-0 text-ink-gray-5"
              role="img"
              aria-label="After the current turn"
            />
            <div class="min-w-0 flex-1 space-y-1">
              <p v-if="message.text" class="whitespace-pre-wrap break-words text-ink-gray-8">{{ message.text }}</p>
              <div v-if="message.images.length" class="flex flex-wrap gap-1" role="list" aria-label="Queued images">
                <img
                  v-for="(image, index) in message.images"
                  :key="index"
                  :src="imageUrl(image)"
                  :alt="`Queued image ${index + 1}`"
                  class="size-8 rounded-3 border border-outline-gray-2 object-cover"
                />
              </div>
            </div>
          </li>
          <li v-for="message in queue.followUp" :key="message.id" class="flex min-h-10 items-start gap-2 px-3 py-1.5">
            <span class="lucide-clock mt-0.5 size-4 shrink-0 text-ink-gray-5" role="img" aria-label="After this run" />
            <div class="min-w-0 flex-1 space-y-1">
              <p v-if="message.text" class="whitespace-pre-wrap break-words text-ink-gray-8">{{ message.text }}</p>
              <div v-if="message.images.length" class="flex flex-wrap gap-1" role="list" aria-label="Queued images">
                <img
                  v-for="(image, index) in message.images"
                  :key="index"
                  :src="imageUrl(image)"
                  :alt="`Queued image ${index + 1}`"
                  class="size-8 rounded-3 border border-outline-gray-2 object-cover"
                />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="shrink-0 self-center"
              icon="lucide-arrow-up"
              aria-label="Send now"
              @click="emit('steer', message.id)"
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
          class="min-w-0 flex-1 resize-none !min-h-0 !py-2 !text-lg !leading-6 sm:!py-1.5 sm:!text-p-base sm:!leading-5"
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
          variant="subtle"
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
