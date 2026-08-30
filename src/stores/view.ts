import { writable } from 'svelte/store';

export type View = 'open' | 'collection' | 'battle' | 'arena' | 'shop' | 'help';

export const view = writable<View>('open');
