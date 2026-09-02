import { httpsCallable } from 'firebase/functions';
import { auth, db, COMPANY_ID, functions } from '../lib/firebase';
import { collection, doc, getDoc, getDocsFromServer, setDoc, writeBatch } from 'firebase/firestore';
import type { Loan, User } from '../types';

export interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role: 'ADMIN' | 'COLLECTOR';
}

const DAY_MS = 1000 * 60 * 60 * 24;
const DEFAULT_INTEREST_RATE = 20;
const DEFAULT_CYCLE_DAYS = 30;

const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY || '';

function normalizeTimestampToUtcNoon(timestamp: number | undefined | null) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp as number);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    12,
    0,
    0,
    0
  );
}

function getLoanCycleDays(loan: Partial<Loan>) {
  if (Number.isFinite(loan.cycleDays) && (loan.cycleDays as number) > 0) {
    return loan.cycleDays as number;
  }

  if (Number.isFinite(loan.grantedAt) && Number.isFinite(loan.expiresAt)) {
    const derivedDays = Math.round(((loan.expiresAt as number) - (loan.grantedAt as number)) / DAY_MS);
    if (derivedDays > 0) {
      return derivedDays;
    }
  }

  return DEFAULT_CYCLE_DAYS;
}

function getCalendarMonthSpanFromDays(days: number) {
  return Math.max(1, Math.round((days || DEFAULT_CYCLE_DAYS) / 30));
}

function addUtcMonthsPreservingDay(timestamp: number, months: number) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0, 0)).getUTCDate();

  return Date.UTC(year, monthIndex, Math.min(day, lastDay), 12, 0, 0, 0);
}

function calculateInterestAmount(loan: Partial<Loan>) {
  if (loan.loanType === 'ALQUILER_INMUEBLE' || loan.loanType === 'PRESTACION_SERVICIOS') {
    return 0;
  }
  const principal = Number.isFinite(loan.principal) ? (loan.principal as number) : 0;
  const interestRate =
    Number.isFinite(loan.interestRate) && (loan.interestRate as number) >= 0
      ? (loan.interestRate as number)
      : DEFAULT_INTEREST_RATE;

  return Math.round(principal * (interestRate / 100));
}

function normalizePrincipalBalance(loan: Partial<Loan>) {
  const principal = Number.isFinite(loan.principal) ? (loan.principal as number) : 0;
  const currentBalance = Number.isFinite(loan.currentBalance) ? (loan.currentBalance as number) : principal;
  return Math.max(0, Math.min(currentBalance, principal));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function createUser(data: CreateUserData, createdByUid: string) {
  try {
    const normalizedEmail = data.email.trim().toLowerCase();
    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: data.password,
          returnSecureToken: true,
        }),
      }
    );

    if (!authResponse.ok) {
      const errorData = await authResponse.json();
      const errorMessage = errorData.error?.message || 'UNKNOWN_ERROR';

      if (errorMessage.includes('EMAIL_EXISTS')) {
        throw new Error('Este email ya esta registrado en el sistema.');
      }
      if (errorMessage.includes('INVALID_EMAIL')) {
        throw new Error('El email no es valido.');
      }
      if (errorMessage.includes('WEAK_PASSWORD')) {
        throw new Error('La contrasena es demasiado debil.');
      }

      throw new Error(`Error en Firebase Auth: ${errorMessage}`);
    }

    const authData = await authResponse.json();
    const uid = authData.localId;
    const now = Date.now();

    const userDoc: User = {
      uid,
      email: normalizedEmail,
      name: data.name,
      role: data.role,
      isActive: true,
      companyId: COMPANY_ID,
      createdBy: createdByUid,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(doc(db, `companies/${COMPANY_ID}/users`, uid), userDoc);
    return userDoc;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error al crear el usuario.');
  }
}

export async function getActiveUsers() {
  try {
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const usersRef = collection(db, `companies/${COMPANY_ID}/users`);
    const usersQuery = query(usersRef, where('isActive', '==', true));
    const querySnapshot = await getDocs(usersQuery);

    const users: Array<User & { uid: string }> = [];
    querySnapshot.forEach((docItem) => {
      users.push({
        ...(docItem.data() as User),
        uid: docItem.id,
      });
    });

    return users.sort((left, right) => left.name.localeCompare(right.name, 'es'));
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    throw new Error('Error al obtener usuarios.');
  }
}

