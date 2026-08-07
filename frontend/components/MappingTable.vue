<script setup lang="ts">
import type { Mapping } from "../types";
import StatusBadge from "./StatusBadge.vue";

withDefaults(defineProps<{ mappings: Mapping[]; loading?: boolean; filtered?: boolean; compact?: boolean }>(), { loading: false, filtered: false, compact: false });
const emit = defineEmits<{ create: []; edit: [mapping: Mapping]; delete: [mapping: Mapping]; test: [mapping: Mapping] }>();
function formattedDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
</script>

<template>
  <div class="relative overflow-hidden bg-surface" :class="compact ? '' : 'min-h-[430px] rounded-xl border border-black/[.08]'">
    <div class="overflow-x-auto">
      <table class="w-full min-w-[800px] text-left">
        <thead><tr class="border-b border-black/[.08] text-[11px] font-medium text-muted"><th class="px-4 py-3">公网地址</th><th class="px-4 py-3">Origin</th><th class="px-4 py-3">资源</th><th class="px-4 py-3">状态</th><th class="w-[126px] px-3 py-3"><span class="sr-only">操作</span></th></tr></thead>
        <tbody>
          <tr v-for="mapping in mappings" :key="mapping.id" class="border-b border-black/[.055] text-[13px] transition last:border-0 hover:bg-black/[.02]">
            <td class="max-w-xs px-4 py-3.5"><a class="block truncate font-medium text-[#272b30] hover:text-primary" :href="`https://${mapping.hostname}${mapping.path || ''}`" target="_blank" rel="noreferrer">{{ mapping.hostname }}</a><code v-if="mapping.path" class="mt-1 block truncate text-[10px] text-muted">{{ mapping.path }}</code></td>
            <td class="px-4 py-3.5"><code class="text-[11px] text-muted">{{ mapping.service }}</code><p class="mt-1 text-[10px] text-[#8b919a]">{{ mapping.targetType === "host" ? "宿主机" : "局域网" }}</p></td>
            <td class="px-4 py-3.5"><div class="flex gap-1.5"><span class="badge !py-0.5" :class="mapping.dnsRecordId ? 'text-emerald-700' : 'text-muted'">DNS</span><span class="badge !py-0.5 text-muted">{{ mapping.zoneName }}</span></div></td>
            <td class="px-4 py-3.5"><StatusBadge :status="mapping.enabled ? 'running' : 'disabled'" :label="mapping.enabled ? '已发布' : '已停用'"/><p class="mt-1 text-[10px] text-muted">{{ formattedDate(mapping.updatedAt) }}</p></td>
            <td class="px-3 py-3.5"><div class="flex justify-end gap-1"><button class="icon-btn" type="button" :aria-label="`测试 ${mapping.hostname}`" title="测试 Origin" @click="emit('test', mapping)">↗</button><button class="icon-btn" type="button" :aria-label="`编辑 ${mapping.hostname}`" title="编辑" @click="emit('edit', mapping)">✎</button><button class="icon-btn hover:!text-red-600" type="button" :aria-label="`删除 ${mapping.hostname}`" title="删除" @click="emit('delete', mapping)">×</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="!loading && !mappings.length" class="absolute inset-x-0 top-14 grid h-80 place-items-center text-center"><div><span class="mx-auto grid h-10 w-10 place-items-center rounded-lg border border-black/[.08] bg-black/[.03] text-muted">⇄</span><p class="mt-3 text-sm text-muted">{{ filtered ? "没有匹配的映射" : "暂无映射" }}</p><p class="mt-1 text-xs text-[#8b919a]">{{ filtered ? "请调整搜索或筛选条件" : "创建映射后会显示在这里" }}</p><button v-if="!filtered" class="btn-primary mt-4 !h-8" type="button" @click="emit('create')">添加映射</button></div></div>
    <Transition name="fade"><div v-if="loading" class="absolute inset-0 top-10 grid place-items-center bg-white/75 backdrop-blur-[2px]"><span class="flex items-center gap-2 rounded-full border border-black/[.09] bg-white px-3 py-2 text-xs text-muted shadow-lg"><span class="spinner"/>正在加载映射</span></div></Transition>
  </div>
</template>
