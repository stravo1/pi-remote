<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { Button, Textarea } from "frappe-ui";
import { Transcript } from "./transcript.ts";

const transcript = reactive(new Transcript());
const prompt = ref("");
const connection = ref("Connecting");
const error = ref("");
const isSending = ref(false);
const transcriptElement = ref<HTMLElement>();
let socket: WebSocket;
const isDisabled = computed(() => connection.value !== "Connected" || transcript.is_running || isSending.value);

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
  <main class="app-shell">
    <header>
      <div><span class="eyebrow">YOUR AGENT, ANYWHERE</span><h1>pi remote</h1></div>
      <span class="connection" role="status">{{ transcript.is_running ? 'Working' : connection }}</span>
    </header>
    <section ref="transcriptElement" class="transcript" aria-label="Conversation" aria-live="polite">
      <div v-if="!transcript.messages.length" class="empty">
        <h2>What are we working on?</h2>
        <p>Send a prompt to your agent. Replies appear here as they arrive.</p>
        <p class="hint">This first version shows messages received while this page is open.</p>
      </div>
      <article v-for="(message, index) in transcript.messages" :key="index" :class="['message', message.role]">
        <h2>{{ message.role === 'user' ? 'You' : message.role === 'toolResult' ? 'Tool result' : 'pi' }}</h2>
        <template v-for="(block, contentIndex) in message.content" :key="contentIndex">
          <details v-if="block.type === 'thinking'" class="thinking"><summary>Thinking</summary><p>{{ block.text }}</p></details>
          <pre v-else-if="block.type === 'toolCall'" class="tool-call">{{ block.text }}</pre>
          <p v-else>{{ block.text }}</p>
        </template>
      </article>
    </section>
    <form class="composer" @submit.prevent="send">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <Textarea v-model="prompt" label="Message" placeholder="Ask pi to do something…" :rows="3" :disabled="isDisabled" />
      <div class="composer-footer"><span>{{ transcript.is_running ? 'pi is working…' : 'One prompt at a time' }}</span>
        <Button type="submit" variant="solid" :disabled="isDisabled || !prompt.trim()" label="Send prompt" />
      </div>
    </form>
  </main>
</template>
