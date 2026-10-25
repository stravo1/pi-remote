<script setup lang="ts">
import { Sidebar, SidebarHeader, SidebarItem, SidebarSection } from "frappe-ui";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

defineProps<{ projects: ProjectGroup[]; activeId: string; status: ConnectionStatus }>();
defineEmits<{ select: [sessionId: string]; create: [project: string] }>();

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…", connected: "Connected", disconnected: "Reconnecting…",
};
</script>

<template>
  <Sidebar :collapsible="false" width="16rem" aria-label="Sessions" class="border-r border-outline-gray-1">
    <SidebarHeader title="pi remote" :subtitle="statusLabels[status]" class="px-2 pt-2 pb-1 h-14">
      <template #prefix>
        <div class="flex size-full items-center justify-center bg-surface-gray-9 text-base font-semibold text-ink-white">π</div>
      </template>
    </SidebarHeader>
    <div class="flex-1 space-y-1 overflow-y-auto px-1 pt-2 pb-4">
      <SidebarSection v-for="project in projects" :key="project.path" :label="getProjectName(project.path)" collapsible>
        <SidebarItem label="New session" icon="lucide-plus" class="text-ink-gray-6" @click="$emit('create', project.path)" />
        <SidebarItem v-for="session in project.sessions" :key="session.id" :active="session.id === activeId"
          :title="getSessionTitle(session)" @click="$emit('select', session.id)">
          <span class="truncate text-p-sm">{{ getSessionTitle(session) }}</span>
          <template #prefix>
            <span v-if="session.isRunning" class="flex size-4 shrink-0 items-center justify-center" role="status" aria-label="Working">
              <span class="size-2 animate-pulse rounded-full bg-surface-green-7" />
            </span>
            <span v-else class="lucide-message-square size-4 shrink-0 text-ink-gray-5" aria-hidden="true" />
          </template>
        </SidebarItem>
      </SidebarSection>
    </div>
  </Sidebar>
</template>