export async function updateUserProfile(uid: string, name: string) {
  try {
    const now = Date.now();

    await setDoc(
      doc(db, `companies/${COMPANY_ID}/users`, uid),
      {
        name,
        updatedAt: now,
      },
      { merge: true }
    );

    return { uid, name, updatedAt: now };
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    throw new Error('Error al actualizar el nombre del usuario.');
  }
}

export async function adminSetUserPassword(uid: string, newPassword: string) {
  try {
    const callable = httpsCallable<
      { uid: string; newPassword: string },
      { success: boolean; message: string }
    >(functions, 'adminSetUserPassword');

    const result = await callable({ uid, newPassword: newPassword.trim() });
    return result.data;
  } catch (error) {
    console.error('Error al cambiar contraseña de usuario:', error);
    throw new Error('No se pudo actualizar la contraseña del usuario desde administracion.');
  }
}

export async function adminRebuildLoans(apply = false) {
  try {
    const currentUid = auth.currentUser?.uid;

    if (!currentUid) {
      throw new Error('Debes iniciar sesion para ejecutar el regrabado.');
    }

    const currentUserRef = doc(db, `companies/${COMPANY_ID}/users`, currentUid);
    const currentUserSnapshot = await getDoc(currentUserRef);
    const currentUser = currentUserSnapshot.data() as User | undefined;

    if (!currentUser || currentUser.role !== 'ADMIN' || currentUser.isActive !== true) {
      throw new Error('Solo los administradores pueden ejecutar el regrabado.');
    }

    const now = Date.now();
    const loansSnapshot = await getDocsFromServer(collection(db, `companies/${COMPANY_ID}/loans`));
    const updates: Array<{
      id: string;
      refPath: string;
      clientId: string | null;
      data: Record<string, unknown>;
      changedKeys: string[];
    }> = [];
    const samples: Array<{ id: string; clientId: string | null; changedKeys: string[] }> = [];

    loansSnapshot.forEach((loanDoc) => {
      const loan = loanDoc.data() as Partial<Loan>;
      const cycleDays = getLoanCycleDays(loan);
      const cycleMonths = getCalendarMonthSpanFromDays(cycleDays);
      const grantedAtSource =
        (loan.grantedAt as number | undefined) ||
        (loan.creditDate as number | undefined) ||
        (loan.createdAt as number | undefined) ||
        now;
      const grantedAt = normalizeTimestampToUtcNoon(grantedAtSource) || normalizeTimestampToUtcNoon(now)!;
      let expiresAt = addUtcMonthsPreservingDay(grantedAt, cycleMonths);

      if (expiresAt <= grantedAt) {
        expiresAt = addUtcMonthsPreservingDay(grantedAt, 1);
      }

      const principalBalance = normalizePrincipalBalance(loan);
      const interestPerCycle = calculateInterestAmount(loan);
      const hasAnyPayment =
        ((Number.isFinite(loan.paidAmount) ? (loan.paidAmount as number) : 0) > 0) ||
        ((Number.isFinite(loan.interestPaidAmount) ? (loan.interestPaidAmount as number) : 0) > 0);
      const nextDueDate = expiresAt;
      const lastAccruedAt =
        !hasAnyPayment
          ? expiresAt
          : normalizeTimestampToUtcNoon((loan.lastAccruedAt as number | undefined) || expiresAt) || expiresAt;
      const totalInterestPaid = Math.max(
        0,
        Number.isFinite(loan.interestPaidAmount) ? (loan.interestPaidAmount as number) : 0
      );
      const accruedInterestBalance =
        principalBalance > 0 ? Math.max(0, interestPerCycle - totalInterestPaid) : 0;
      const accruedLateFeeBalance = 0;

      const status =
        principalBalance <= 0 && accruedInterestBalance <= 0 && accruedLateFeeBalance <= 0
          ? 'PAID'
          : loan.status === 'FROZEN'
            ? 'FROZEN'
            : loan.status || 'ACTIVE';

      const nextData = {
        grantedAt,
        creditDate: grantedAt,
        expiresAt,
        cycleDays,
        currentBalance: principalBalance,
        accruedInterestBalance,
        accruedLateFeeBalance,
        nextDueDate,
        lastAccruedAt,
        totalAmount: principalBalance + accruedInterestBalance + accruedLateFeeBalance,
        status,
        updatedAt: now,
      };

      const changedKeys = Object.entries(nextData)
        .filter(([key, value]) => loan[key as keyof Loan] !== value)
        .map(([key]) => key);

      if (changedKeys.length > 0) {
        updates.push({
          id: loanDoc.id,
          refPath: `companies/${COMPANY_ID}/loans/${loanDoc.id}`,
          clientId: typeof loan.clientId === 'string' ? loan.clientId : null,
          data: nextData,
          changedKeys,
        });

        if (samples.length < 10) {
          samples.push({
            id: loanDoc.id,
            clientId: typeof loan.clientId === 'string' ? loan.clientId : null,
            changedKeys,
          });
        }
      }
    });

    if (apply && updates.length > 0) {
      const groups = chunkArray(updates, 350);

      for (const group of groups) {
        const batch = writeBatch(db);

        group.forEach((item) => {
          batch.update(doc(db, item.refPath), item.data);
        });

        const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));
        batch.set(auditRef, {
          companyId: COMPANY_ID,
          action: 'ADMIN_REBUILD_LOANS_APPLY',
          entity: 'LOAN',
          entityId: 'bulk',
          details: JSON.stringify({
            batchSize: group.length,
            sampleIds: group.slice(0, 20).map((item) => item.id),
            executedBy: currentUser.email || currentUser.name || currentUid,
          }),
          createdBy: currentUid,
          createdAt: now,
          updatedAt: now,
        });

        await batch.commit();
      }
    } else {
      await setDoc(doc(collection(db, `companies/${COMPANY_ID}/auditLogs`)), {
        companyId: COMPANY_ID,
        action: 'ADMIN_REBUILD_LOANS_PREVIEW',
        entity: 'LOAN',
        entityId: 'bulk',
        details: JSON.stringify({
          totalLoans: loansSnapshot.size,
          changedLoans: updates.length,
          sampleIds: samples.map((item) => item.id),
          executedBy: currentUser.email || currentUser.name || currentUid,
        }),
        createdBy: currentUid,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      success: true,
      applyChanges: apply,
      totalLoans: loansSnapshot.size,
      changedLoans: updates.length,
      samples,
    };
  } catch (error) {
    console.error('Error al regrabar creditos:', error);
    throw new Error('No se pudo ejecutar el regrabado de creditos.');
  }
}

