import { collection, doc, getDocs, query, where, runTransaction } from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { Loan } from '../types';
import { getLoanFinancialSnapshot } from './loanService';

export const getRentals = async (): Promise<Loan[]> => {
  const loansRef = collection(db, `companies/${COMPANY_ID}/loans`);
  const rentalsQuery = query(
    loansRef,
    where('loanType', '==', 'ALQUILER_INMUEBLE'),
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(rentalsQuery);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Loan));
};

export const getRentalById = async (rentalId: string): Promise<Loan | null> => {
  const snapshot = await getDocs(query(collection(db, `companies/${COMPANY_ID}/loans`), where('id', '==', rentalId)));
  return snapshot.docs.length > 0 ? ({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Loan) : null;
};

export const getRentalFinancialSnapshot = (rental: Loan, referenceTime = Date.now()) => {
  return getLoanFinancialSnapshot(rental, referenceTime);
};

export const renewRental = async (
  rentalId: string,
  renewalMonths: number,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const rentalRef = doc(db, `companies/${COMPANY_ID}/loans`, rentalId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const rentalDoc = await transaction.get(rentalRef);
      if (!rentalDoc.exists()) throw new Error('Alquiler no encontrado.');

      const rental = rentalDoc.data() as Loan;
      if (rental.status === 'PAID') throw new Error('Este alquiler ya fue completado.');

      // Calculate new expiration date adding months
      const currentExpiry = new Date(rental.expiresAt);
      const newExpiry = new Date(currentExpiry);
      newExpiry.setMonth(newExpiry.getMonth() + renewalMonths);

      transaction.update(rentalRef, {
        expiresAt: newExpiry.getTime(),
      });

      transaction.set(auditRef, {
        action: 'RENTAL_RENEWED',
        entity: 'RENTAL',
        entityId: rentalId,
        changedBy: adminUid,
        timestamp: Date.now(),
        details: { renewalMonths, newExpiresAt: newExpiry.getTime() },
      });
    });

    return { success: true, message: `Alquiler renovado por ${renewalMonths} meses.` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al renovar alquiler',
    };
  }
};

export const recordRentalPayment = async (
  rentalId: string,
  periodMonthCount: number,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const rentalRef = doc(db, `companies/${COMPANY_ID}/loans`, rentalId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const rentalDoc = await transaction.get(rentalRef);
      if (!rentalDoc.exists()) throw new Error('Alquiler no encontrado.');

      transaction.update(rentalRef, {
        paidCycles: (rentalDoc.data().paidCycles || 0) + periodMonthCount,
      });

      transaction.set(auditRef, {
        action: 'RENTAL_PAYMENT_RECORDED',
        entity: 'RENTAL',
        entityId: rentalId,
        changedBy: adminUid,
        timestamp: Date.now(),
        details: { periodMonthCount },
      });
    });

    return { success: true, message: `Pago de alquiler registrado (${periodMonthCount} mes/meses).` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al registrar pago de alquiler',
    };
  }
};

export const terminateRental = async (
  rentalId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const rentalRef = doc(db, `companies/${COMPANY_ID}/loans`, rentalId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const rentalDoc = await transaction.get(rentalRef);
      if (!rentalDoc.exists()) throw new Error('Alquiler no encontrado.');

      transaction.update(rentalRef, {
        status: 'PAID',
        terminatedAt: Date.now(),
      });

      transaction.set(auditRef, {
        action: 'RENTAL_TERMINATED',
        entity: 'RENTAL',
        entityId: rentalId,
        changedBy: adminUid,
        timestamp: Date.now(),
      });
    });

    return { success: true, message: 'Alquiler terminado exitosamente.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al terminar alquiler',
    };
  }
};
