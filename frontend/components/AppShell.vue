<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { useAppState } from "../state";
import { useScrollLock } from "../composables/useScrollLock";
import StatusBadge from "./StatusBadge.vue";

const { state, logout } = useAppState();
const route = useRoute();
const drawer = ref(false);
const setLocked = useScrollLock();
const nav = [
  { to: "/", label: "概览", icon: "◇" },
  { to: "/mappings", label: "映射", icon: "⇄" },
  { to: "/connector", label: "Connector", icon: "⌁" },
  { to: "/settings", label: "设置", icon: "⚙" },
  { to: "/about", label: "关于", icon: "i" },
] as const;
const title = computed(() => nav.find((item) => item.to === route.path)?.label || "控制台");
const username = computed(() => state.username || "管理员");

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && drawer.value) drawer.value = false;
}
onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

watch(() => route.path, () => { drawer.value = false; });
watch(drawer, (open) => setLocked(open));
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <a href="#main-content" class="fixed left-3 top-3 z-[90] -translate-y-20 rounded-md bg-primary px-3 py-2 text-xs text-white focus:translate-y-0">跳到主要内容</a>
    <header class="fixed inset-x-0 top-0 z-30 flex h-14 items-center border-b border-black/[.08] bg-canvas/90 px-4 backdrop-blur-xl lg:left-60">
      <button class="icon-btn mr-2 lg:hidden" type="button" aria-label="打开导航菜单" :aria-expanded="drawer" @click="drawer = true">☰</button>
      <div><p class="text-[13px] font-medium">{{ title }}</p><p class="mt-0.5 hidden text-[10px] text-muted sm:block">CFTun-UI / {{ title }}</p></div>
      <StatusBadge v-if="state.connector" class="ml-auto" :status="state.connector.state" :label="`Connector ${state.connector.state}`" />
    </header>
    <Transition name="fade"><div v-if="drawer" class="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm lg:hidden" aria-hidden="true" @click="drawer = false" /></Transition>
    <aside class="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-black/[.08] bg-white transition-transform duration-300 lg:translate-x-0" :class="drawer ? 'translate-x-0' : '-translate-x-full'" aria-label="主导航">
      <div class="flex h-14 items-center gap-2.5 border-b border-black/[.08] px-4">
        <RouterLink to="/" class="flex items-center gap-2.5"><span class="grid h-7 w-7 place-items-center rounded-md bg-primary text-[11px] font-semibold text-white">CF</span><span><strong class="block text-[13px]">CFTun-UI</strong><small class="block text-[9px] text-muted">TUNNEL CONSOLE</small></span></RouterLink>
        <button class="icon-btn ml-auto lg:hidden" type="button" aria-label="关闭导航菜单" @click="drawer = false">×</button>
      </div>
      <nav class="flex-1 space-y-1 p-3">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to" class="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] font-medium text-muted transition hover:bg-black/[.04] hover:text-[#1c1f23]" :class="route.path === item.to ? 'bg-black/[.055] !text-[#1c1f23]' : ''" :aria-current="route.path === item.to ? 'page' : undefined"><span class="w-4 text-center" aria-hidden="true">{{ item.icon }}</span>{{ item.label }}</RouterLink>
      </nav>
      <div class="border-t border-black/[.08] p-3">
        <div class="mb-2 flex items-center gap-2.5 px-3"><span class="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{{ username.slice(0, 2).toUpperCase() }}</span><div class="min-w-0"><strong class="block truncate text-[11px]">{{ username }}</strong><span class="text-[9px] text-muted">本地管理员</span></div></div>
        <button class="flex h-9 w-full items-center rounded-md px-3 text-xs text-muted hover:bg-black/[.04]" type="button" @click="logout">退出登录</button>
      </div>
    </aside>
    <main id="main-content" class="min-h-screen pt-14 lg:pl-60" tabindex="-1"><div class="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"><RouterView /></div></main>
  </div>
</template>
