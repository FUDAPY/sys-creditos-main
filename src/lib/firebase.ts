import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyA_yQjBTGDLNe54GlQ8caNV9BjOCukzTjI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "sys-creditos-lingroup.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "sys-creditos-lingroup",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "sys-creditos-lingroup.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "107630664084",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:107630664084:web:532c7c3f59ae63a7c61781",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-KFYZZ8ZZGZ"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'southamerica-east1');
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

// Hardcodeamos el ID de la empresa por ahora para evitar errores si falta el .env
export const COMPANY_ID = "lin_group_sa_001";
