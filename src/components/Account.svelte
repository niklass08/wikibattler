<script lang="ts">
  /**
   * Sign in with Google to sync a collection across devices.
   *
   * Everything Firebase-shaped is behind a dynamic import: a signed-out player
   * never downloads the SDK, and the offline path is exactly what it was. The
   * module handle is cached in `mod` once loaded.
   */
  import { cloudEnabled } from '../lib/cloud/flag';
  import type { AuthState } from '../lib/firebase';
  import type { SyncState } from '../lib/cloud/sync';

  type FbMod = typeof import('../lib/firebase');
  type SyncMod = typeof import('../lib/cloud/sync');

  let auth = $state<AuthState>({ ready: false, kind: 'none', uid: '', email: null, name: null });
  let status = $state<SyncState>({ phase: 'off', at: null, error: null });
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Set when signing in would adopt an existing account and strand this
   *  device's Arena rating — the player confirms before we go through with it. */
  let confirmSwitch = $state(false);
  let open = $state(false);

  /** Memoised so the boot effect and a sign-in click cannot both import the
   *  modules and end up subscribing to the auth store twice. */
  let loading: Promise<{ fb: FbMod; sync: SyncMod }> | null = null;

  function load(): Promise<{ fb: FbMod; sync: SyncMod }> {
    loading ??= (async () => {
      const [f, s] = await Promise.all([
        import('../lib/firebase'),
        import('../lib/cloud/sync')
      ]);
      f.watchAuth();
      f.authState.subscribe((v) => (auth = v));
      s.syncState.subscribe((v) => (status = v));
      return { fb: f, sync: s };
    })();
    return loading;
  }

  // Resume sync on load for a player who is already signed in. Nothing happens —
  // and nothing is downloaded — for anyone else.
  $effect(() => {
    if (!cloudEnabled()) return;
    void (async () => {
      const { sync: s } = await load();
      try {
        await s.startSync();
      } catch {
        /* syncState carries the error */
      }
    })();
  });

  async function signIn(confirmed = false) {
    busy = true;
    error = null;
    try {
      const { fb: f, sync: s } = await load();
      const res = await f.signInWithGoogle();
      if (!res.uid) return; // redirected away; we finish on the way back
      if (!res.linked && res.previousUid && !confirmed) {
        // this Google account already exists, so we just adopted its identity;
        // tell the player their Arena rating on this device did not come along
        confirmSwitch = true;
      }
      await s.startSync();
    } catch {
      error = 'Sign-in did not complete. Try again.';
    } finally {
      busy = false;
    }
  }

  async function signOutNow() {
    busy = true;
    try {
      const { fb: f, sync: s } = await load();
      await s.flush();
      s.stopSync();
      await f.signOutCloud();
      open = false;
    } catch {
      error = 'Could not sign out cleanly.';
    } finally {
      busy = false;
    }
  }

  const signedIn = $derived(auth.kind === 'google');
  const label = $derived(
    status.phase === 'pulling'
      ? 'Syncing…'
      : status.phase === 'pushing'
        ? 'Saving…'
        : status.phase === 'error'
          ? 'Sync problem'
          : 'Synced'
  );
</script>

{#if signedIn}
  <div class="acct">
    <button class="chip" class:bad={status.phase === 'error'} onclick={() => (open = !open)}>
      <span class="dot" class:spin={status.phase === 'pulling' || status.phase === 'pushing'}
      ></span>
      <span class="who">{auth.email ?? auth.name ?? 'Signed in'}</span>
    </button>
    {#if open}
      <div class="pop">
        <p class="state">{label}</p>
        {#if status.error}<p class="err">{status.error}</p>{/if}
        <p class="note">
          Your collection is saved to your Google account. Open WikiTCG on another device and sign
          in with the same account to pick it up.
        </p>
        <button class="out" onclick={signOutNow} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
        <p class="note dim">Signing out leaves this collection on this device.</p>
      </div>
    {/if}
  </div>
{:else}
  <button class="signin" onclick={() => signIn()} disabled={busy}>
    {busy ? 'Connecting…' : 'Sign in'}
  </button>
{/if}

{#if error}<p class="err floating">{error}</p>{/if}

{#if confirmSwitch}
  <div class="modal" role="alertdialog" aria-labelledby="switch-title">
    <div class="sheet">
      <h3 id="switch-title">Collections merged</h3>
      <p>
        This Google account already had a WikiTCG collection. It has been merged with the one on
        this device — nothing was lost.
      </p>
      <p class="warn">
        Your Arena rating on this device did not carry over, because it belonged to the anonymous
        player this browser was using. The rating on your Google account is the one that counts from
        now on.
      </p>
      <button class="ok" onclick={() => (confirmSwitch = false)}>Got it</button>
    </div>
  </div>
{/if}

<style>
  .acct {
    position: relative;
  }
  .chip,
  .signin {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-weight: 500;
    font-size: 15px;
    white-space: nowrap;
  }
  .chip:hover,
  .signin:hover {
    color: var(--text);
  }
  .who {
    max-width: 15ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--rare, #6ee7a8);
  }
  .chip.bad .dot {
    background: var(--mythic, #f0a);
  }
  .dot.spin {
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: min(300px, 78vw);
    padding: 14px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.45);
  }
  .state {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .note {
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.45;
  }
  .note.dim {
    color: var(--text-faint);
    font-size: 12px;
    margin-top: 8px;
  }
  .err {
    color: var(--mythic, #f0a);
    font-size: 13px;
    margin-bottom: 6px;
  }
  .err.floating {
    position: absolute;
    right: 0;
    font-size: 12px;
  }
  .out {
    margin-top: 12px;
    padding: 9px 14px;
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 14px;
  }
  .out:hover {
    background: var(--surface);
  }
  .modal {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(0 0 0 / 0.6);
  }
  .sheet {
    max-width: 420px;
    padding: 22px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .sheet h3 {
    margin-bottom: 10px;
  }
  .sheet p {
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.5;
    margin-bottom: 10px;
  }
  .sheet p.warn {
    color: var(--text);
  }
  .ok {
    margin-top: 8px;
    padding: 10px 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .ok:hover {
    background: var(--surface);
  }
  @media (prefers-reduced-motion: reduce) {
    .dot.spin {
      animation: none;
    }
  }
</style>
