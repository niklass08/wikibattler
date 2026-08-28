import { writable } from 'svelte/store';

export type View = 'open' | 'collection';

export const view = writable<View>('open');
