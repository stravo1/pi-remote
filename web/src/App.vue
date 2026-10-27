<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { Button, Dialogs, Spinner, ToastProvider, toast, useColorScheme } from "frappe-ui";
import Composer from "./components/Composer.vue";
import MessageItem from "./components/MessageItem.vue";
import SessionSettingsMenu from "./components/SessionSettingsMenu.vue";
import SessionList from "./components/SessionList.vue";
import NotificationSettings from "./components/NotificationSettings.vue";
import ProviderSettings from "./components/ProviderSettings.vue";
import { buttonSize } from "./button-size.ts";
import { getSessionTitle } from "./protocol.ts";
import { ownCommands } from "./slash-commands.ts";
import { Workspace } from "./workspace.ts";
import { applyBrowserTheme } from "./browser-theme.ts";

const workspace = reactive(new Workspace());
const transcriptElement = ref<HTMLElement>();
// Restores the saved light, dark, or system scheme and follows the OS setting.
const { resolvedColorScheme } = useColorScheme();
// Keep the installed app's status bar color and text in step with the scheme.
watch(resolvedColorScheme, applyBrowserTheme, { immediate: true });
watch(
  () => workspace.runErrorToast,
  (notification) => {
    if (notification) toast.error(notification.message);
  },
);
const toastPosition = window.matchMedia("(min-width: 640px)").matches ? "bottom-right" : "top-center";
// New content scrolls the transcript only while the reader is at the bottom.
let isFollowing = true;
// Shows the scroll button while the transcript is scrolled away from the bottom.
const isScrolledUp = ref(false);
const isProviderSettingsOpen = ref(location.hash === "#settings");
// Long sessions render their last messages first and add earlier ones as the reader scrolls up.
const renderBatch = 60;
const renderedCount = ref(renderBatch);
const firstRendered = computed(() => Math.max(0, workspace.transcript.messages.length - renderedCount.value));

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
  workspace.loadDefaultModel();
  workspace.loadPush();
}

watch(
  () => workspace.transcript.messages,
  async () => {
    if (!isFollowing) return;
    await nextTick();
    const element = transcriptElement.value;
    if (element) element.scrollTop = element.scrollHeight;
    trackScroll();
  },
  { deep: true },
);

async function scrollToBottom(): Promise<void> {
  isFollowing = true;
  await nextTick();
  const element = transcriptElement.value;
  if (element) element.scrollTop = element.scrollHeight;
  trackScroll();
}
watch(
  () => workspace.sessionId,
  () => {
    isFollowing = true;
    renderedCount.value = renderBatch;
  },
);

function trackScroll(): void {
  const element = transcriptElement.value;
  if (!element) return;
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  isFollowing = distance < 32;
  isScrolledUp.value = distance >= 32;
  if (element.scrollTop < element.clientHeight && firstRendered.value > 0) renderEarlier(element);
}

// Keeps the visible messages in place while earlier ones render above them.
async function renderEarlier(element: HTMLElement): Promise<void> {
  const height = element.scrollHeight;
  renderedCount.value += renderBatch;
  await nextTick();
  element.scrollTop += element.scrollHeight - height;
  trackScroll();
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
      :default-model="workspace.defaultModel"
      @back="closeProviderSettings"
      @save-key="(provider, key) => workspace.setProviderKey(provider, key)"
      @load-key="(provider) => workspace.getProviderKey(provider)"
      @logout="(provider) => workspace.logoutProvider(provider)"
      @set-default-model="(value) => workspace.setDefaultModel(value)"
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
      <div class="relative min-h-0 flex-1 max-sm:order-1">
        <section
          ref="transcriptElement"
          class="min-h-0 h-full overflow-y-auto [overflow-anchor:none]"
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
              v-for="(message, index) in workspace.transcript.messages.slice(firstRendered)"
              :key="firstRendered + index"
              :message="message"
              :is-group-start="workspace.transcript.isGroupStart(firstRendered + index)"
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
        <Transition
          enter-active-class="transition duration-150 ease-out"
          enter-from-class="opacity-0 translate-y-1"
          leave-active-class="transition duration-100 ease-in"
          leave-to-class="opacity-0 translate-y-1"
        >
          <Button
            v-if="isScrolledUp"
            class="absolute bottom-2 left-1/2 -translate-x-1/2 !rounded-full border border-outline-gray-1 !bg-surface-gray-2 hover:!bg-surface-gray-3 text-ink-gray-7 shadow-sm"
            variant="ghost"
            :size="buttonSize"
            icon="lucide-arrow-down"
            aria-label="Scroll to bottom"
            @click="scrollToBottom"
          />
        </Transition>
      </div>
      <Composer
        :key="workspace.sessionId"
        class="max-sm:order-3"
        :disabled="workspace.is_disabled"
        :is-sending="workspace.isSending"
        :is-running="workspace.transcript.is_running"
        :can-send-images="workspace.canSendImages"
        :error="workspace.error"
        :queue="workspace.transcript.queue"
        :commands="[...ownCommands, ...(workspace.settings?.commands ?? [])]"
        :send="(text, images) => workspace.sendPrompt(text, images)"
        @steer="(text) => workspace.steerFollowUp(text)"
        @abort="workspace.abort()"
      />
    </template>
  </div>
</template>
