<script lang="ts">
  import { view, type View } from '../stores/view';
  import { collection } from '../lib/collection';
  import { knowledge } from '../lib/shop';
  import Account from './Account.svelte';

  const owned = $derived(Object.keys($collection).length);

  /** Only used below the breakpoint, where the links collapse into a menu. */
  let open = $state(false);
  let headerEl = $state<HTMLElement>();

  function go(v: View) {
    view.set(v);
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
  function onPointer(e: MouseEvent) {
    if (open && headerEl && !headerEl.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window on:keydown={onKey} on:click={onPointer} />

<header class="nav" bind:this={headerEl}>
  <div class="wrap bar">
    <button class="mark" onclick={() => go('open')}>
      Wiki<span>TCG</span>
    </button>

    <button
      class="burger"
      class:on={open}
      type="button"
      aria-expanded={open}
      aria-controls="nav-menu"
      aria-label={open ? 'Close menu' : 'Open menu'}
      onclick={() => (open = !open)}
    >
      <span></span><span></span><span></span>
    </button>

    <nav id="nav-menu" class:open>
      <button class:active={$view === 'open'} onclick={() => go('open')}>Open</button>
      <button class:active={$view === 'collection'} onclick={() => go('collection')}>
        Collection
        {#if owned > 0}<span class="count mono">{owned}</span>{/if}
      </button>
      {#if owned > 0}
        <button class:active={$view === 'battle'} onclick={() => go('battle')}>
          Battle <span class="tag mono">beta</span>
        </button>
        <button class:active={$view === 'arena'} onclick={() => go('arena')}>
          Arena <span class="tag mono">beta</span>
        </button>
        <button class:active={$view === 'shop'} onclick={() => go('shop')}>
          Shop <span class="count mono">📖{$knowledge}</span>
        </button>
      {/if}
      <button class="help" class:active={$view === 'help'} onclick={() => go('help')}>
        Help
      </button>
      <Account />
    </nav>
  </div>
</header>

<style>
  .nav {
    position: sticky;
    top: 0;
    z-index: 20;
    /* sits under the status bar / notch without this, because of viewport-fit=cover */
    padding-top: env(safe-area-inset-top);
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line);
  }
  .bar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 68px;
  }
  .mark {
    flex: 0 0 auto;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: 20px;
  }
  .mark span {
    color: var(--text-dim);
  }
  nav {
    display: flex;
    gap: 4px;
  }
  nav button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-weight: 500;
    font-size: 15px;
    white-space: nowrap;
    transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
  }
  nav button:hover {
    color: var(--text);
  }
  nav button.active {
    color: var(--text);
    background: var(--surface);
  }
  .count {
    font-size: 12px;
    color: var(--text-faint);
  }
  nav button.help {
    color: var(--text-faint);
  }
  nav button.help:hover,
  nav button.help.active {
    color: var(--text);
  }
  .tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--mythic);
    padding: 1px 4px;
    border-radius: 4px;
  }

  /* --- burger: hidden until the links stop fitting --- */
  .burger {
    display: none;
    flex: 0 0 auto;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 42px;
    height: 42px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
  }
  .burger span {
    display: block;
    height: 2px;
    border-radius: 2px;
    background: var(--text-dim);
    transition: transform var(--dur) var(--ease), opacity var(--dur) var(--ease);
  }
  .burger:hover span {
    background: var(--text);
  }
  .burger.on span {
    background: var(--text);
  }
  .burger.on span:nth-child(1) {
    transform: translateY(7px) rotate(45deg);
  }
  .burger.on span:nth-child(2) {
    opacity: 0;
  }
  .burger.on span:nth-child(3) {
    transform: translateY(-7px) rotate(-45deg);
  }

  /* The full row needs ~780px next to the wordmark; below that it would push
     the page wider than the viewport and cause horizontal scroll. */
  @media (max-width: 820px) {
    .burger {
      display: flex;
    }
    nav {
      display: none;
      position: absolute;
      top: calc(100% + 1px);
      right: 0;
      left: 0;
      flex-direction: column;
      gap: 2px;
      padding: 8px;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 16px 40px rgb(0 0 0 / 0.45);
      animation: menu-in 160ms var(--ease);
    }
    nav.open {
      display: flex;
    }
    nav button {
      justify-content: space-between;
      width: 100%;
      padding: 13px 14px;
      font-size: 16px;
    }
    nav button.help {
      color: var(--text-dim);
    }
    nav :global(.acct),
    nav :global(.signin) {
      width: 100%;
    }
    nav :global(.signin) {
      justify-content: space-between;
      padding: 13px 14px;
      font-size: 16px;
    }
    nav :global(.chip) {
      width: 100%;
      justify-content: flex-start;
      padding: 13px 14px;
      font-size: 16px;
    }
  }
  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    nav,
    .burger span {
      animation: none;
      transition: none;
    }
  }

  /* Apple's touch guidance is a 44pt minimum; the desktop chip sizes land
     around 34-38px, which is fiddly under a thumb. */
  @media (max-width: 820px) {
    .mark {
      padding-block: 8px;
    }
  }
</style>
