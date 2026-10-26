<script setup lang="ts">
import { ref, watch } from "vue";
import { Button, ContextMenu, dialog, Skeleton, toast } from "frappe-ui";
import NewGroupForm from "./NewGroupForm.vue";
import PiLogo from "./PiLogo.vue";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

const props = defineProps<{
  projects: ProjectGroup[];
  isLoading: boolean;
  status: ConnectionStatus;
  canCreateGroups: boolean;
  error: string;
}>();
const emit = defineEmits<{
  select: [sessionId: string];
  create: [project: string];
  createGroup: [name: string];
  removeGroup: [project: string, isDeletingFolder: boolean];
  deleteSessions: [sessionIds: string[]];
  settings: [];
}>();
const isCreatingGroup = ref(false);
const collapsedKey = "pi-remote:collapsed-projects";
const collapsed = ref(new Set<string>(readCollapsed()));
const isRemoving = ref(false);
const selected = ref<Set<string>>();
// A long press opens the menu, and its release would also click the row.
let isMenuOpen = false;

function trackMenu(open: boolean): void {
  isMenuOpen = open;
}

// The menu's own long press waits 700ms and frappe-ui cannot change it, so touch opens it sooner here.
let pressTimer: ReturnType<typeof setTimeout> | undefined;

function startPress(event: PointerEvent, setOpen: (open: boolean) => void): void {
  if (event.pointerType === "touch") pressTimer = setTimeout(() => setOpen(true), 400);
}

function cancelPress(): void {
  clearTimeout(pressTimer);
}

watch(
  () => props.projects,
  () => {
    isRemoving.value = false;
  },
);
watch(
  () => props.error,
  (message) => {
    if (!isRemoving.value || !message) return;
    isRemoving.value = false;
    toast.error(message);
  },
);

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(collapsedKey) ?? "[]");
  } catch {
    return [];
  }
}

function toggle(project: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(project)) next.add(project);
  collapsed.value = next;
  try {
    localStorage.setItem(collapsedKey, JSON.stringify([...next]));
  } catch {
    /* Browser storage is optional. */
  }
}

function confirmRemove(project: string): void {
  const remove =
    (isDeletingFolder: boolean) =>
    ({ close }: { close: () => void }) => {
      isRemoving.value = true;
      emit("removeGroup", project, isDeletingFolder);
      close();
    };
  dialog.danger({
    title: `Delete ${getProjectName(project)}?`,
    message:
      "Remove from list keeps the folder and its sessions on disk. Delete folder also erases the folder and every file in it.",
    actions: [
      { label: "Remove from list", onClick: remove(false) },
      { label: "Delete folder", theme: "red", variant: "solid", onClick: remove(true) },
    ],
  });
}

function getMenuOptions(sessionId: string) {
  return [
    { label: "Select", icon: "lucide-circle-check", onClick: () => toggleSelected(sessionId) },
    { label: "Delete", icon: "lucide-trash-2", theme: "red" as const, onClick: () => confirmDelete([sessionId]) },
  ];
}

function openSession(sessionId: string): void {
  if (isMenuOpen) return;
  if (selected.value) toggleSelected(sessionId);
  else emit("select", sessionId);
}

function toggleSelected(sessionId: string): void {
  const next = new Set(selected.value);
  if (!next.delete(sessionId)) next.add(sessionId);
  selected.value = next;
}

