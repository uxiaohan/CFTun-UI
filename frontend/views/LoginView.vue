<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { messageFor, useAppState } from "../state";

const { state, login, initializeAuth } = useAppState();
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const busy = ref(false);
const error = ref("");
const passwordInput = ref<HTMLInputElement | null>(null);
const firstRun = computed(() => !state.authConfigured);

async function submit(): Promise<void> {
  error.value = "";
  if (firstRun.value && password.value !== confirmPassword.value) {
    error.value = "两次输入的密码不一致";
    return;
  }
  busy.value = true;
  try {
    const credentials = { username: username.value.trim(), password: password.value };
    if (firstRun.value) await initializeAuth(credentials);
    else await login(credentials);
  } catch (caught) {
    error.value = messageFor(caught, firstRun.value ? "无法创建本地管理员" : "登录失败");
    password.value = "";
    confirmPassword.value = "";
    await nextTick();
    passwordInput.value?.focus();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-sm items-center px-5 py-12">
    <div class="w-full">
      <div class="mb-8 text-center">
        <span class="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary font-semibold text-white shadow-[0_10px_30px_rgba(94,106,210,.2)]">CF</span>
        <h1 class="mt-5 text-xl font-semibold tracking-[-.025em]">{{ firstRun ? "创建本地管理员" : "欢迎回来" }}</h1>
        <p class="mt-2 text-[13px] text-muted">{{ firstRun ? "先保护当前控制台，再连接 Cloudflare" : "登录以管理 Cloudflare Tunnel" }}</p>
      </div>
      <form class="card p-5" @submit.prevent="submit">
        <label class="label" for="username">用户名</label>
         <input id="username" v-model="username" class="field" autocomplete="username" minlength="1" maxlength="64" pattern="[A-Za-z0-9_.-]+" required autofocus>
        <label class="label mt-4" for="password">{{ firstRun ? "密码" : "当前密码" }}</label>
        <input id="password" ref="passwordInput" v-model="password" class="field" type="password" :autocomplete="firstRun ? 'new-password' : 'current-password'" :minlength="firstRun ? 6 : undefined" :maxlength="firstRun ? 256 : undefined" required>
        <template v-if="firstRun">
          <label class="label mt-4" for="confirm-password">确认密码</label>
          <input id="confirm-password" v-model="confirmPassword" class="field" type="password" autocomplete="new-password" minlength="6" maxlength="256" required>
          <p class="mt-1.5 text-[10px] text-muted">密码必须为 6 至 256 个字符；此凭据仅保存在本机。</p>
        </template>
        <p v-if="error" class="alert-error mt-4" role="alert">{{ error }}</p>
        <button class="btn-primary mt-5 w-full" :disabled="busy">
          <span v-if="busy" class="spinner" />{{ busy ? "正在处理" : firstRun ? "创建并继续" : "登录" }}
        </button>
      </form>
      <p class="mt-8 text-center text-[11px] leading-5 text-muted">CFTun-UI 本地管理界面<br>Cloudflare Token 仅由 Bun 后端用于调用 Cloudflare API</p>
    </div>
  </main>
</template>
