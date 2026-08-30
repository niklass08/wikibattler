/**
 * Press-and-hold gesture, for surfacing a secondary action on touch where there
 * is no hover and the primary tap is already spoken for.
 *
 * It cancels if the finger moves — otherwise every scroll that starts on the
 * element would fire it — and swallows the click that follows a completed hold,
 * so the element's own `onclick` doesn't also run. The click listener is on the
 * capture phase so it gets there before any handler on a child.
 */
export interface LongPressOptions {
  /** runs once the hold completes */
  onlongpress: () => void;
  /** how long to hold, ms */
  duration?: number;
  /** movement that counts as a scroll and cancels the hold, px */
  tolerance?: number;
}

export function longpress(node: HTMLElement, options: LongPressOptions) {
  let opts = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0;
  let startY = 0;
  let fired = false;
  let touch = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // primary press only
    cancel();
    fired = false;
    touch = e.pointerType !== 'mouse';
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = undefined;
      fired = true;
      opts.onlongpress();
    }, opts.duration ?? 450);
  };

  const onMove = (e: PointerEvent) => {
    if (!timer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > (opts.tolerance ?? 10)) cancel();
  };

  const onClick = (e: MouseEvent) => {
    if (!fired) return;
    // the hold already did something — don't let it count as a tap too
    e.preventDefault();
    e.stopPropagation();
    fired = false;
  };

  const onContextMenu = (e: Event) => {
    // a touch hold otherwise raises the native callout over our own action
    if (touch) e.preventDefault();
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', onClick, true);
  node.addEventListener('contextmenu', onContextMenu);

  return {
    update(next: LongPressOptions) {
      opts = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', onClick, true);
      node.removeEventListener('contextmenu', onContextMenu);
    }
  };
}
