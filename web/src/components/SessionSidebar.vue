<script setup lang="ts">
import { Sidebar, SidebarHeader, SidebarItem, SidebarSection } from "frappe-ui";
import { getProjectName, getSessionTitle, type ConnectionStatus, type ProjectGroup } from "../protocol.ts";

defineProps<{ projects: ProjectGroup[]; activeId: string; status: ConnectionStatus; isSheet?: boolean; canCreateGroups?: boolean }>();
defineEmits<{ select: [sessionId: string]; create: [project: string]; createGroup: [] }>();

const statusLabels: Record<ConnectionStatus, string> = {
  connecting: "Connecting…", connected: "Connected", disconnected: "Reconnecting…",
};
</script>

<template>
  <Sidebar :collapsible="false" :width="isSheet ? '100%' : '16rem'" aria-label="Sessions"
    :class="isSheet ? '!bg-transparent' : 'border-r border-outline-gray-1'">
    <SidebarHeader v-if="!isSheet" title="pi remote" :subtitle="statusLabels[status]" class="px-2 pt-2 pb-1 h-14">
      <template #prefix>
        <div class="flex size-full items-center justify-center bg-surface-gray-9 text-base font-semibold text-ink-white">π</div>
      </template>
    </SidebarHeader>
    <div :class="['flex-1 space-y-1 overflow-y-auto pt-2', isSheet ? 'px-3 pb-[max(1rem,env(safe-area-inset-bottom))] [&_h3]:h-auto [&_h3]:text-lg [&_h3_button]:py-1' : 'px-1']">
      <SidebarSection v-for="project in projects" :key="project.path" :label="getProjectName(project.path)" collapsible
        class="[&_h3]:font-medium [&_h3]:text-ink-gray-8">
        <SidebarItem v-if="!isSheet" icon="lucide-plus" class="pl-5 text-ink-gray-6" @click="$emit('create', project.path)">
          <span class="text-p-sm">New session</span>
        </SidebarItem>
        <SidebarItem v-for="session in project.sessions" :key="session.id" :active="session.id === activeId"
          :class="isSheet ? 'min-h-12 pl-5' : 'pl-5'" :title="getSessionTitle(session)" @click="$emit('select', session.id)">
          <span :class="['truncate', isSheet ? 'text-lg' : 'text-p-sm']">{{ getSessionTitle(session) }}</span>
          <template v-if="session.isRunning" #suffix>
            <span class="flex size-4 shrink-0 items-center justify-center" role="status" aria-label="Working">
              <span class="size-2 animate-pulse rounded-full bg-surface-green-7" />
            </span>
          </template>
        </SidebarItem>
      </SidebarSection>
      <SidebarItem v-if="canCreateGroups" icon="lucide-folder-plus" :class="['text-ink-gray-6', isSheet ? 'min-h-12 [&_[class*=lucide]]:size-5' : '']" @click="$emit('createGroup')">
        <span :class="isSheet ? 'text-lg' : 'text-p-sm'">New group</span>
      </SidebarItem>
    </div>
  </Sidebar>
</template>
