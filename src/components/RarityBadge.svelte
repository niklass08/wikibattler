<script lang="ts">
  import type { Rarity } from '../lib/types';
  import { RARITY_LABEL } from '../lib/types';

  let { rarity, size = 'md' }: { rarity: Rarity; size?: 'sm' | 'md' } = $props();
</script>

<span class="badge rarity-{rarity}" class:sm={size === 'sm'}>
  <span class="dot"></span>
  {RARITY_LABEL[rarity]}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .badge.sm {
    font-size: 10px;
    gap: 5px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 70%, transparent);
  }
  .rarity-mythic .dot {
    background: linear-gradient(135deg, var(--mythic), var(--mythic-2));
  }
</style>
