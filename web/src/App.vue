<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { Transcript } from "./transcript.ts";
import Composer from "./components/Composer.vue";
import MessageItem from "./components/MessageItem.vue";

const transcript = reactive(new Transcript());
const connection = ref("Connecting");
const error = ref("");
const isSending = ref(false);
const transcriptElement = ref<HTMLElement>();
let socket: WebSocket;
const isDisabled = computed(() => connection.value !== "Connected" || transcript.is_running || isSending.value);
const statusLabel = computed(() => connection.value === "Connected"
  ? transcript.is_running ? "Working" : "Connected"
  : connection.value === "Connecting" ? "Connecting" : "Offline");
const statusDot = computed(() => connection.value === "Connected" ? "bg-surface-green-7" : "bg-surface-gray-4");

onMounted(() => {
  const url = new URL("/ws", window.location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(url);
  socket.onopen = () => { connection.value = "Connected"; };
  socket.onclose = () => { connection.value = "Disconnected. Reload to connect."; };
  socket.onerror = () => { error.value = "The connection failed. Reload to try again."; };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    isSending.value = false;
    if (message.type === "error") error.value = message.message;
    if (message.type === "event") transcript.apply(message.event);
  };
});
onUnmounted(() => socket?.close());

watch(() => transcript.messages, async () => {
  await nextTick();
  const element = transcriptElement.value;
  if (element) element.scrollTop = element.scrollHeight;
}, { deep: true });

function send(text: string): void {
  if (isDisabled.value) return;
  socket.send(JSON.stringify({ type: "prompt", text }));
  isSending.value = true;
  error.value = "";
}
</script>

<template>
  <main class="flex h-dvh min-h-0 flex-col bg-surface-base text-ink-gray-8">
    <header class="flex h-12 shrink-0 items-center justify-between px-4">
      <h1 class="text-base font-semibold text-ink-gray-9">pi remote</h1>
      <span role="status" class="flex items-center gap-2 text-p-sm text-ink-gray-5">
        <span :class="['size-1.5 rounded-full', statusDot]" aria-hidden="true" />{{ statusLabel }}
      </span>
    </header>
    <section ref="transcriptElement" class="min-h-0 flex-1 overflow-y-auto" aria-label="Conversation" aria-live="polite">
      <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-6">
        <div v-if="!transcript.messages.length" class="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <h2 class="text-xl font-semibold text-ink-gray-9">What are we working on?</h2>
          <p class="text-p-base text-ink-gray-5">Send a prompt to start.</p>
        </div>
        <MessageItem v-for="(message, index) in transcript.messages" :key="index" :message="message" />
      </div>
    </section>
    <Composer :disabled="isDisabled" :is-sending="isSending" :is-running="transcript.is_running" :error="error" @send="send" />
  </main>
</template>
