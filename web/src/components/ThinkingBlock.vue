<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<template>
  <details class="group text-p-sm text-ink-gray-5">
    <summary class="flex cursor-pointer select-none list-none items-center gap-1.5 py-1 sm:py-0 hover:text-ink-gray-7">
      <span
        class="lucide-chevron-right size-4 shrink-0 transition-transform group-open:rotate-90"
        aria-hidden="true"
      />Thinking
    </summary>
    <p class="mt-2 whitespace-pre-wrap break-words border-l-2 border-outline-gray-2 pl-3">{{ text }}</p>
  </details>
</template>
