<script setup lang="ts">
import { computed } from "vue";
import { parseSkillBlock } from "../skill-block.ts";
import SkillInvocation from "./SkillInvocation.vue";

const props = defineProps<{ text: string }>();
const skill = computed(() => parseSkillBlock(props.text));
</script>

<template>
  <div class="space-y-3 sm:space-y-1.5">
    <SkillInvocation v-if="skill" :skill="skill" />
    <p
      v-if="!skill || skill.userMessage"
      class="whitespace-pre-wrap break-words rounded-4 bg-surface-gray-2 px-4 py-3 text-p-base leading-relaxed text-ink-gray-8 sm:px-3 sm:py-2"
    >
      {{ skill?.userMessage ?? text }}
    </p>
  </div>
</template>
