<script setup lang="ts">
import { ref } from "vue";
import AnnotateWorkspace from "./AnnotateWorkspace.vue";
import InspectWorkspace from "./InspectWorkspace.vue";
import type { WorkspaceMode } from "./workspace-mode";

const mode = ref<WorkspaceMode>("annotate");
</script>

<template>
  <InspectWorkspace v-if="mode === 'inspect'" @change-mode="mode = $event" />
  <AnnotateWorkspace v-else @change-mode="mode = $event" />
</template>