export async function adminSyncFinancialMovements(apply = false) {
  try {
    const callable = httpsCallable<
      { apply: boolean },
      {
        success: boolean;
        applyChanges: boolean;
        branchId: string;
        branchName: string;
        incomesCount: number;
        expensesCount: number;
      }
    >(functions, 'adminSyncFinancialMovements');

    const result = await callable({ apply });
    return result.data;
  } catch (error) {
    console.error('Error al sincronizar financiero:', error);
    throw new Error('No se pudo sincronizar con el Firebase financiero.');
  }
}

export async function syncFinancialPayment(paymentId: string) {
  try {
    const callable = httpsCallable<
      { paymentId: string },
      { success: boolean; synced: boolean; deleted: boolean; paymentId: string }
    >(functions, 'syncFinancialPayment');

    const result = await callable({ paymentId });
    return result.data;
  } catch (error) {
    console.error('Error al sincronizar pago financiero:', error);
    throw new Error('No se pudo sincronizar el ingreso financiero.');
  }
}

export async function syncFinancialLoan(loanId: string) {
  try {
    const callable = httpsCallable<
      { loanId: string },
      { success: boolean; synced: boolean; deleted: boolean; loanId: string }
    >(functions, 'syncFinancialLoan');

    const result = await callable({ loanId });
    return result.data;
  } catch (error) {
    console.error('Error al sincronizar credito financiero:', error);
    throw new Error('No se pudo sincronizar el egreso financiero.');
  }
}

export async function syncPosInboundUsers() {
  const callable = httpsCallable<undefined, { success: boolean; replicatedCount: number; clientsCount: number; paymentsCount: number }>(
    functions,
    'syncPosInboundUsers'
  );
  const result = await callable(undefined);
  return result.data;
}

export async function syncJuridicoInboundCredits() {
  const callable = httpsCallable<undefined, { success: boolean; replicatedCount: number; clientsCount: number; paymentsCount: number }>(
    functions,
    'syncJuridicoInboundCredits'
  );
  const result = await callable(undefined);
  return result.data;
}

export async function deactivateUser(uid: string) {
  try {
    const now = Date.now();

    await setDoc(
      doc(db, `companies/${COMPANY_ID}/users`, uid),
      {
        isActive: false,
        updatedAt: now,
      },
      { merge: true }
    );

    return { uid, isActive: false, updatedAt: now };
  } catch (error) {
    console.error('Error al desactivar usuario:', error);
    throw new Error('Error al desactivar el usuario.');
  }
}
