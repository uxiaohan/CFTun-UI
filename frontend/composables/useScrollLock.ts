import { onBeforeUnmount } from "vue";
let locks = 0;
let overflow = "";
export function useScrollLock() {
  let active = false;
  const setLocked = (locked: boolean): void => {
    if (active === locked) return;
    active = locked;
    if (locked && locks++ === 0) {
      overflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    } else if (!locked && locks > 0 && --locks === 0) {
      document.documentElement.style.overflow = overflow;
    }
  };
  onBeforeUnmount(() => setLocked(false));
  return setLocked;
}
