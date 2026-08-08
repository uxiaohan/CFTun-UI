<script setup lang="ts">
import { onMounted } from "vue";
import AppShell from "./components/AppShell.vue";
import LoginView from "./views/LoginView.vue";
import SetupView from "./views/SetupView.vue";
import { appState } from "./state";

const { state } = appState;
onMounted(() => appState.bootstrap());
</script>

<template>
  <Transition name="app-fade" mode="out-in">
    <main v-if="!state.initialized" key="loading" class="grid min-h-screen place-items-center" role="status" aria-live="polite"><div class="text-center"><span class="spinner mx-auto block text-primary" /><p class="mt-4 text-[13px] text-muted">正在加载 CFTun-UI...</p></div></main>
    <main v-else-if="state.bootstrapError" key="error" class="grid min-h-screen place-items-center px-5"><section class="card max-w-sm p-5 text-center" role="alert"><h1 class="text-lg font-semibold">无法加载控制台</h1><p class="mt-2 text-[13px] text-muted">{{ state.bootstrapError }}</p><button class="btn-primary mt-5" type="button" @click="appState.bootstrap">重试</button></section></main>
    <LoginView v-else-if="!state.authenticated" key="login" />
    <SetupView v-else-if="!state.setupCompleted" key="setup" />
    <AppShell v-else key="shell" />
  </Transition>
  <TransitionGroup tag="section" name="fade" class="fixed right-3 top-3 z-[90] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2" aria-label="通知" aria-live="polite">
    <button v-for="toast in state.toasts" :key="toast.id" class="card flex items-center gap-3 px-3.5 py-3 text-left text-[13px] shadow-xl" type="button" :aria-label="`关闭通知: ${toast.message}`" @click="appState.dismissToast(toast.id)"><span class="grid h-5 w-5 place-items-center rounded-full" :class="toast.kind === 'success' ? 'bg-emerald-500/10 text-emerald-700' : toast.kind === 'error' ? 'bg-red-500/10 text-red-600' : 'bg-primary/10 text-primary'">{{ toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "i" }}</span><span class="flex-1">{{ toast.message }}</span><span class="text-muted" aria-hidden="true">×</span></button>
  </TransitionGroup>
</template>
