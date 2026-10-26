<script setup lang="ts">
import { Button } from "frappe-ui";
import PiLogo from "./PiLogo.vue";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

defineProps<{ projects: ProjectGroup[]; status: ConnectionStatus; canCreateGroups: boolean }>();
defineEmits<{ select: [sessionId: string]; create: [project: string]; createGroup: [] }>();

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…", connected: "Connected", disconnected: "Reconnecting…",
};
const timeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="flex h-14 shrink-0 items-center gap-3 border-b border-outline-gray-1 px-4">
      <span class="size-8 shrink-0"><PiLogo /></span>
      <div class="min-w-0 flex-1">
        <h1 class="text-base font-medium leading-tight text-ink-gray-9">pi remote</h1>
        <p :class="['text-p-xs', status === 'connected' ? 'text-ink-gray-5' : 'text-ink-amber-3']">{{ statusLabels[status] }}</p>
      </div>
      <Button v-if="canCreateGroups" variant="subtle" icon-left="lucide-folder-plus" label="New group" @click="$emit('createGroup')" />
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto" aria-label="Sessions">
      <div class="min-h-full space-y-6 px-4 py-4 max-sm:flex max-sm:flex-col max-sm:justify-end">
        <section v-for="project in projects" :key="project.path" :aria-label="getProjectName(project.path)">
          <div class="mb-2 flex items-center gap-2">
            <h2 class="min-w-0 flex-1 truncate text-p-sm font-medium text-ink-gray-5">{{ getProjectName(project.path) }}</h2>
            <Button variant="ghost" icon-left="lucide-plus" label="New session" @click="$emit('create', project.path)" />
          </div>
          <ul class="divide-y divide-outline-gray-1 overflow-hidden rounded-4 bg-surface-gray-1">
            <li v-for="session in project.sessions" :key="session.id">
              <button type="button" class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-gray-2 active:bg-surface-gray-3"
                @click="$emit('select', session.id)">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-lg text-ink-gray-9 sm:text-base">{{ getSessionTitle(session) }}</span>
                  <time class="block text-p-xs text-ink-gray-5">{{ timeFormat.format(session.modified) }}</time>
                </span>
                <span v-if="session.isRunning" class="size-2 shrink-0 animate-pulse rounded-full bg-surface-green-7" role="status" aria-label="Working" />
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
