/**
 * Firebase bootstrap for the Arena ladder — the ONE place the app talks to a
 * backend, and only from the Arena view (this module is dynamically imported so
 * it never lands in the Open / Collection / Battle chunks).
 *
 * `firebaseConfig` below is PUBLIC BY DESIGN. A Firebase web config identifies a
 * project; it is not a secret (Google's docs say so explicitly). Every write is
 * gated by the committed Firestore security rules in `firestore.rules`. This is
 * the deliberate, documented exception to the project's "no API keys" rule,
 * which is about secrets and build-time env — see README "Arena".
 *
 * To point this at your own project: create a Firestore project, enable
 * Anonymous auth, `firebase deploy --only firestore`, add your Pages origin to
 * Auth → Authorized domains, and paste your web config over the placeholders.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore/lite';

const firebaseConfig = {
  apiKey: 'AIzaSyCAh9ms_a1HXqgw_vlHy5JrM_PXeo16B64',
  authDomain: 'wikitcg-263e5.firebaseapp.com',
  projectId: 'wikitcg-263e5',
  appId: '1:342532269337:web:1b03f9bf3a061d9bb51188'
};

/** False until the placeholders above are replaced — the Arena UI checks this. */
export const arenaConfigured = !firebaseConfig.projectId.startsWith('REPLACE');

export interface Arena {
  db: Firestore;
  uid: string;
}

let cached: Promise<Arena> | null = null;

function resolveUid(auth: Auth): Promise<string> {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        unsub();
        if (user) return resolve(user.uid);
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user.uid);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('arena-auth-failed'));
        }
      },
      (err) => reject(err instanceof Error ? err : new Error('arena-auth-failed'))
    );
  });
}

/**
 * Initialise Firebase, sign in anonymously (reusing the persisted identity), and
 * hand back the Firestore handle + this device's stable uid. Memoised. A
 * rejection clears the memo so a later attempt can retry.
 */
export function getArena(): Promise<Arena> {
  if (!arenaConfigured) return Promise.reject(new Error('arena-unconfigured'));
  if (cached) return cached;
  cached = (async () => {
    const app = initializeApp(firebaseConfig);
    const uid = await resolveUid(getAuth(app));
    return { db: getFirestore(app), uid };
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
