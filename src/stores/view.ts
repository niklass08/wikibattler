import { writable } from 'svelte/store';

export type View = 'open' | 'collection' | 'battle';

export const view = writable<View>('open');
