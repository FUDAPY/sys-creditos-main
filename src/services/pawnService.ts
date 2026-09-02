import { collection, doc, getDocs, query, where, runTransaction } from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { Loan } from '../types';
import { getLoanFinancialSnapshot } from './loanService';

export const getPawns = async (): Promise<Loan[]> => {
  const loansRef = collection(db, `companies/${COMPANY_ID}/loans`);
  const pawnsQuery = query(
    loansRef,
    where('loanType', '==', 'EMPENO'),
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(pawnsQuery);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Loan));
};

export const getPawnById = async (pawnId: string): Promise<Loan | null> => {
  const snapshot = await getDocs(query(collection(db, `companies/${COMPANY_ID}/loans`), where('id', '==', pawnId)));
  return snapshot.docs.length > 0 ? ({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Loan) : null;
};

export const getPawnFinancialSnapshot = (pawn: Loan, referenceTime = Date.now()) => {
  return getLoanFinancialSnapshot(pawn, referenceTime);
};

export const redeemPawn = async (
  pawnId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const pawnRef = doc(db, `companies/${COMPANY_ID}/loans`, pawnId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const pawnDoc = await transaction.get(pawnRef);
      if (!pawnDoc.exists()) throw new Error('Empeño no encontrado.');

      const pawn = pawnDoc.data() as Loan;
      if (pawn.status === 'PAID') throw new Error('Este empeño ya fue rescatado.');

      transaction.update(pawnRef, {
        status: 'PAID',
        paidAt: Date.now(),
      });

      transaction.set(auditRef, {
        action: 'PAWN_REDEEMED',
        entity: 'PAWN',
        entityId: pawnId,
        changedBy: adminUid,
        timestamp: Date.now(),
        details: { reason: 'Redemption' },
      });
    });

    return { success: true, message: 'Empeño rescatado exitosamente.' };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Error al redimir empeño' };
  }
};

export const extendPawnRedemptionPeriod = async (
  pawnId: string,
  extensionDays: number,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const pawnRef = doc(db, `companies/${COMPANY_ID}/loans`, pawnId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const pawnDoc = await transaction.get(pawnRef);
      if (!pawnDoc.exists()) throw new Error('Empeño no encontrado.');

      const pawn = pawnDoc.data() as Loan;
      const newExpiresAt = new Date(pawn.expiresAt).getTime() + extensionDays * 24 * 60 * 60 * 1000;

      transaction.update(pawnRef, {
        expiresAt: newExpiresAt,
      });

      transaction.set(auditRef, {
        action: 'PAWN_EXTENDED',
        entity: 'PAWN',
        entityId: pawnId,
        changedBy: adminUid,
        timestamp: Date.now(),
        details: { extensionDays, newExpiresAt },
      });
    });

    return { success: true, message: `Plazo de empeño extendido por ${extensionDays} días.` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al extender plazo de empeño',
    };
  }
};
