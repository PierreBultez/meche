import { getCurrentScope, onScopeDispose, readonly, ref, type Ref } from "vue";

/**
 * One clock shared by every fuse on screen (docs/08: a countdown must not redraw the whole list).
 * It ticks once a minute, only while a component uses it and the window is visible. Only the
 * components that read it are redrawn: a card without a fuse never subscribes.
 */
const TICK_MS = 60_000;

const now = ref(Date.now());
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  now.value = Date.now();
}

function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function startTimer(): void {
  stopTimer();
  if (document.hidden) return;
  tick();
  timer = setInterval(tick, TICK_MS);
}

// Hidden window (minimized, another workspace): no tick. Shown again: up to date at once.
function onVisibilityChange(): void {
  if (users > 0) startTimer();
}

/** The current time (ms), refreshed once a minute. Call it in a component's setup. */
export function useNow(): Readonly<Ref<number>> {
  if (users++ === 0) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    startTimer();
  }
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (--users === 0) {
        stopTimer();
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    });
  }
  return readonly(now);
}

/** How many components use the clock (tests). */
export function nowSubscribers(): number {
  return users;
}
