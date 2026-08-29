import { writable } from 'svelte/store';

export type View = 'open' | 'collection' | 'battle' | 'help';

export const view = writable<View>('open');
