<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { reactive } from "vue";
import { Button, Dialogs, Spinner, ToastProvider, useColorScheme } from "frappe-ui";
import Composer from "./components/Composer.vue";
import MessageItem from "./components/MessageItem.vue";
import SessionActions from "./components/SessionActions.vue";
import SessionSettingsMenu from "./components/SessionSettingsMenu.vue";
import SessionList from "./components/SessionList.vue";
import NotificationSettings from "./components/NotificationSettings.vue";
import ProviderSettings from "./components/ProviderSettings.vue";
import { buttonSize } from "./button-size.ts";
import { getSessionTitle } from "./protocol.ts";
import { ownCommands } from "./slash-commands.ts";
import { Workspace } from "./workspace.ts";

const workspace = reactive(new Workspace());
const transcriptElement = ref<HTMLElement>();
// Restores the saved light, dark, or system scheme and follows the OS setting.
useColorScheme();
const toastPosition = window.matchMedia("(min-width: 640px)").matches ? "bottom-right" : "top-center";
// New content scrolls the transcript only while the reader is at the bottom.
let isFollowing = true;
const isProviderSettingsOpen = ref(location.hash === "#settings");

onMounted(() => {
  workspace.start();
  window.addEventListener("hashchange", () => {
    isProviderSettingsOpen.value = location.hash === "#settings";
    if (isProviderSettingsOpen.value) openSettings();
  });
  if (isProviderSettingsOpen.value) openSettings();
  // A tap on a notification asks an open window to show its session.
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "open_session") location.hash = event.data.sessionId;
  });
});

function openSettings(): void {
  workspace.listProviders();
  workspace.loadPush();
}

watch(
  () => workspace.transcript.messages,
  async () => {
    if (!isFollowing) return;
    await nextTick();
    const element = transcriptElement.value;
    if (element) element.scrollTop = element.scrollHeight;
  },
  { deep: true },
);
watch(
  () => workspace.sessionId,
  () => {
    isFollowing = true;
  },
);

function trackScroll(): void {
  const element = transcriptElement.value;
  if (element) isFollowing = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
}

watch(
  () => workspace.status,
  (status) => {
    if (status === "connected" && isProviderSettingsOpen.value) openSettings();
  },
);

function openProviderSettings(): void {
  location.hash = "settings";
}

function closeProviderSettings(): void {
  location.hash = "";
}
</script>

