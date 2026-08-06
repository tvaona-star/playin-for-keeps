/**
 * Firebase web-app config.
 *
 * The site works fully read-only without this. To enable the Commissioner
 * Console (declarations + overrides written to Firestore):
 *
 *   1. Firebase console -> Project settings -> Your apps -> Web app
 *   2. Paste the config object below (apiKey, authDomain, projectId, ...)
 *   3. Enable Email/Password auth and create the commissioner account
 *   4. Apply the Firestore security rules from README.md
 *
 * The web config is not a secret — security comes from Firestore rules.
 */
export const firebaseConfig = null

/* Example:
export const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "…",
  appId: "…",
}
*/
