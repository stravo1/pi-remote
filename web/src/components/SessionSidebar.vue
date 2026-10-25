<script setup lang="ts">
import PiLogo from "./PiLogo.vue";
import { Sidebar, SidebarHeader, SidebarItem, SidebarSection } from "frappe-ui";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

defineProps<{
  projects: ProjectGroup[]; activeId: string; status: ConnectionStatus; isMobile?: boolean; canCreateGroups?: boolean;
}>();
defineEmits<{ select: [sessionId: string]; create: [project: string]; createGroup: [] }>();

const activeRow = "relative data-[state=active]:!bg-transparent data-[state=active]:!shadow-none data-[state=active]:font-medium data-[state=active]:text-ink-gray-9 before:absolute before:-left-[2px] before:inset-y-1.5 before:w-[3px] before:rounded-full before:bg-surface-gray-9 before:opacity-0 data-[state=active]:before:opacity-100";

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…", connected: "Connected", disconnected: "Reconnecting…",
};
</script>

<template>
  <Sidebar :collapsible="false" :width="isMobile ? 'min(18rem, 85vw)' : '16rem'" aria-label="Sessions" class="border-r border-outline-gray-1">
    <SidebarHeader title="pi remote" :subtitle="statusLabels[status]" class="px-2 pt-2 pb-1 h-14">
      <template #prefix><PiLogo /></template>
    </SidebarHeader>
    <div class="flex-1 overflow-y-auto">
      <div :class="['flex min-h-full flex-col px-1 pb-4', isMobile ? 'justify-end' : '']">
        <SidebarSection v-for="project in projects" :key="project.path" :label="getProjectName(project.path)" collapsible
          :class="[project.sessions.some((session) => session.id === activeId) ? '[&_h3]:text-ink-gray-8' : '', isMobile ? '[&_h3]:text-base' : '']">
          <div class="ml-2 border-l border-outline-gray-2">
            <SidebarItem v-if="!isMobile" label="New session" icon="lucide-plus" @click="$emit('create', project.path)" />
            <SidebarItem v-for="session in project.sessions" :key="session.id" :active="session.id === activeId"
              :class="[activeRow, isMobile ? 'min-h-11' : '']" :title="getSessionTitle(session)"
              @click="$emit('select', session.id)">
              <span :class="['truncate', isMobile ? 'text-lg' : '']">{{ getSessionTitle(session) }}</span>
              <template v-if="session.isRunning" #suffix>
                <span class="flex size-4 shrink-0 items-center justify-center" role="status" aria-label="Working">
                  <span class="size-2 animate-pulse rounded-full bg-surface-green-7" />
                </span>
              </template>
            </SidebarItem>
          </div>
        </SidebarSection>
        <SidebarItem v-if="canCreateGroups" class="mt-2" :class="isMobile ? 'min-h-11' : ''" icon="lucide-folder-plus"
          @click="$emit('createGroup')">
          <span :class="isMobile ? 'text-lg' : ''">New group</span>
        </SidebarItem>
      </div>
    </div>
  </Sidebar>
</template>
