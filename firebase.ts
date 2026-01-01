import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, doc, setDoc, getDoc, collection, updateDoc, deleteDoc, onSnapshot, getDocs, query, where } from "firebase/firestore";
import { getDatabase, ref, set, get, onValue, update, remove } from "firebase/database";
import { getAuth, onAuthStateChanged } from "firebase/auth";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDNAarkY9MquMpJzKuXt4BayK6AHGImyr0",
  authDomain: "dec2025-96ecd.firebaseapp.com",
  projectId: "dec2025-96ecd",
  storageBucket: "dec2025-96ecd.firebasestorage.app",
  messagingSenderId: "617035489092",
  appId: "1:617035489092:web:cf470004dfcb97e41cc111",
  databaseURL: "https://dec2025-96ecd-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);

// --- HELPER: ADMIN CHECK (Internal Use) ---
const verifyAdmin = async (uid) => {
    if (!uid) return false;
    const userSnap = await getDoc(doc(db, "users", uid));
    return userSnap.exists() && userSnap.data().role === 'ADMIN';
};

// --- EXPORTED HELPERS ---

export const checkFirebaseConnection = () => true;

export const subscribeToAuth = (callback) => {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
        // चेक करें कि क्या लॉगिन करने वाला एडमिन है
        const isAdmin = await verifyAdmin(user.uid);
        callback({ ...user, isAdmin });
    } else {
        callback(null);
    }
  });
};

// --- 1. USER DATA SYNC ---
export const saveUserToLive = async (user) => {
  try {
    if (!user || !user.id) return;
    
    // नए यूजर को डिफ़ॉल्ट 'STUDENT' रोल देना
    const userData = {
        ...user,
        role: user.role || 'STUDENT',
        lastUpdated: new Date().toISOString()
    };

    // Dual Write logic
    await Promise.all([
        set(ref(rtdb, `users/${user.id}`), userData),
        setDoc(doc(db, "users", user.id), userData)
    ]);
  } catch (error) {
    console.error("Error saving user:", error);
  }
};

export const subscribeToUsers = (callback) => {
  const q = collection(db, "users");
  return onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => doc.data());
      if (users.length > 0) {
          callback(users);
      } else {
          onValue(ref(rtdb, 'users'), (snap) => {
             const data = snap.val();
             callback(data ? Object.values(data) : []);
          }, { onlyOnce: true });
      }
  });
};

export const getUserData = async (userId) => {
    try {
        const snap = await get(ref(rtdb, `users/${userId}`));
        if (snap.exists()) return snap.val();
        
        const docSnap = await getDoc(doc(db, "users", userId));
        return docSnap.exists() ? docSnap.data() : null;
    } catch (e) { return null; }
};

export const getUserByEmail = async (email) => {
    try {
        const q = query(collection(db, "users"), where("email", "==", email));
        const querySnapshot = await getDocs(q);
        return !querySnapshot.empty ? querySnapshot.docs[0].data() : null; 
    } catch (e) { return null; }
};

// --- 2. SYSTEM SETTINGS (Admin Only) ---
export const saveSystemSettings = async (settings) => {
  try {
    const isAdmin = await verifyAdmin(auth.currentUser?.uid);
    if (!isAdmin) throw new Error("Permission Denied: Admin role required");

    await Promise.all([
        set(ref(rtdb, 'system_settings'), settings),
        setDoc(doc(db, "config", "system_settings"), settings)
    ]);
  } catch (error) {
    console.error("Error saving settings:", error);
    alert(error.message);
  }
};

export const subscribeToSettings = (callback) => {
  return onSnapshot(doc(db, "config", "system_settings"), (docSnap) => {
      if (docSnap.exists()) {
          callback(docSnap.data());
      } else {
           onValue(ref(rtdb, 'system_settings'), (snap) => {
               if (snap.val()) callback(snap.val());
           }, { onlyOnce: true });
      }
  });
};

// --- 3. CONTENT & BULK UPLOADS (Admin Protected) ---
export const bulkSaveLinks = async (updates) => {
  try {
    const isAdmin = await verifyAdmin(auth.currentUser?.uid);
    if (!isAdmin) throw new Error("Permission Denied");

    // RTDB Update
    await update(ref(rtdb, 'content_links'), updates);
    
    // Firestore Batch-like update
    const promises = Object.entries(updates).map(([key, data]) => 
        setDoc(doc(db, "content_data", key), data)
    );
    await Promise.all(promises);
  } catch (error) {
    console.error("Bulk upload error:", error);
  }
};

export const saveChapterData = async (key, data) => {
  try {
    const isAdmin = await verifyAdmin(auth.currentUser?.uid);
    if (!isAdmin) throw new Error("Permission Denied");

    await Promise.all([
        set(ref(rtdb, `content_data/${key}`), data),
        setDoc(doc(db, "content_data", key), data)
    ]);
  } catch (error) {
    console.error("Chapter Save Error:", error);
  }
};

// --- 4. STUDENT DATA & RESULTS ---
export const saveTestResult = async (userId, attempt) => {
    try {
        const docId = `${attempt.testId}_${Date.now()}`;
        // Student can only write to their own results sub-collection
        await setDoc(doc(db, "users", userId, "test_results", docId), attempt);
    } catch(e) { console.error("Test result failed:", e); }
};

export const updateUserStatus = async (userId, time) => {
     try {
        const userRef = ref(rtdb, `users/${userId}`);
        await update(userRef, { 
            lastActiveTime: new Date().toISOString(),
            isOnline: true 
        });
    } catch (error) { }
};

// --- READ HELPERS ---
export const getChapterData = async (key) => {
    const snapshot = await get(ref(rtdb, `content_data/${key}`));
    if (snapshot.exists()) return snapshot.val();
    const docSnap = await getDoc(doc(db, "content_data", key));
    return docSnap.exists() ? docSnap.data() : null;
};

export const subscribeToChapterData = (key, callback) => {
    return onValue(ref(rtdb, `content_data/${key}`), (snapshot) => {
        if (snapshot.exists()) callback(snapshot.val());
        else {
            getDoc(doc(db, "content_data", key)).then(snap => {
                if (snap.exists()) callback(snap.data());
            });
        }
    });
};

export { app, db, rtdb, auth };
