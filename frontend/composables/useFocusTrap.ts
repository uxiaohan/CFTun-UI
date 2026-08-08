import { onBeforeUnmount, type Ref } from "vue";

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  panel: Ref<HTMLElement | null>,
  isBusy: Ref<boolean> | (() => boolean),
  onEscape?: () => void,
) {
  let previous: HTMLElement | null = null;
  let added = false;

  function busy(): boolean {
    return typeof isBusy === "function" ? isBusy() : isBusy.value;
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (onEscape && !busy()) onEscape();
      return;
    }
    if (event.key !== "Tab" || !panel.value) return;
    const items = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0], last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function activate(focusSelector?: string): void {
    previous = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", keydown);
    added = true;
    if (focusSelector) {
      setTimeout(() => panel.value?.querySelector<HTMLElement>(focusSelector)?.focus(), 0);
    }
  }

  function deactivate(): void {
    if (!added) return;
    document.removeEventListener("keydown", keydown);
    added = false;
    previous?.focus();
    previous = null;
  }

  onBeforeUnmount(() => { if (added) deactivate(); });

  return { keydown, activate, deactivate };
}