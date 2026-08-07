<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiClient } from "../api";
import { messageFor, useAppState } from "../state";
import type { CloudflareChoice, SetupStatus } from "../types";
import SelectMenu from "../components/SelectMenu.vue";

const { refresh, notify } = useAppState();
const status = ref<SetupStatus | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const token = ref("");
const accountId = ref("");
const tunnelId = ref("");
const tunnelName = ref("");
const connectorAutoStart = ref(true);
const tunnels = ref<CloudflareChoice[]>([]);
const createTunnel = ref(false);
const syncStage = ref("");

const step = computed<"token" | "tunnel" | "complete">(() => {
  if (!status.value?.tokenConfigured || !status.value.accountId) return "token";
  if (!status.value.tunnelTokenConfigured) return "tunnel";
  return "complete";
});
const stepKeys = ["token", "tunnel", "complete"] as const;
const stepLabels = ["Cloudflare", "Tunnel", "完成"];
const busyLabels = computed(() => ({ token: "正在验证权限", tunnel: syncStage.value || "正在配置 Tunnel", complete: "正在启动 Connector" }));
const actionLabels = { token: "验证并继续", tunnel: "配置 Tunnel", complete: "完成初始化" } as const;
const tunnelStatusLabels: Record<string, string> = { healthy: "使用中", degraded: "状态异常", down: "未连接", inactive: "从未连接" };
const options = (items: CloudflareChoice[]) => items.map((item) => ({ value: item.id, label: `${item.name}${item.status ? ` · ${tunnelStatusLabels[item.status] ?? item.status}` : ""}` }));

async function reloadStatus(): Promise<void> {
  status.value = await apiClient.setup();
  accountId.value = status.value.accountId || accountId.value;
  tunnelId.value = status.value.tunnelId || tunnelId.value;
}

async function loadChoices(): Promise<void> {
  if (!status.value?.tokenConfigured) return;
  if (status.value.accountId) {
    tunnels.value = await apiClient.tunnels(status.value.accountId);
  }
}

async function init(): Promise<void> {
  loading.value = true;
  try { await reloadStatus(); await loadChoices(); }
  catch (caught) { error.value = messageFor(caught); }
  finally { loading.value = false; }
}

async function submit(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    if (step.value === "token") {
      const result = await apiClient.saveSetupToken(accountId.value.trim(), token.value);
      notify(`Token 有效，已读取 ${result.zoneCount} 个 Zone`, "success");
      await reloadStatus();
      tunnels.value = await apiClient.tunnels(accountId.value);
    } else if (step.value === "tunnel") {
      let selectedId = tunnelId.value;
      if (createTunnel.value) selectedId = (await apiClient.createTunnel(tunnelName.value.trim())).tunnel.id;
      syncStage.value = "正在同步远端 HTTP/HTTPS 规则";
      const { sync: synced } = await apiClient.saveSetupTunnel(selectedId);
      notify(`远端规则同步完成：导入 ${synced.imported} 条，忽略 ${synced.skipped} 条，关联 DNS ${synced.dnsLinked} 条`, "success", 7000);
      await reloadStatus();
    } else {
      await apiClient.completeSetup({ connectorAutoStart: connectorAutoStart.value });
      notify("初始化完成，正在进入控制台", "success");
      await refresh();
    }
  } catch (caught) { error.value = messageFor(caught); }
  finally { busy.value = false; syncStage.value = ""; }
}

