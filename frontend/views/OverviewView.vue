<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { apiClient } from "../api";
import { messageFor, useAppState } from "../state";
import type { Mapping, Operation } from "../types";
import StatusBadge from "../components/StatusBadge.vue";

const { state, notify } = useAppState();
const loading = ref(true);
const mappings = ref<Mapping[]>([]);
const operations = ref<Operation[]>([]);
const enabledCount = computed(() => mappings.value.filter((item) => item.enabled).length);
const zoneCount = computed(() => new Set(mappings.value.map((item) => item.zoneId)).size);
const cards = computed(() => [
  { label: "映射总数", value: mappings.value.length, detail: `${enabledCount.value} 个已发布` },
  { label: "使用 Zone", value: zoneCount.value, detail: "当前映射覆盖范围" },
  { label: "Connector", value: state.connector?.state || "未知", detail: state.connector?.pid ? `PID ${state.connector.pid}` : "无活动进程" },
  { label: "当前 Tunnel", value: state.setup?.tunnelName || "未配置", detail: state.setup?.accountId || "未绑定 Account" },
]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [loadedMappings, loadedOperations] = await Promise.all([apiClient.mappings(), apiClient.operations(6)]);
    mappings.value = loadedMappings;
    operations.value = loadedOperations.map((item) => item.status === "running" ? { ...item, status: "pending" } : item);
  } catch (error) { notify(messageFor(error), "error"); }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<template>
  <section>
    <header><p class="eyebrow">系统概览</p><h1 class="mt-2 text-2xl font-semibold tracking-[-.035em]">概览</h1><p class="mt-2 text-[13px] text-muted">Cloudflare Tunnel 与已发布服务的运行摘要。</p></header>
    <section class="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
      <article v-for="card in cards" :key="card.label" class="card min-w-0 p-4 sm:p-5"><p class="text-[11px] text-muted">{{ card.label }}</p><div v-if="loading" class="skeleton mt-3 h-7 w-20 rounded"/><p v-else class="mt-2 truncate text-xl font-semibold tracking-tight" :title="String(card.value)">{{ card.value }}</p><p class="mt-1 truncate text-[10px] text-[#7b8088]">{{ card.detail }}</p></article>
    </section>
    <div class="mt-5 grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
      <section class="card overflow-hidden"><header class="flex items-center justify-between border-b border-black/[.08] px-5 py-4"><div><h2 class="text-sm font-medium">最近操作</h2><p class="mt-1 text-[11px] text-muted">Cloudflare 多资源变更记录</p></div><RouterLink class="btn-ghost" to="/mappings">管理映射</RouterLink></header><div v-if="loading" class="space-y-3 p-5"><div v-for="n in 3" :key="n" class="skeleton h-10 rounded"/></div><ul v-else-if="operations.length" class="divide-y divide-black/[.055]"><li v-for="item in operations" :key="item.id" class="flex items-center gap-3 px-5 py-3"><span class="grid h-8 w-8 place-items-center rounded-md bg-black/[.03] text-muted">⇄</span><div class="min-w-0 flex-1"><p class="truncate text-xs font-medium">{{ item.action.replaceAll('_',' ') }}</p><p class="mt-1 truncate text-[10px] text-muted">{{ item.message || item.stage }}</p></div><StatusBadge :status="item.status"/></li></ul><div v-else class="grid min-h-48 place-items-center text-xs text-muted">暂无操作记录</div></section>
      <section class="card overflow-hidden"><header class="border-b border-black/[.08] px-5 py-4"><h2 class="text-sm font-medium">当前绑定</h2><p class="mt-1 text-[11px] text-muted">远程托管 Tunnel</p></header><dl class="px-5 py-2 text-xs"><div class="border-b border-black/[.055] py-3"><dt class="text-muted">Account</dt><dd class="mt-1 truncate font-mono">{{ state.setup?.accountId || "未配置" }}</dd></div><div class="border-b border-black/[.055] py-3"><dt class="text-muted">Tunnel</dt><dd class="mt-1 truncate">{{ state.setup?.tunnelName || "未配置" }}</dd></div><div class="py-3"><dt class="text-muted">Connector</dt><dd class="mt-2"><StatusBadge :status="state.connector?.state || 'unknown'"/></dd></div></dl></section>
    </div>
  </section>
</template>
