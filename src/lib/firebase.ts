/**
 * Firebase bootstrap — the ONE place the app talks to a backend. Used by the
 * Arena ladder and by cloud sync; this module is dynamically imported by both,
 * so it never lands in the Open / Collection / Battle chunks and a signed-out
 * player still runs fully offline.
 *
 * `firebaseConfig` below is PUBLIC BY DESIGN. A Firebase web config identifies a
 * project; it is not a secret (Google's docs say so explicitly). Every write is
 * gated by the committed Firestore security rules in `firestore.rules`. This is
 * the deliberate, documented exception to the project's "no API keys" rule,
 * which is about secrets and build-time env — see README "Arena".
 *
 * To point this at your own project: create a Firestore project, enable
 * Anonymous AND Google auth, `firebase deploy --only firestore`, add your Pages
 * origin to Auth → Authorized domains, and paste your web config over the
 * placeholders.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  linkWithPopup,
  linkWithRedirect,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore/lite';
import { writable, type Readable } from 'svelte/store';

const firebaseConfig = {
  apiKey: 'AIzaSyCAh9ms_a1HXqgw_vlHy5JrM_PXeo16B64',
  authDomain: 'wikitcg-263e5.firebaseapp.com',
  projectId: 'wikitcg-263e5',
  appId: '1:342532269337:web:1b03f9bf3a061d9bb51188'
};

/** False until the placeholders above are replaced — the Arena UI checks this. */
export const arenaConfigured = !firebaseConfig.projectId.startsWith('REPLACE');

// ── app singleton ────────────────────────────────────────────────────────────
let app: FirebaseApp | null = null;
function theApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}
const theAuth = (): Auth => getAuth(theApp());

// ── observable auth state ────────────────────────────────────────────────────
export type AccountKind = 'none' | 'anon' | 'google';

export interface AuthState {
  /** false until the first onAuthStateChanged fires — the UI shows nothing yet. */
  ready: boolean;
  kind: AccountKind;
  uid: string;
  email: string | null;
  name: string | null;
}

const state = writable<AuthState>({ ready: false, kind: 'none', uid: '', email: null, name: null });
export const authState: Readable<AuthState> = { subscribe: state.subscribe };

const kindOf = (u: User | null): AccountKind =>
  !u ? 'none' : u.isAnonymous ? 'anon' : 'google';

function publish(u: User | null): void {
  state.set({
    ready: true,
    kind: kindOf(u),
    uid: u?.uid ?? '',
    email: u?.email ?? null,
    name: u?.displayName ?? null
  });
}

let watching = false;
/** Attach the auth listener once. Safe to call repeatedly. */
export function watchAuth(): void {
  if (watching || !arenaConfigured) return;
  watching = true;
  const auth = theAuth();
  // a redirect sign-in (popup-blocked fallback) completes here on the way back
  getRedirectResult(auth).catch(() => {});
  onAuthStateChanged(auth, publish, () => publish(null));
}

/** Resolves once the SDK has told us whether anyone is signed in. */
function currentUser(auth: Auth): Promise<User | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        unsub();
        resolve(u);
      },
      () => {
        unsub();
        resolve(null);
      }
    );
  });
}

// ── Arena handle ─────────────────────────────────────────────────────────────
export interface Arena {
  db: Firestore;
  uid: string;
}

/**
 * Firestore handle + the signed-in uid, signing in anonymously if nobody is.
 *
 * Deliberately NOT memoised on uid: signing in with Google can change it
 * mid-session, and a cached uid would write the new account's data under the
 * old identity. The app/auth objects are singletons, so the cost is one
 * `currentUser` check per call.
 */
export async function getArena(): Promise<Arena> {
  if (!arenaConfigured) throw new Error('arena-unconfigured');
  const auth = theAuth();
  watchAuth();
  let user = await currentUser(auth);
  if (!user) {
    try {
      user = (await signInAnonymously(auth)).user;
    } catch {
      throw new Error('arena-auth-failed');
    }
  }
  return { db: getFirestore(theApp()), uid: user.uid };
}

// ── Google sign-in ───────────────────────────────────────────────────────────
export interface GoogleResult {
  uid: string;
  /**
   * true  — the anonymous account was UPGRADED in place; the uid is unchanged,
   *         so Arena rating, defence and attack history all carry over.
   * false — this Google account already existed (a sign-in from a second
   *         device), so we adopted its uid and `previousUid` was left behind.
   */
  linked: boolean;
  /** The abandoned anonymous uid, when `linked` is false and one existed. */
  previousUid?: string;
}

const isPopupUnavailable = (code: string): boolean =>
  code === 'auth/popup-blocked' ||
  code === 'auth/popup-closed-by-user' ||
  code === 'auth/cancelled-popup-request' ||
  code === 'auth/operation-not-supported-in-this-environment';

const codeOf = (err: unknown): string =>
  typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '';

/**
 * Sign in with Google, preserving the current anonymous identity where possible.
 *
 * The interesting case is the second device. `linkWithPopup` fails with
 * `auth/credential-already-in-use` because that Google account already owns a
 * uid; we then sign in AS that account, which orphans this device's anonymous
 * uid. Its Arena profile and rating cannot be moved — `firestore.rules` only
 * lets the owner write them and the client cannot reassign a document to
 * another uid — so the caller is told (`linked: false`) and warns first.
 */
export async function signInWithGoogle(): Promise<GoogleResult> {
  if (!arenaConfigured) throw new Error('arena-unconfigured');
  const auth = theAuth();
  watchAuth();
  const provider = new GoogleAuthProvider();
  const existing = await currentUser(auth);

  if (existing?.isAnonymous) {
    try {
      const cred = await linkWithPopup(existing, provider);
      return { uid: cred.user.uid, linked: true };
    } catch (err) {
      const code = codeOf(err);
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(err as never);
        if (!credential) throw err;
        const res = await signInWithCredential(auth, credential);
        return { uid: res.user.uid, linked: false, previousUid: existing.uid };
      }
      if (isPopupUnavailable(code)) {
        await linkWithRedirect(existing, provider); // navigates away
        return { uid: existing.uid, linked: true };
      }
      throw err;
    }
  }

  try {
    const res = await signInWithPopup(auth, provider);
    return { uid: res.user.uid, linked: false };
  } catch (err) {
    if (isPopupUnavailable(codeOf(err))) {
      await signInWithRedirect(auth, provider); // navigates away
      return { uid: '', linked: false };
    }
    throw err;
  }
}

/**
 * Sign out of the Google account. Local data is deliberately left alone — the
 * collection stays playable on this device, and the next `getArena()` mints a
 * fresh anonymous identity. See `cloud/sync.ts` for why this is the safe
 * default.
 */
export async function signOutCloud(): Promise<void> {
  if (!arenaConfigured) return;
  await signOut(theAuth());
}
