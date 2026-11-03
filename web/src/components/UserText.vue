<script setup lang="ts">
import { computed } from "vue";
import { parsePrompt } from "../../../server/src/skill-blocks.ts";
import SkillInvocation from "./SkillInvocation.vue";

const props = defineProps<{ text: string }>();
const segments = computed(() => parsePrompt(props.text));
const hasSkill = computed(() => segments.value.some((segment) => !!segment.skill));
</script>

<template>
  <div class="space-y-3 sm:space-y-1.5">
    <template v-for="(segment, index) in segments" :key="index">
      <SkillInvocation v-if="segment.skill" :skill="segment.skill" />
      <p
        v-else-if="segment.text?.trim()"
        class="whitespace-pre-wrap break-words rounded-4 bg-surface-gray-2 px-4 py-3 text-p-base leading-relaxed text-ink-gray-8 sm:px-3 sm:py-2"
      >
        {{ hasSkill ? segment.text.trim() : segment.text }}
      </p>
    </template>
  </div>
</template>
