<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { reactive } from "vue";
import { Button } from "frappe-ui";
import Composer from "./components/Composer.vue";
import NewGroupDialog from "./components/NewGroupDialog.vue";
import MessageItem from "./components/MessageItem.vue";
import SessionSettingsMenu from "./components/SessionSettingsMenu.vue";
import SessionList from "./components/SessionList.vue";
import { getSessionTitle } from "./protocol.ts";
import { Workspace } from "./workspace.ts";

const workspace = reactive(new Workspace());
const transcriptElement = ref<HTMLElement>();
const isGroupDialogOpen = ref(false);

onMounted(() => workspace.start());

watch(() => workspace.transcript.messages, async () => {
  await nextTick();
  const element = transcriptElement.value;
  if (element) element.scrollTop = element.scrollHeight;
}, { deep: true });

watch(() => workspace.lastGroup, () => { isGroupDialogOpen.value = false; });

function openGroupDialog(): void {
  workspace.error = "";
  isGroupDialogOpen.value = true;
}

</script>

<template>
  <div class="flex h-dvh min-h-0 flex-col bg-surface-base text-ink-gray-8">
    <NewGroupDialog v-model:open="isGroupDialogOpen" :root="workspace.groupsRoot" :error="workspace.error"
      @submit="(name) => workspace.createGroup(name)" />
    <SessionList v-if="!workspace.sessionId" :projects="workspace.projects" :status="workspace.status"
      :can-create-groups="!!workspace.groupsRoot" @select="(id) => workspace.select(id)"
      @create="(project) => workspace.createSession(project)" @create-group="openGroupDialog" />
    <template v-else>
      <header class="shrink-0 border-b border-outline-gray-1 max-sm:order-2 max-sm:border-b-0 max-sm:border-t">
        <div class="mx-auto flex h-14 w-full max-w-2xl items-center gap-1 px-2">
        <Button variant="ghost" size="lg" icon="lucide-arrow-left" aria-label="All sessions" @click="workspace.select('')" />
        <h1 :class="['min-w-0 flex-1 truncate text-base font-medium', workspace.status === 'connected' ? 'text-ink-gray-9' : 'text-ink-amber-3']">
          {{ workspace.status === "connected" ? (workspace.activeSession ? getSessionTitle(workspace.activeSession) : "Session") : "Reconnecting…" }}
        </h1>
        <span v-if="workspace.transcript.is_running" class="size-2 shrink-0 animate-pulse rounded-full bg-surface-green-7" role="status" aria-label="Working" />
        <SessionSettingsMenu v-if="workspace.settings" class="sm:hidden" :settings="workspace.settings" :is-running="workspace.transcript.is_running"
          :disabled="workspace.is_disabled || workspace.isUpdatingSettings"
          @model="(value) => workspace.setModel(value)" @thinking="(level) => workspace.setThinkingLevel(level)" />
        <Button variant="ghost" size="lg" icon="lucide-plus" aria-label="New session"
          :disabled="!workspace.activeProjectPath" @click="workspace.createSession(workspace.activeProjectPath!)" />
        </div>
      </header>
      <section ref="transcriptElement" class="min-h-0 flex-1 overflow-y-auto max-sm:order-1" aria-label="Conversation" aria-live="polite">
        <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 py-6">
          <MessageItem v-for="(message, index) in workspace.transcript.messages" :key="index" :message="message"
            :is-group-start="workspace.transcript.isGroupStart(index)" :tools="workspace.transcript.tools" />
        </div>
      </section>
      <Composer :key="workspace.sessionId" class="max-sm:order-3" :disabled="workspace.is_disabled" :is-sending="workspace.isSending"
        :is-running="workspace.transcript.is_running" :error="workspace.error" :queue="workspace.transcript.queue"
        @send="(text, mode) => workspace.sendPrompt(text, mode)" @abort="workspace.abort()">
        <template #settings>
          <SessionSettingsMenu v-if="workspace.settings" :settings="workspace.settings" :is-running="workspace.transcript.is_running"
            :disabled="workspace.is_disabled || workspace.isUpdatingSettings"
            @model="(value) => workspace.setModel(value)" @thinking="(level) => workspace.setThinkingLevel(level)" />
        </template>
      </Composer>
    </template>
  </div>
</template>
