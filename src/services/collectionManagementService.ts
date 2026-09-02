import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { CollectionManagement, Loan, User } from '../types';

const startOfDay = (timestamp: number) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const getCollectionManagementId = (loanId: string, dueDate: number) =>
  `${loanId}_${startOfDay(dueDate)}`;

export const getLoanDueDateForManagement = (loan: Pick<Loan, 'nextDueDate' | 'expiresAt'>) =>
  startOfDay(loan.nextDueDate || loan.expiresAt);

export const loadCollectionManagements = async (collectorId?: string) => {
  const baseRef = collection(db, `companies/${COMPANY_ID}/collectionManagements`);
  const managementQuery = collectorId
    ? query(baseRef, where('collectorId', '==', collectorId))
    : query(baseRef);

  const snapshot = await getDocs(managementQuery);
  const managements = new Map<string, CollectionManagement>();

  snapshot.docs.forEach((item) => {
    const data = { id: item.id, ...(item.data() as CollectionManagement) };
    managements.set(item.id, data);
  });

  return managements;
};

export const markCollectionAsManaged = async (loan: Loan, user: User) => {
  const dueDate = getLoanDueDateForManagement(loan);
  const id = getCollectionManagementId(loan.id!, dueDate);
  const now = Date.now();
  const payload: CollectionManagement = {
    id,
    companyId: COMPANY_ID,
    loanId: loan.id!,
    clientId: loan.clientId,
    collectorId: loan.collectorId,
    collectorName: loan.collectorName,
    dueDate,
    status: 'MANAGED',
    managedAt: now,
    managedBy: user.uid,
    managedByName: user.name,
    createdAt: now,
    updatedAt: now,
    createdBy: user.uid,
  };

  await setDoc(doc(db, `companies/${COMPANY_ID}/collectionManagements`, id), payload, {
    merge: true,
  });
};

export const markCollectionAsContacted = async (loan: Loan, user: User) => {
  const dueDate = getLoanDueDateForManagement(loan);
  const id = getCollectionManagementId(loan.id!, dueDate);
  const now = Date.now();

  await setDoc(
    doc(db, `companies/${COMPANY_ID}/collectionManagements`, id),
    {
      id,
      companyId: COMPANY_ID,
      loanId: loan.id!,
      clientId: loan.clientId,
      collectorId: loan.collectorId,
      collectorName: loan.collectorName,
      dueDate,
      contactedAt: now,
      contactedBy: user.uid,
      contactedByName: user.name,
      updatedAt: now,
      createdAt: now,
      createdBy: user.uid,
    } as Partial<CollectionManagement>,
    { merge: true }
  );
};
