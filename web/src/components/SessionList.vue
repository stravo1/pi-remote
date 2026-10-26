<script setup lang="ts">
import { ref, watch } from "vue";
import { Button, dialog, toast } from "frappe-ui";
import NewGroupForm from "./NewGroupForm.vue";
import PiLogo from "./PiLogo.vue";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

const props = defineProps<{ projects: ProjectGroup[]; status: ConnectionStatus; canCreateGroups: boolean; error: string }>();
const emit = defineEmits<{ select: [sessionId: string]; create: [project: string]; createGroup: [name: string]; removeGroup: [project: string]; settings: [] }>();
const isCreatingGroup = ref(false);
const collapsedKey = "pi-remote:collapsed-projects";
const collapsed = ref(new Set<string>(readCollapsed()));
const isRemoving = ref(false);

watch(() => props.projects, () => { isRemoving.value = false; });
watch(() => props.error, (message) => {
  if (!isRemoving.value || !message) return;
  isRemoving.value = false;
  toast.error(message);
});

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
  try { localStorage.setItem(collapsedKey, JSON.stringify([...next])); } catch { /* Browser storage is optional. */ }
}

function confirmRemove(project: string): void {
  dialog.danger({
    title: `Delete ${getProjectName(project)}?`,
    message: "This removes the project from pi remote. The folder and its sessions stay on disk.",
    onConfirm: () => {
      isRemoving.value = true;
      emit("removeGroup", project);
    },
  });
}

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…", connected: "Connected", disconnected: "Reconnecting…",
};
const timeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="shrink-0 border-b border-outline-gray-1 max-sm:order-2 max-sm:border-b-0 max-sm:border-t">
      <div class="flex h-14 w-full items-center gap-3 px-4 sm:h-11">
      <span :class="['size-8 shrink-0', { 'max-sm:hidden': isCreatingGroup }]"><PiLogo /></span>
      <div :class="['min-w-0 flex-1', { 'max-sm:hidden': isCreatingGroup }]">
        <h1 class="text-base font-medium leading-tight text-ink-gray-9">pi remote</h1>
        <p :class="['text-p-xs', status === 'connected' ? 'text-ink-gray-5' : 'text-ink-gray-5']">{{ statusLabels[status] }}</p>
      </div>
      <NewGroupForm v-if="isCreatingGroup" class="min-w-0 flex-1 sm:max-w-sm" :error="error" @submit="(name) => $emit('createGroup', name)" @cancel="isCreatingGroup = false" />
      <template v-else>
      <Button v-if="canCreateGroups" variant="ghost" icon="lucide-folder-plus" aria-label="New project" @click="isCreatingGroup = true" />
      <Button variant="ghost" icon="lucide-settings" aria-label="Settings" @click="$emit('settings')" />
      </template>
      </div>
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto max-sm:order-1" aria-label="Sessions">
      <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-4 sm:gap-3 sm:py-3 max-sm:justify-end">
        <section v-for="project in projects" :key="project.path" :aria-label="getProjectName(project.path)">
          <div class="mb-2 flex items-center gap-1">
            <h2 class="min-w-0 flex-1">
              <button type="button" class="flex max-w-full items-center gap-1 rounded-3 py-1 pr-2 text-left text-p-sm font-medium text-ink-gray-5 hover:text-ink-gray-7"
                :aria-expanded="!collapsed.has(project.path)" @click="toggle(project.path)">
                <span :class="[collapsed.has(project.path) ? 'lucide-chevron-right' : 'lucide-chevron-down', 'size-4 shrink-0']" aria-hidden="true" />
                <span class="truncate">{{ getProjectName(project.path) }}</span>
              </button>
            </h2>
            <Button variant="ghost" icon-left="lucide-plus" label="New session" @click="$emit('create', project.path)" />
            <Button variant="ghost" icon="lucide-trash-2" :aria-label="`Delete ${getProjectName(project.path)}`" @click="confirmRemove(project.path)" />
          </div>
          <ul v-if="!collapsed.has(project.path)" class="divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1">
            <li v-for="session in project.sessions" :key="session.id">
              <button type="button" class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left sm:min-h-12 sm:py-2 hover:bg-surface-gray-2 active:bg-surface-gray-3"
                @click="$emit('select', session.id)">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-base text-ink-gray-9">{{ getSessionTitle(session) }}</span>
                  <time class="block text-p-xs text-ink-gray-5">{{ timeFormat.format(session.modified) }}</time>
                </span>
                <span v-if="session.isRunning" class="size-2 shrink-0 animate-pulse rounded-full bg-surface-gray-9" role="status" aria-label="Working" />
                <span class="lucide-chevron-right size-5 shrink-0 text-ink-gray-4" aria-hidden="true" />
              </button>
            </li>
            <li v-if="!project.sessions.length" class="px-4 py-3 text-p-sm text-ink-gray-5">No sessions yet.</li>
          </ul>
        </section>
        <p v-if="!projects.length" class="text-p-base text-ink-gray-5">No projects found.</p>
      </div>
    </main>
  </div>
</template>
