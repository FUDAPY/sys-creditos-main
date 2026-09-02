import { collection, doc, getDocs, query, where, runTransaction } from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { Loan } from '../types';
import { getLoanFinancialSnapshot } from './loanService';

export const getServiceProvisions = async (): Promise<Loan[]> => {
  const loansRef = collection(db, `companies/${COMPANY_ID}/loans`);
  const servicesQuery = query(
    loansRef,
    where('loanType', '==', 'PRESTACION_SERVICIOS'),
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(servicesQuery);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Loan));
};

export const getServiceProvisionById = async (serviceId: string): Promise<Loan | null> => {
  const snapshot = await getDocs(query(collection(db, `companies/${COMPANY_ID}/loans`), where('id', '==', serviceId)));
  return snapshot.docs.length > 0 ? ({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Loan) : null;
};

export const getServiceFinancialSnapshot = (service: Loan, referenceTime = Date.now()) => {
  return getLoanFinancialSnapshot(service, referenceTime);
};

export const recordServiceDelivery = async (
  serviceId: string,
  deliveryDate: number,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const serviceRef = doc(db, `companies/${COMPANY_ID}/loans`, serviceId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const serviceDoc = await transaction.get(serviceRef);
      if (!serviceDoc.exists()) throw new Error('Servicio no encontrado.');

      const service = serviceDoc.data() as Loan;
      if (service.status === 'PAID') throw new Error('Este servicio ya fue completado.');

      transaction.update(serviceRef, {
        serviceDeliveredAt: deliveryDate,
      });

      transaction.set(auditRef, {
        action: 'SERVICE_DELIVERED',
        entity: 'SERVICE',
        entityId: serviceId,
        changedBy: adminUid,
        timestamp: Date.now(),
        details: { deliveryDate },
      });
    });

    return { success: true, message: 'Entrega de servicio registrada.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al registrar entrega de servicio',
    };
  }
};

export const completeServiceProvision = async (
  serviceId: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const serviceRef = doc(db, `companies/${COMPANY_ID}/loans`, serviceId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const serviceDoc = await transaction.get(serviceRef);
      if (!serviceDoc.exists()) throw new Error('Servicio no encontrado.');

      transaction.update(serviceRef, {
        status: 'PAID',
        completedAt: Date.now(),
      });

      transaction.set(auditRef, {
        action: 'SERVICE_COMPLETED',
        entity: 'SERVICE',
        entityId: serviceId,
        changedBy: adminUid,
        timestamp: Date.now(),
      });
    });

    return { success: true, message: 'Prestación de servicio completada.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al completar prestación de servicio',
    };
  }
};

export const updateServiceDescription = async (
  serviceId: string,
  description: string,
  adminUid: string
): Promise<{ success: boolean; message: string }> => {
  const serviceRef = doc(db, `companies/${COMPANY_ID}/loans`, serviceId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  try {
    await runTransaction(db, async (transaction) => {
      const serviceDoc = await transaction.get(serviceRef);
      if (!serviceDoc.exists()) throw new Error('Servicio no encontrado.');

      transaction.update(serviceRef, {
        description,
      });

      transaction.set(auditRef, {
        action: 'SERVICE_DESCRIPTION_UPDATED',
        entity: 'SERVICE',
        entityId: serviceId,
        changedBy: adminUid,
        timestamp: Date.now(),
        details: { description },
      });
    });

    return { success: true, message: 'Descripción de servicio actualizada.' };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error al actualizar descripción de servicio',
    };
  }
};
