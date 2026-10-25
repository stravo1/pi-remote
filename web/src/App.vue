<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { reactive } from "vue";
import { Button } from "frappe-ui";
import Composer from "./components/Composer.vue";
import MessageItem from "./components/MessageItem.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import { getProjectName, getSessionTitle } from "./protocol.ts";
import { Workspace } from "./workspace.ts";

const workspace = reactive(new Workspace());
const transcriptElement = ref<HTMLElement>();
const isDrawerOpen = ref(false);

onMounted(() => workspace.start());

watch(() => workspace.transcript.messages, async () => {
  await nextTick();
  const element = transcriptElement.value;
  if (element) element.scrollTop = element.scrollHeight;
}, { deep: true });

function select(sessionId: string): void {
  workspace.select(sessionId);
  isDrawerOpen.value = false;
}

function create(project: string): void {
  workspace.createSession(project);
  isDrawerOpen.value = false;
}
</script>

<template>
  <div class="flex h-dvh min-h-0 bg-surface-base text-ink-gray-8">
    <div class="hidden sm:block">
      <SessionSidebar :projects="workspace.projects" :active-id="workspace.sessionId" :status="workspace.status"
        @select="select" @create="create" />
    </div>
    <div v-if="isDrawerOpen" class="fixed inset-0 z-20 flex sm:hidden">
      <SessionSidebar class="shadow-2xl" :projects="workspace.projects" :active-id="workspace.sessionId"
        :status="workspace.status" @select="select" @create="create" />
      <button class="flex-1 bg-black/30" aria-label="Close sessions" @click="isDrawerOpen = false" />
    </div>
    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 px-4">
        <Button class="sm:hidden" variant="ghost" icon="lucide-menu" aria-label="Open sessions" @click="isDrawerOpen = true" />
        <h1 class="truncate text-base font-medium text-ink-gray-9">
          {{ workspace.activeSession ? getSessionTitle(workspace.activeSession) : "pi remote" }}
        </h1>
        <span v-if="workspace.transcript.is_running" class="ml-auto flex items-center gap-2 text-p-sm text-ink-gray-5">
          <span class="size-2 animate-pulse rounded-full bg-surface-green-7" />Working
        </span>
      </header>
      <section ref="transcriptElement" class="min-h-0 flex-1 overflow-y-auto" aria-label="Conversation" aria-live="polite">
        <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-5 px-4 py-6">
          <div v-if="!workspace.sessionId" class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <span class="lucide-messages-square size-8 text-ink-gray-4" aria-hidden="true" />
            <div class="space-y-1">
              <h2 class="text-xl font-semibold text-ink-gray-9">What are we working on?</h2>
              <p class="text-p-base text-ink-gray-5">Pick a session, or start one in a project.</p>
            </div>
            <div class="flex flex-wrap justify-center gap-2">
              <Button v-for="project in workspace.projects" :key="project.path" variant="subtle" icon-left="lucide-plus"
                :label="getProjectName(project.path)" @click="create(project.path)" />
            </div>
          </div>
          <MessageItem v-for="(message, index) in workspace.transcript.messages" :key="index" :message="message" />
        </div>
      </section>
      <Composer v-if="workspace.sessionId" :disabled="workspace.is_disabled" :is-sending="workspace.isSending"
        :is-running="workspace.transcript.is_running" :error="workspace.error"
        @send="(text) => workspace.sendPrompt(text)" @abort="workspace.abort()" />
    </main>
  </div>
</template>
