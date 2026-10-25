<script setup lang="ts">
import { Sidebar, SidebarHeader, SidebarItem, SidebarSection } from "frappe-ui";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

defineProps<{
  projects: ProjectGroup[]; activeId: string; status: ConnectionStatus; isMobile?: boolean; canCreateGroups?: boolean;
}>();
defineEmits<{ select: [sessionId: string]; create: [project: string]; createGroup: [] }>();

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…", connected: "Connected", disconnected: "Reconnecting…",
};
</script>

<template>
  <Sidebar :collapsible="false" :width="isMobile ? 'min(18rem, 85vw)' : '16rem'" aria-label="Sessions" class="border-r border-outline-gray-1">
    <SidebarHeader title="pi remote" :subtitle="statusLabels[status]" class="px-2 pt-2 pb-1 h-14">
      <template #prefix>
        <div class="flex size-full items-center justify-center bg-surface-gray-9 text-base font-semibold text-ink-white">π</div>
      </template>
    </SidebarHeader>
    <div class="flex-1 overflow-y-auto">
      <div :class="['flex min-h-full flex-col px-1 pb-4', isMobile ? 'justify-end' : '']">
        <SidebarSection v-for="project in projects" :key="project.path" :label="getProjectName(project.path)" collapsible>
          <div class="ml-2 border-l border-outline-gray-2">
            <SidebarItem v-if="!isMobile" label="New session" icon="lucide-plus" @click="$emit('create', project.path)" />
            <SidebarItem v-for="session in project.sessions" :key="session.id" :active="session.id === activeId"
              :class="isMobile ? 'min-h-10' : ''" :label="getSessionTitle(session)" :title="getSessionTitle(session)"
              @click="$emit('select', session.id)">
              <template v-if="session.isRunning" #suffix>
                <span class="flex size-4 shrink-0 items-center justify-center" role="status" aria-label="Working">
                  <span class="size-2 animate-pulse rounded-full bg-surface-green-7" />
                </span>
              </template>
            </SidebarItem>
          </div>
        </SidebarSection>
        <SidebarItem v-if="canCreateGroups" class="mt-2" :class="isMobile ? 'min-h-10' : ''" label="New group"
          icon="lucide-folder-plus" @click="$emit('createGroup')" />
      </div>
    </div>
  </Sidebar>
</template>
