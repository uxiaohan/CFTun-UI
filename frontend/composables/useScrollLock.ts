import { onBeforeUnmount } from "vue";
let locks = 0;
let overflow = "";
let padding = "";
export function useScrollLock() {
  let active = false;
  const setLocked = (locked: boolean): void => {
    if (active === locked) return;
    active = locked;
    if (locked && locks++ === 0) {
      overflow = document.body.style.overflow; padding = document.body.style.paddingRight;
      const width = document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      const gained = document.documentElement.clientWidth - width;
      if (gained > 0) document.body.style.paddingRight = `${gained}px`;
    } else if (!locked && locks > 0 && --locks === 0) {
      document.body.style.overflow = overflow; document.body.style.paddingRight = padding;
    }
  };
  onBeforeUnmount(() => setLocked(false));
  return setLocked;
}