<template>
  <!-- Safe-area padding keeps the bottom bar clear of the home indicator in the installed app. -->
  <div
    class="flex h-dvh min-h-0 flex-col bg-surface-base pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-ink-gray-8"
  >
    <!-- On phones the header sits at the bottom, so toasts move to the top. -->
    <ToastProvider :position="toastPosition" />
    <Dialogs />
    <ProviderSettings
      v-if="isProviderSettingsOpen"
      :providers="workspace.providers"
      :login="workspace.providerLogin"
      :error="workspace.error"
      :provider-key="workspace.providerKey"
      @back="closeProviderSettings"
      @save-key="(provider, key) => workspace.setProviderKey(provider, key)"
      @load-key="(provider) => workspace.getProviderKey(provider)"
      @logout="(provider) => workspace.logoutProvider(provider)"
      @login="(provider, type) => workspace.startProviderLogin(provider, type)"
      @answer="(value) => workspace.submitProviderLogin(value)"
      @cancel="() => workspace.cancelProviderLogin()"
    >
      <NotificationSettings
        :public-key="workspace.pushKey"
        :is-supported="workspace.devicePush.is_supported"
        :permission="workspace.devicePush.permission"
        :is-on="workspace.isPushOn"
        :is-updating="workspace.isUpdatingPush"
        @enable="workspace.enablePush()"
        @disable="workspace.disablePush()"
        @test="workspace.testPush()"
      />
    </ProviderSettings>
    <SessionList
      v-else-if="!workspace.sessionId"
      :projects="workspace.projects"
      :is-loading="!workspace.hasSessionList"
      :status="workspace.status"
      :can-create-groups="!!workspace.groupsRoot"
      :error="workspace.error"
      @select="(id) => workspace.select(id)"
      @create="(project) => workspace.createSession(project)"
      @create-group="(name) => workspace.createGroup(name)"
      @remove-group="(project, isDeletingFolder) => workspace.removeGroup(project, isDeletingFolder)"
      @delete-sessions="(sessionIds) => workspace.deleteSessions(sessionIds)"
      @settings="openProviderSettings"
    />
    <template v-else>
      <header class="shrink-0 border-b border-outline-gray-1 max-sm:order-2 max-sm:border-b-0 max-sm:border-t">
        <div class="flex h-14 w-full items-center gap-1 px-2 sm:h-11">
          <Button
            variant="ghost"
            :size="buttonSize"
            icon="lucide-arrow-left"
            aria-label="All sessions"
            @click="workspace.select('')"
          />
          <h1
            :class="[
              'min-w-0 flex-1 truncate text-base font-medium',
              workspace.status === 'connected' ? 'text-ink-gray-9' : 'text-ink-gray-5',
            ]"
          >
            {{
              workspace.status === "connected"
                ? workspace.activeSession
                  ? getSessionTitle(workspace.activeSession)
                  : "Session"
                : "Reconnecting…"
            }}
          </h1>
          <span
            v-if="workspace.transcript.is_running"
            class="size-2 shrink-0 animate-pulse rounded-full bg-surface-gray-9"
            role="status"
            aria-label="Working"
          />
          <SessionSettingsMenu
            v-if="workspace.settings"
            :settings="workspace.settings"
            :is-running="workspace.transcript.is_running"
            :disabled="workspace.is_disabled || workspace.isUpdatingSettings"
            @model="(value) => workspace.setModel(value)"
            @thinking="(level) => workspace.setThinkingLevel(level)"
          />
          <SessionActions
            :title="workspace.activeSession ? getSessionTitle(workspace.activeSession) : ''"
            :disabled="workspace.is_disabled"
            :is-running="workspace.transcript.is_running"
            @rename="(name) => workspace.renameSession(name)"
            @compact="(instructions) => workspace.compact(instructions)"
            @show-info="workspace.showSessionInfo()"
          />
          <Button
            variant="ghost"
            :size="buttonSize"
            icon="lucide-plus"
            aria-label="New session"
            :disabled="!workspace.activeProjectPath"
            @click="workspace.createSession(workspace.activeProjectPath!)"
          />
        </div>
      </header>
      <section
        ref="transcriptElement"
        class="min-h-0 flex-1 overflow-y-auto max-sm:order-1"
        @scroll.passive="trackScroll"
        aria-label="Conversation"
        aria-live="polite"
      >
        <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 py-6 sm:py-3">
          <Spinner
            v-if="workspace.isSyncing && !workspace.transcript.messages.length"
            class="m-auto size-5 text-ink-gray-5"
            aria-label="Loading session"
          />
          <MessageItem
            v-for="(message, index) in workspace.transcript.messages"
            :key="index"
            :message="message"
            :is-group-start="workspace.transcript.isGroupStart(index)"
            :tools="workspace.transcript.tools"
          />
          <p
            v-if="workspace.transcript.is_compacting"
            class="mt-3 flex items-center gap-2 text-p-sm text-ink-gray-5"
            role="status"
          >
            <Spinner class="size-4" />Compacting context…
          </p>
        </div>
      </section>
      <Composer
        :key="workspace.sessionId"
        class="max-sm:order-3"
        :disabled="workspace.is_disabled"
        :is-sending="workspace.isSending"
        :is-running="workspace.transcript.is_running"
        :error="workspace.error"
        :queue="workspace.transcript.queue"
        :commands="[...ownCommands, ...(workspace.settings?.commands ?? [])]"
        @send="(text) => workspace.sendPrompt(text)"
        @steer="(text) => workspace.steerFollowUp(text)"
        @abort="workspace.abort()"
      />
    </template>
  </div>
</template>
