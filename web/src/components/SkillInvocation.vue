<script setup lang="ts">
import { renderMarkdown } from "../markdown.ts";
import type { SkillBlock } from "../skill-block.ts";

const props = defineProps<{ skill: SkillBlock }>();
</script>

<template>
  <details class="group text-p-sm text-ink-gray-5">
    <summary class="flex cursor-pointer select-none list-none items-center gap-1.5 py-1 sm:py-0 hover:text-ink-gray-7">
      <span class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
      <span class="lucide-book-open size-4 shrink-0" aria-hidden="true" />
      <span>Skill</span>
      <span class="font-medium text-ink-gray-7">{{ props.skill.name }}</span>
    </summary>
    <div class="markdown mt-2 border-l-2 border-outline-gray-2 pl-3" v-html="renderMarkdown(props.skill.content)" />
  </details>
</template>
