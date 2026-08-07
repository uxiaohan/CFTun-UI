<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { apiClient } from "../api";
import { messageFor, useAppState } from "../state";
import type { CloudflareChoice, Mapping, MappingInput, MappingTestResult, Operation } from "../types";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import MappingDrawer from "../components/MappingDrawer.vue";
import MappingTable from "../components/MappingTable.vue";
import SelectMenu from "../components/SelectMenu.vue";

const { state, notify } = useAppState();
const mappings = ref<Mapping[]>([]); const loading = ref(true); const query = ref(""); const target = ref("all");
const zones = ref<CloudflareChoice[]>([]); const zonesLoading = ref(false); const syncing = ref(false);
const drawerOpen = ref(false); const editing = ref<Mapping | null>(null); const deleting = ref<Mapping | null>(null);
const saving = ref(false); const testing = ref(false); const deletingBusy = ref(false); const serverError = ref("");
const testResult = ref<MappingTestResult | null>(null); const operation = ref<Operation | null>(null); const displayStage = ref("");
let stageTimer: number | undefined; let operationTimer: number | undefined; let activeOperationId = "";
const stageLabels: Record<string, string> = { validate: "校验输入", old_ingress: "清理旧 Ingress", ingress: "更新 Tunnel Ingress", dns: "同步 DNS CNAME", database: "保存本地记录", complete: "验证结果", failed: "操作失败" };
const filtered = computed(() => { const needle = query.value.trim().toLowerCase(); return mappings.value.filter((item) => (target.value === "all" || item.targetType === target.value) && (!needle || `${item.hostname} ${item.path || ""} ${item.service}`.toLowerCase().includes(needle))); });
const filtering = computed(() => Boolean(query.value.trim()) || target.value !== "all");
async function loadMappings(showLoading = true): Promise<void> { if (showLoading) loading.value = true; try { mappings.value = await apiClient.mappings(); } catch (error) { notify(messageFor(error), "error"); } finally { loading.value = false; } }
async function loadZones(): Promise<void> { zonesLoading.value = true; try { zones.value = (await apiClient.zones()).filter((zone) => !zone.status || zone.status === "active"); } catch (error) { notify(messageFor(error, "无法加载 Zone"), "error"); } finally { zonesLoading.value = false; } }
function open(mapping: Mapping | null = null): void { editing.value = mapping; testResult.value = null; serverError.value = ""; operation.value = null; drawerOpen.value = true; void loadZones(); }
function beginStages(operationId: string): void { activeOperationId = operationId; const labels = ["校验映射与目标地址", "更新 Tunnel Ingress", "同步 DNS CNAME", "保存并验证结果"]; let index = 0; displayStage.value = labels[0] || "正在处理"; stageTimer = window.setInterval(() => { index = Math.min(index + 1, labels.length - 1); displayStage.value = labels[index] || "正在处理"; }, 1800); operationTimer = window.setInterval(async () => { try { const latest = await apiClient.operation(activeOperationId); operation.value = latest; displayStage.value = stageLabels[latest.stage] || latest.stage; } catch {} }, 500); }
function stopStages(): void { if (stageTimer) clearInterval(stageTimer); if (operationTimer) clearInterval(operationTimer); stageTimer = undefined; operationTimer = undefined; }
async function save(input: MappingInput): Promise<void> { saving.value = true; serverError.value = ""; const operationId = crypto.randomUUID(); beginStages(operationId); try { const payload = { ...input, operationId }; const result = editing.value ? await apiClient.updateMapping(editing.value.id, payload) : await apiClient.createMapping(payload); operation.value = await apiClient.operation(result.operationId).catch(() => null); await loadMappings(false); drawerOpen.value = false; notify(editing.value ? "映射已更新" : "映射已创建", "success"); } catch (error) { serverError.value = messageFor(error, "无法应用映射"); } finally { stopStages(); saving.value = false; activeOperationId = ""; } }
async function test(input: MappingInput): Promise<void> { testing.value = true; testResult.value = null; try { testResult.value = await apiClient.testMapping(input); if (testResult.value.ok) notify(`Origin 已响应（${testResult.value.durationMs} ms）`, "success"); } catch (error) { serverError.value = messageFor(error, "测试失败"); } finally { testing.value = false; } }
async function quickTest(mapping: Mapping): Promise<void> { try { const result = await apiClient.testMapping(mapping); notify(result.ok ? `${mapping.hostname} 的 Origin 已响应（${result.durationMs} ms）` : `${mapping.hostname}: ${result.message || result.category}`, result.ok ? "success" : "error"); } catch (error) { notify(messageFor(error), "error"); } }
async function remove(): Promise<void> { if (!deleting.value) return; deletingBusy.value = true; try { await apiClient.deleteMapping(deleting.value.id, { ingress: true, dns: true }); deleting.value = null; await loadMappings(false); notify("映射及其受管理资源已删除", "success"); } catch (error) { notify(messageFor(error, "删除失败"), "error"); } finally { deletingBusy.value = false; } }
async function syncRemote(): Promise<void> { syncing.value = true; try { const result = await apiClient.syncMappings(); await loadMappings(false); notify(`同步完成：导入 ${result.imported} 条，忽略 ${result.skipped} 条，关联 DNS ${result.dnsLinked} 条`, "success", 7000); } catch (error) { notify(messageFor(error, "同步远端规则失败"), "error"); } finally { syncing.value = false; } }
onMounted(loadMappings); onBeforeUnmount(stopStages);
</script>

<template>
  <section><header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p class="eyebrow">发布服务</p><h1 class="mt-2 text-2xl font-semibold tracking-[-.035em]">映射</h1><p class="mt-2 text-[13px] text-muted">统一管理 Tunnel Ingress 与 DNS CNAME。</p></div><div class="flex shrink-0 gap-2"><button class="btn-secondary min-w-28" type="button" :disabled="syncing" @click="syncRemote"><span v-if="syncing" class="spinner"/>{{ syncing ? "正在同步" : "同步远端" }}</button><button class="btn-primary" type="button" @click="open()">＋ 添加映射</button></div></header><div class="mt-7 flex flex-wrap gap-2 rounded-xl border border-black/[.08] bg-white p-3"><label class="relative min-w-[220px] flex-1"><span class="sr-only">搜索映射</span><input v-model="query" class="field" type="search" placeholder="搜索 hostname、path 或 origin"></label><SelectMenu v-model="target" class="w-[150px]" :options="[{value:'all',label:'全部目标'},{value:'host',label:'宿主机'},{value:'lan',label:'局域网'}]" aria-label="目标类型筛选"/></div><div class="mb-3 mt-5 flex items-center justify-between"><p class="text-xs text-muted">显示 {{ filtered.length }} / {{ mappings.length }} 个映射</p><button v-if="filtering" class="btn-ghost !h-8" @click="query='';target='all'">清除筛选</button></div><MappingTable :mappings="filtered" :loading="loading" :filtered="filtering" @create="open()" @edit="open" @delete="deleting=$event" @test="quickTest"/></section>
  <MappingDrawer :open="drawerOpen" :mapping="editing" :zones="zones" :zones-loading="zonesLoading" :saving="saving" :testing="testing" :server-error="serverError" :test-result="testResult" :operation="operation" :display-stage="displayStage" @close="drawerOpen=false" @save="save" @test="test"/>
  <ConfirmDialog :open="!!deleting" title="删除此映射？" :description="`将删除 ${deleting?.hostname} 的受管理 Ingress 与 DNS 资源。此操作不会删除 Tunnel。`" confirm-label="删除映射" :busy="deletingBusy" @cancel="deleting=null" @confirm="remove"/>
</template>
