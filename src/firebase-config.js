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
/** Commissioner sign-in: the console shows only a password box; this email is
 *  the account it signs into behind the scenes. */
export const commissionerEmail = 'tvaona@yahoo.com'

export const firebaseConfig = {
  apiKey: 'AIzaSyCw-jNQAkfW1E39DS2lbLqPXI8ERqgMX6A',
  authDomain: 'playin-for-keeps.firebaseapp.com',
  projectId: 'playin-for-keeps',
  storageBucket: 'playin-for-keeps.firebasestorage.app',
  messagingSenderId: '408730713096',
  appId: '1:408730713096:web:0f832a414a183648e565bd',
}
