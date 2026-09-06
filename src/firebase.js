/**
 * Lazy Firebase wrapper. The SDK chunks only load if firebaseConfig is set,
 * so the read-only site ships no Firebase code to visitors.
 */
import { firebaseConfig } from './firebase-config.js'

export const firebaseEnabled = !!firebaseConfig

let appPromise = null
async function app() {
  if (!firebaseEnabled) throw new Error('Firebase is not configured')
  if (!appPromise) {
    appPromise = import('firebase/app').then(({ initializeApp }) => initializeApp(firebaseConfig))
  }
  return appPromise
}

export async function signIn(email, password) {
  const [{ getAuth, signInWithEmailAndPassword }, a] = await Promise.all([
    import('firebase/auth'), app(),
  ])
  const cred = await signInWithEmailAndPassword(getAuth(a), email, password)
  return cred.user
}

export async function signOutUser() {
  const [{ getAuth, signOut }, a] = await Promise.all([import('firebase/auth'), app()])
  await signOut(getAuth(a))
}

/**
 * Declarations document shape — declarations/{season}:
 * {
 *   status: 'draft' | 'published',
 *   publishedAt: ISO | null,
 *   teams: {
 *     "Tyler Vaona": {
 *       keepers: [{ name, pos, autoRound, round, adjusted }],
 *       updated: ISO
 *     }
 *   }
 * }
 * Readable by anyone; writable only by the commissioner (Firestore rules).
 */
export async function loadDeclarations(season) {
  const [{ getFirestore, doc, getDoc }, a] = await Promise.all([
    import('firebase/firestore'), app(),
  ])
  const snap = await getDoc(doc(getFirestore(a), 'declarations', String(season)))
  if (!snap.exists()) return { status: 'draft', publishedAt: null, teams: {} }
  const d = snap.data()
  return { status: d.status || 'draft', publishedAt: d.publishedAt || null, teams: d.teams || {} }
}

/** Save one team's declared keepers (with any manual round adjustments). */
export async function saveTeamDeclaration(season, ownerName, keepers) {
  const [{ getFirestore, doc, setDoc }, a] = await Promise.all([
    import('firebase/firestore'), app(),
  ])
  await setDoc(
    doc(getFirestore(a), 'declarations', String(season)),
    {
      teams: { [ownerName]: { keepers, updated: new Date().toISOString() } },
      updated: new Date().toISOString(),
    },
    { merge: true }
  )
}

/**
 * Publish (or unpublish) the season's declarations. Only published
 * declarations are shown to the league on the Keeper Selections page.
 */
export async function setPublishStatus(season, status) {
  const [{ getFirestore, doc, setDoc }, a] = await Promise.all([
    import('firebase/firestore'), app(),
  ])
  await setDoc(
    doc(getFirestore(a), 'declarations', String(season)),
    {
      status,
      publishedAt: status === 'published' ? new Date().toISOString() : null,
      updated: new Date().toISOString(),
    },
    { merge: true }
  )
}

/** Public read used by the league-facing Keeper Selections page. */
export async function loadPublishedDeclarations(season) {
  const d = await loadDeclarations(season)
  return d.status === 'published' ? d : null
}
