<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { Alert, Avatar, Badge, Button, PageHeader, PageHeaderMobile, PageHeaderTitle, Textarea } from "frappe-ui";
import { Transcript } from "./transcript.ts";

const transcript = reactive(new Transcript());
const prompt = ref("");
const connection = ref("Connecting");
const error = ref("");
const isSending = ref(false);
const transcriptElement = ref<HTMLElement>();
let socket: WebSocket;
const isDisabled = computed(() => connection.value !== "Connected" || transcript.is_running || isSending.value);
const statusLabel = computed(() => connection.value === "Connected"
  ? transcript.is_running ? "Working" : "Connected"
  : connection.value === "Connecting" ? "Connecting" : "Offline");
const statusTheme = computed(() => connection.value === "Connected" ? "green" : "gray");

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

function send(): void {
  if (isDisabled.value || !prompt.value.trim()) return;
  socket.send(JSON.stringify({ type: "prompt", text: prompt.value }));
  isSending.value = true;
  prompt.value = "";
  error.value = "";
}
</script>

<template>
  <main class="flex h-dvh min-h-0 flex-col bg-surface-base text-ink-gray-9">
    <PageHeader class="hidden shrink-0 sm:flex">
      <h1><PageHeaderTitle title="pi remote" /></h1>
      <Badge role="status" :theme="statusTheme" :label="statusLabel" />
    </PageHeader>
    <PageHeaderMobile title="pi remote" class="shrink-0 sm:hidden">
      <template #suffix><Badge role="status" :theme="statusTheme" :label="statusLabel" size="sm" /></template>
    </PageHeaderMobile>
    <section ref="transcriptElement" class="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      aria-label="Conversation" aria-live="polite">
      <div v-if="!transcript.messages.length" class="flex min-h-full flex-col items-center justify-center gap-3 text-center">
        <span class="lucide-message-square size-6 text-ink-gray-5" aria-hidden="true" />
        <h2 class="text-xl font-semibold">What are we working on?</h2>
        <p class="max-w-sm text-p-base text-ink-gray-6">Send a prompt to start a conversation with your agent.</p>
        <p class="max-w-sm text-p-sm text-ink-gray-5">Messages stay visible while this tab is open.</p>
      </div>
      <article v-for="(message, index) in transcript.messages" :key="index" :class="['message mb-6 flex gap-3 last:mb-0', message.role]">
        <Avatar :label="message.role === 'user' ? 'You' : 'pi'" size="sm" shape="square" class="shrink-0" />
        <div class="min-w-0 flex-1">
          <h2 class="mb-2 text-sm font-medium text-ink-gray-7">{{ message.role === 'user' ? 'You' : message.role === 'toolResult' ? 'Tool result' : 'pi' }}</h2>
          <div :class="message.role === 'user' ? 'rounded-3 bg-surface-gray-1 px-3 py-2' : ''">
            <template v-for="(block, contentIndex) in message.content" :key="contentIndex">
              <details v-if="block.type === 'thinking'" class="mb-2 text-p-sm text-ink-gray-6">
                <summary class="cursor-pointer">Thinking</summary><p class="mt-2 whitespace-pre-wrap break-words">{{ block.text }}</p>
              </details>
              <pre v-else-if="block.type === 'toolCall'" class="rounded-3 bg-surface-gray-1 p-3 text-p-sm whitespace-pre-wrap break-words">{{ block.text }}</pre>
              <p v-else class="text-p-base whitespace-pre-wrap break-words">{{ block.text }}</p>
            </template>
          </div>
        </div>
      </article>
    </section>
    <footer class="shrink-0 border-t border-outline-gray-2 bg-surface-base">
      <form class="composer mx-auto w-full max-w-3xl space-y-3 px-4 pt-4 sm:px-6" @submit.prevent="send">
        <Alert v-if="error" role="alert" theme="red" :title="error" />
        <Textarea v-model="prompt" label="Message" placeholder="Ask pi to do something…" variant="outline" size="md" :rows="3" :disabled="isDisabled" />
        <div class="flex items-center justify-between gap-3">
          <span class="text-p-sm text-ink-gray-5">{{ transcript.is_running ? 'pi is working…' : 'One prompt at a time' }}</span>
          <Button type="submit" variant="solid" size="md" :disabled="isDisabled || !prompt.trim()" :loading="isSending" label="Send prompt" />
        </div>
      </form>
    </footer>
  </main>
</template>
