<script setup lang="ts">
import type { WorkspaceMode } from "./workspace-mode";

defineProps<{
  modelValue: WorkspaceMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [mode: WorkspaceMode];
}>();
</script>

<template>
  <fieldset class="workspace-mode-switch" aria-label="Inspector workspace">
    <button
      v-for="mode in (['inspect', 'annotate'] as const)"
      :key="mode"
      class="workspace-mode-button"
      :class="{ 'is-active': modelValue === mode }"
      type="button"
      :aria-pressed="modelValue === mode"
      @click="emit('update:modelValue', mode)"
    >
      {{ mode }}
    </button>
  </fieldset>
</template>
