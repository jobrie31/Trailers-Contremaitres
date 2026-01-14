// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Analytics (optionnel, web seulement)
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBR02O8GCYAIzl5Nc4nlXrXVXCnPIrE1AE",
  authDomain: "trailer-contremaitres.firebaseapp.com",
  projectId: "trailer-contremaitres",
  storageBucket: "trailer-contremaitres.firebasestorage.app",
  messagingSenderId: "276721282605",
  appId: "1:276721282605:web:183d8afd9ca3d04b8612a4",
  measurementId: "G-R8T2X45Y6N",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Optionnel: analytics (ne plante pas si non supporté)
export let analytics = null;
isSupported().then((ok) => {
  if (ok) analytics = getAnalytics(app);
});