onMounted(init);
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-10">
    <section class="w-full">
      <header class="mb-7 text-center">
        <span class="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary font-semibold text-white">CF</span>
        <p class="eyebrow mt-5">首次运行</p>
        <h1 class="mt-2 text-2xl font-semibold">连接 Cloudflare</h1>
        <p class="mt-2 text-[13px] text-muted">完成 Account、Zone 和远程托管 Tunnel 配置。</p>
      </header>
      <ol class="mb-5 grid grid-cols-3 gap-1" aria-label="初始化进度">
        <li v-for="(label, index) in stepLabels" :key="label" class="text-center">
          <span class="mx-auto grid h-7 w-7 place-items-center rounded-full border text-[11px]" :class="index <= stepKeys.indexOf(step) ? 'border-primary bg-primary text-white' : 'border-black/10 bg-white text-muted'">{{ index + 1 }}</span>
          <span class="mt-1.5 hidden text-[10px] text-muted sm:block">{{ label }}</span>
        </li>
      </ol>
      <section class="card min-h-64 p-5 sm:p-6">
        <div v-if="loading" class="grid min-h-52 place-items-center"><span class="spinner text-primary" /></div>
        <form v-else @submit.prevent="submit">
          <div v-if="step === 'token'">
            <h2 class="text-[15px] font-semibold">Cloudflare 账户与 API 令牌</h2>
            <p class="mt-1 text-xs leading-5 text-muted">填写 Account ID 和自定义 API Token。Tunnel Connector Token 将在选择 Tunnel 后自动获取。</p>
            <label class="label mt-5" for="setup-account-id">Account ID</label>
            <input id="setup-account-id" v-model.trim="accountId" class="field font-mono" autocomplete="off" minlength="16" maxlength="64" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" required autofocus>
            <label class="label mt-4" for="setup-token">Cloudflare API Token</label>
            <input id="setup-token" v-model.trim="token" class="field font-mono" type="password" autocomplete="off" required autofocus>
            <section class="mt-5 rounded-lg border border-black/[.08] bg-black/[.025] p-3.5 text-[11px] leading-5">
              <div class="flex items-center justify-between gap-3"><strong class="text-xs">API Token 所需权限</strong><a class="font-medium text-primary hover:underline" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">创建 Token ↗</a></div>
              <div class="mt-3 grid gap-x-5 gap-y-1 sm:grid-cols-2"><span>账户：Cloudflare Tunnel · 编辑</span><span>账户：Cloudflare Tunnel · 读取</span><span>区域：DNS · 编辑</span><span>区域：DNS · 读取</span><span>区域：区域 · 读取</span></div>
              <a class="mt-3 inline-flex font-medium text-primary hover:underline" href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">打开官方获取教程 ↗</a>
            </section>
          </div>
          <div v-else-if="step === 'tunnel'">
            <h2 class="text-[15px] font-semibold">配置 Tunnel</h2>
            <div class="mt-5 grid grid-cols-2 rounded-lg bg-black/[.03] p-1">
              <button class="h-8 rounded-md text-xs" :class="!createTunnel ? 'bg-white shadow-sm' : 'text-muted'" type="button" @click="createTunnel = false">选择已有</button>
              <button class="h-8 rounded-md text-xs" :class="createTunnel ? 'bg-white shadow-sm' : 'text-muted'" type="button" @click="createTunnel = true">创建新的</button>
            </div>
            <template v-if="createTunnel">
              <label class="label mt-4" for="tunnel-name">Tunnel 名称</label>
              <input id="tunnel-name" v-model.trim="tunnelName" class="field" required>
            </template>
            <template v-else>
              <label class="label mt-4">Tunnel</label>
              <SelectMenu v-model="tunnelId" :options="options(tunnels.filter((item) => item.config_src === 'cloudflare'))" aria-label="Tunnel" />
            </template>
          </div>
          <div v-else>
            <h2 class="text-[15px] font-semibold">配置已就绪</h2>
            <p class="mt-1 text-xs leading-5 text-muted">Tunnel 与远端 HTTP/HTTPS 规则已准备完成。</p>
            <label class="mt-5 flex items-center gap-2 text-xs"><input v-model="connectorAutoStart" type="checkbox">系统启动后自动连接上次使用的 Tunnel</label>
          </div>
          <p v-if="error" class="alert-error mt-5" role="alert">{{ error }}</p>
          <footer class="mt-6 flex justify-end border-t border-black/[.07] pt-4">
            <button class="btn-primary min-w-28" :disabled="busy || (step === 'token' && (!accountId || !token)) || (step === 'tunnel' && !(createTunnel ? tunnelName : tunnelId))">
              <span v-if="busy" class="spinner" />{{ busy ? busyLabels[step] : actionLabels[step] }}
            </button>
          </footer>
        </form>
      </section>
    </section>
  </main>
</template>
