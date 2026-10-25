<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { reactive } from "vue";
import { Button } from "frappe-ui";
import Composer from "./components/Composer.vue";
import NewGroupDialog from "./components/NewGroupDialog.vue";
import MessageItem from "./components/MessageItem.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import { getProjectName, getSessionTitle } from "./protocol.ts";
import { Workspace } from "./workspace.ts";

const workspace = reactive(new Workspace());
const transcriptElement = ref<HTMLElement>();
const isDrawerOpen = ref(false);
const isGroupDialogOpen = ref(false);

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

watch(() => workspace.lastGroup, () => { isGroupDialogOpen.value = false; });

function openGroupDialog(): void {
  workspace.error = "";
  isDrawerOpen.value = false;
  isGroupDialogOpen.value = true;
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
        @select="select" @create="create" @create-group="openGroupDialog" :can-create-groups="!!workspace.groupsRoot" />
    </div>
    <div :class="['fixed inset-0 z-20 flex sm:hidden', isDrawerOpen ? '' : 'pointer-events-none']">
      <Transition enter-active-class="transition-transform duration-300 ease-out" leave-active-class="transition-transform duration-200 ease-in"
        enter-from-class="-translate-x-full" leave-to-class="-translate-x-full">
        <SessionSidebar v-if="isDrawerOpen" is-mobile class="z-10 shadow-2xl" :projects="workspace.projects" :active-id="workspace.sessionId"
          :status="workspace.status" :can-create-groups="!!workspace.groupsRoot"
          @select="select" @create="create" @create-group="openGroupDialog" />
      </Transition>
      <Transition enter-active-class="transition-opacity duration-300" leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0" leave-to-class="opacity-0">
        <button v-if="isDrawerOpen" class="flex-1 bg-black/30" aria-label="Close sessions" @click="isDrawerOpen = false" />
      </Transition>
    </div>
    <NewGroupDialog v-model:open="isGroupDialogOpen" :root="workspace.groupsRoot" :error="workspace.error"
      @submit="(name) => workspace.createGroup(name)" />
    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="hidden h-12 shrink-0 items-center gap-2 border-b border-outline-gray-1 px-4 sm:flex">
        <h1 class="truncate text-base font-medium text-ink-gray-9">
          {{ workspace.activeSession ? getSessionTitle(workspace.activeSession) : "pi remote" }}
        </h1>
        <span v-if="workspace.transcript.is_running" class="ml-auto flex items-center gap-2 text-p-sm text-ink-gray-5">
          <span class="size-2 animate-pulse rounded-full bg-surface-green-7" />Working
        </span>
      </header>

      <section ref="transcriptElement" class="min-h-0 flex-1 overflow-y-auto" aria-label="Conversation" aria-live="polite">
        <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 py-6">
          <div v-if="!workspace.sessionId" class="flex flex-1 flex-col items-center justify-end gap-4 pb-8 text-center sm:justify-center sm:pb-0">
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
          <MessageItem v-for="(message, index) in workspace.transcript.messages" :key="index" :message="message"
            :is-group-start="workspace.transcript.isGroupStart(index)" />
        </div>
      </section>
      <div class="flex shrink-0 items-center gap-1 border-t border-outline-gray-1 px-2 py-1 sm:hidden">
        <button type="button" class="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-4 px-3 text-left hover:bg-surface-gray-2 active:bg-surface-gray-3"
          aria-label="Open sessions" @click="isDrawerOpen = true">
          <span class="lucide-menu size-5 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <span :class="['truncate text-lg font-medium', workspace.status === 'connected' ? 'text-ink-gray-9' : 'text-ink-amber-3']">
            {{ workspace.status === "connected" ? (workspace.activeSession ? getSessionTitle(workspace.activeSession) : "Sessions") : "Reconnecting…" }}
          </span>
          <span v-if="workspace.transcript.is_running" class="size-2 shrink-0 animate-pulse rounded-full bg-surface-green-7" role="status" aria-label="Working" />
        </button>
        <Button variant="ghost" size="lg" icon="lucide-plus" aria-label="New session"
          :disabled="!workspace.activeProjectPath" @click="create(workspace.activeProjectPath!)" />
      </div>
      <Composer v-if="workspace.sessionId" :disabled="workspace.is_disabled" :is-sending="workspace.isSending"
        :is-running="workspace.transcript.is_running" :error="workspace.error"
        @send="(text) => workspace.sendPrompt(text)" @abort="workspace.abort()" />
    </main>
  </div>
</template>
