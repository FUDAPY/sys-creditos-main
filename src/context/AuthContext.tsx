import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, COMPANY_ID } from '../lib/firebase';
import { type User as AppUser } from "../types";
interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: AppUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userData: null,
  loading: true,
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        try {
          // Buscamos el rol y datos del usuario en su empresa
          const userDocRef = doc(db, `companies/${COMPANY_ID}/users`, user.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
            const data = userDocSnap.data() as AppUser;
            if (data.isActive) {
              setUserData(data);
            } else {
              console.warn('Usuario inactivo. Acceso denegado.');
              await signOut(auth);
              setUserData(null);
              setCurrentUser(null);
            }
          } else if (user.email === 'admin@lingroup.com') {
            // Auto-crear usuario ADMIN si es admin@lingroup.com
            const now = Date.now();
            const newAdminUser: AppUser = {
              uid: user.uid,
              email: user.email,
              name: 'Administrador',
              role: 'ADMIN',
              isActive: true,
              companyId: COMPANY_ID,
              createdBy: 'SYSTEM',
              createdAt: now,
              updatedAt: now,
            };
            await setDoc(userDocRef, newAdminUser);
            setUserData(newAdminUser);
          } else {
            setUserData(null);
          }
        } catch (error) {
          console.error("Error al obtener datos del usuario:", error);
          setUserData(null);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ currentUser, userData, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);