function confirmDelete(sessionIds: string[]): void {
  dialog.danger({
    title: sessionIds.length === 1 ? "Delete this session?" : `Delete ${sessionIds.length} sessions?`,
    message: "This deletes the session files from disk.",
    onConfirm: () => {
      isRemoving.value = true;
      selected.value = undefined;
      emit("deleteSessions", sessionIds);
    },
  });
}

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Reconnecting…",
};
const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="shrink-0 border-b border-outline-gray-1 max-sm:order-2 max-sm:border-b-0 max-sm:border-t">
      <div class="flex h-14 w-full items-center gap-3 px-4 sm:h-11">
        <template v-if="selected">
          <Button variant="ghost" icon="lucide-x" aria-label="Cancel selection" @click="selected = undefined" />
          <p class="min-w-0 flex-1 text-base font-medium text-ink-gray-9">{{ selected.size }} selected</p>
          <Button
            variant="ghost"
            theme="red"
            icon="lucide-trash-2"
            aria-label="Delete selected sessions"
            :disabled="!selected.size"
            @click="confirmDelete([...selected])"
          />
        </template>
        <template v-else>
          <span :class="['size-8 shrink-0', { 'max-sm:hidden': isCreatingGroup }]"><PiLogo /></span>
          <div :class="['min-w-0 flex-1', { 'max-sm:hidden': isCreatingGroup }]">
            <h1 class="text-base font-medium leading-tight text-ink-gray-9">pi remote</h1>
            <p :class="['text-p-xs', status === 'connected' ? 'text-ink-gray-5' : 'text-ink-gray-5']">
              {{ statusLabels[status] }}
            </p>
          </div>
          <NewGroupForm
            v-if="isCreatingGroup"
            class="min-w-0 flex-1 sm:max-w-sm"
            :error="error"
            @submit="(name) => $emit('createGroup', name)"
            @cancel="isCreatingGroup = false"
          />
          <template v-else>
            <Button
              v-if="canCreateGroups"
              variant="ghost"
              icon="lucide-folder-plus"
              aria-label="New project"
              @click="isCreatingGroup = true"
            />
            <Button variant="ghost" icon="lucide-settings" aria-label="Settings" @click="$emit('settings')" />
          </template>
        </template>
      </div>
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto max-sm:order-1" aria-label="Sessions">
      <div
        class="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-4 sm:gap-3 sm:py-3 max-sm:justify-end"
      >
        <section v-for="project in projects" :key="project.path" :aria-label="getProjectName(project.path)">
          <div class="mb-2 flex items-center gap-1">
            <h2 class="min-w-0 flex-1">
              <button
                type="button"
                class="flex max-w-full items-center gap-1 rounded-3 py-1 pr-2 text-left text-p-sm font-medium text-ink-gray-5 hover:text-ink-gray-7"
                :aria-expanded="!collapsed.has(project.path)"
                @click="toggle(project.path)"
              >
                <span
                  :class="[
                    collapsed.has(project.path) ? 'lucide-chevron-right' : 'lucide-chevron-down',
                    'size-4 shrink-0',
                  ]"
                  aria-hidden="true"
                />
                <span class="truncate">{{ getProjectName(project.path) }}</span>
              </button>
            </h2>
            <Button
              variant="ghost"
              icon="lucide-plus"
              aria-label="New session"
              :disabled="!!selected"
              @click="$emit('create', project.path)"
            />
            <Button
              variant="ghost"
              icon="lucide-trash-2"
              :aria-label="`Delete ${getProjectName(project.path)}`"
              :disabled="!!selected"
              @click="confirmRemove(project.path)"
            />
          </div>
          <ul
            v-if="!collapsed.has(project.path)"
            class="divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1"
          >
            <li v-for="session in project.sessions" :key="session.id">
              <ContextMenu v-slot="{ setOpen }" :options="getMenuOptions(session.id)" @update:open="trackMenu">
                <button
                  type="button"
                  class="flex min-h-14 w-full select-none items-center gap-3 px-4 py-2 text-left [-webkit-touch-callout:none] sm:min-h-12 sm:py-2 hover:bg-surface-gray-2 active:bg-surface-gray-3"
                  :aria-pressed="selected ? selected.has(session.id) : undefined"
                  @click="openSession(session.id)"
                  @pointerdown="startPress($event, setOpen)"
                  @pointerup="cancelPress"
                  @pointercancel="cancelPress"
                  @pointerleave="cancelPress"
                >
                  <span
                    v-if="selected"
                    :class="[
                      selected.has(session.id)
                        ? 'lucide-circle-check text-ink-gray-9'
                        : 'lucide-circle text-ink-gray-4',
                      'size-5 shrink-0',
                    ]"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-base text-ink-gray-9">{{ getSessionTitle(session) }}</span>
                    <time class="block text-p-xs text-ink-gray-5">{{ timeFormat.format(session.modified) }}</time>
                  </span>
                  <span
                    v-if="session.isRunning"
                    class="size-2 shrink-0 animate-pulse rounded-full bg-surface-gray-9"
                    role="status"
                    aria-label="Working"
                  />
                  <span
                    v-if="!selected"
                    class="lucide-chevron-right size-5 shrink-0 text-ink-gray-4"
                    aria-hidden="true"
                  />
                </button>
              </ContextMenu>
            </li>
            <li v-if="!project.sessions.length" class="px-4 py-3 text-p-sm text-ink-gray-5">No sessions yet.</li>
          </ul>
        </section>
        <section v-if="isLoading" aria-label="Loading sessions" aria-busy="true">
          <Skeleton class="mb-3 h-4 w-24" />
          <div class="divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1">
            <div v-for="index in 3" :key="index" class="flex min-h-14 flex-col justify-center gap-1.5 px-4 sm:min-h-12">
              <Skeleton class="h-4 w-2/3" />
              <Skeleton class="h-3 w-24" />
            </div>
          </div>
        </section>
        <p v-else-if="!projects.length" class="text-p-base text-ink-gray-5">No projects found.</p>
      </div>
    </main>
  </div>
</template>
