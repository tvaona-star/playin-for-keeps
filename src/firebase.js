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

/** Load declared keepers for a season: { teams: { ownerName: [playerName] } } */
export async function loadDeclarations(season) {
  const [{ getFirestore, doc, getDoc }, a] = await Promise.all([
    import('firebase/firestore'), app(),
  ])
  const snap = await getDoc(doc(getFirestore(a), 'declarations', String(season)))
  return snap.exists() ? snap.data() : { teams: {} }
}

/** Save one team's declared keepers for a season. */
export async function saveDeclaration(season, ownerName, playerNames) {
  const [{ getFirestore, doc, setDoc }, a] = await Promise.all([
    import('firebase/firestore'), app(),
  ])
  await setDoc(
    doc(getFirestore(a), 'declarations', String(season)),
    { teams: { [ownerName]: playerNames }, updated: new Date().toISOString() },
    { merge: true }
  )
}
