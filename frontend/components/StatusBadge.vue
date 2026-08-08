<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ status: string; label?: string }>();
const labels: Record<string, string> = { healthy: "正常", running: "运行中", success: "成功", succeeded: "成功", starting: "启动中", stopping: "停止中", restarting: "重启中", backoff: "等待重试", pending: "处理中", degraded: "状态异常", warning: "需注意", partial: "部分完成", partially_failed: "部分失败", failed: "失败", down: "离线", stopped: "已停止", inactive: "未连接", disabled: "已停用", unknown: "未知" };
const tone = computed(() => {
  if (["healthy", "running", "success", "succeeded"].includes(props.status)) return "good";
  if (["starting", "stopping", "restarting", "backoff", "pending", "degraded", "warning", "partial", "partially_failed"].includes(props.status)) return "warn";
  if (["failed", "down"].includes(props.status)) return "bad";
  return "neutral";
});
</script>
<template><span class="badge !py-0.5" :class="{ 'border-emerald-500/15 bg-emerald-500/[.07] text-emerald-700': tone === 'good', 'border-amber-500/15 bg-amber-500/[.08] text-amber-700': tone === 'warn', 'border-red-500/15 bg-red-500/[.07] text-red-600': tone === 'bad', 'text-muted': tone === 'neutral' }"><span class="h-1.5 w-1.5 rounded-full" :class="tone === 'good' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'bad' ? 'bg-red-500' : 'bg-gray-400'" />{{ label || labels[status] || status }}</span></template>
