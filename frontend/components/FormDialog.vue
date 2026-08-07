<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useScrollLock } from "../composables/useScrollLock";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  busy?: boolean;
}>(), {
  description: "",
  submitLabel: "保存",
  busy: false,
});
const emit = defineEmits<{ close: []; submit: [] }>();
const panel = ref<HTMLElement | null>(null);
const setLocked = useScrollLock();
let previous: HTMLElement | null = null;

function close(): void {
  if (!props.busy) emit("close");
}

function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab" || !panel.value) return;
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    previous = document.activeElement as HTMLElement | null;
    setLocked(true);
    document.addEventListener("keydown", keydown);
    await nextTick();
    panel.value?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
  } else {
    setLocked(false);
    document.removeEventListener("keydown", keydown);
    previous?.focus();
  }
});

onBeforeUnmount(() => document.removeEventListener("keydown", keydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[80] grid place-items-center p-4">
        <div class="absolute inset-0 bg-[#111827]/30 backdrop-blur-[1px]" @click="close" />
        <section ref="panel" class="relative w-full max-w-[440px] overflow-hidden rounded-xl border border-black/[.1] bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="form-dialog-title" :aria-describedby="description ? 'form-dialog-description' : undefined">
          <header class="border-b border-black/[.07] px-5 py-4">
            <h2 id="form-dialog-title" class="text-[15px] font-semibold">{{ title }}</h2>
            <p v-if="description" id="form-dialog-description" class="mt-1.5 text-xs leading-5 text-muted">{{ description }}</p>
          </header>
          <form novalidate @submit.prevent="emit('submit')">
            <div class="p-5"><slot /></div>
            <footer class="flex justify-end gap-2 border-t border-black/[.07] px-5 py-3.5">
              <button class="btn-secondary" type="button" :disabled="busy" @click="close">取消</button>
              <button class="btn-primary min-w-24" type="submit" :disabled="busy">
                <span v-if="busy" class="spinner" aria-hidden="true" />
                {{ busy ? "正在保存" : submitLabel }}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
