import { collection, doc, setDoc, getDocs, query, orderBy, where, writeBatch } from 'firebase/firestore';
import { db, COMPANY_ID } from '../lib/firebase';
import { type Client, type User } from '../types';

const getClientsRef = () => collection(db, `companies/${COMPANY_ID}/clients`);
const normalizeSearchText = (value?: string) => (value || '').trim().toLocaleLowerCase('es');
const normalizeDigits = (value?: string) => (value || '').replace(/\D/g, '');

export const createClient = async (
  clientData: Omit<Client, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'createdBy'>,
  adminUid: string
) => {
  const newClientRef = doc(getClientsRef());
  const now = Date.now();

  const newClient: Client = {
    ...clientData,
    fullName: clientData.fullName.trim(),
    fullNameLower: normalizeSearchText(clientData.fullName),
    documentId: clientData.documentId.trim(),
    documentSearch: normalizeDigits(clientData.documentId),
    phone: clientData.phone.trim(),
    phoneSearch: normalizeDigits(clientData.phone),
    id: newClientRef.id,
    companyId: COMPANY_ID,
    createdAt: now,
    updatedAt: now,
    createdBy: adminUid,
  };

  await setDoc(newClientRef, newClient);
  return newClient;
};

export const getClients = async (): Promise<Client[]> => {
  const q = query(getClientsRef(), orderBy('fullName', 'asc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => doc.data() as Client);
};

export const getClientsForUser = async (_userData: User): Promise<Client[]> => {
  const baseRef = getClientsRef();
  const q = query(baseRef, orderBy('fullName', 'asc'));

  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((doc) => doc.data() as Client)
    .sort((left, right) => left.fullName.localeCompare(right.fullName, 'es'));
};

export const reassignClientCollector = async (
  clientId: string,
  collectorId: string,
  collectorName: string,
  adminUid: string
) => {
  const now = Date.now();
  const batch = writeBatch(db);
  const clientRef = doc(db, `companies/${COMPANY_ID}/clients`, clientId);
  const loansSnap = await getDocs(
    query(collection(db, `companies/${COMPANY_ID}/loans`), where('clientId', '==', clientId))
  );
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  batch.set(
    clientRef,
    {
      collectorId,
      collectorName,
      updatedAt: now,
    },
    { merge: true }
  );

  loansSnap.docs.forEach((loanDoc) => {
    const loan = loanDoc.data();
    if (loan.status !== 'PAID') {
      batch.set(
        doc(db, `companies/${COMPANY_ID}/loans`, loanDoc.id),
        {
          collectorId,
          collectorName,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  batch.set(auditRef, {
    id: auditRef.id,
    companyId: COMPANY_ID,
    action: 'REASSIGN_CLIENT',
    entity: 'CLIENT',
    entityId: clientId,
    details: JSON.stringify({ collectorId, collectorName }),
    createdBy: adminUid,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
};

export const updateClientReferences = async (
  clientId: string,
  references: Client['references'],
  adminUid: string
) => {
  const now = Date.now();
  const clientRef = doc(db, `companies/${COMPANY_ID}/clients`, clientId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  const sanitizedReferences = references.map((reference) => ({
    name: reference.name.trim(),
    relationship: reference.relationship.trim(),
    workplace: reference.workplace.trim(),
    phone: reference.phone.trim(),
  }));

  await setDoc(
    clientRef,
    {
      references: sanitizedReferences,
      updatedAt: now,
    },
    { merge: true }
  );

  await setDoc(auditRef, {
    id: auditRef.id,
    companyId: COMPANY_ID,
    action: 'UPDATE_CLIENT_REFERENCES',
    entity: 'CLIENT',
    entityId: clientId,
    details: JSON.stringify({ referencesCount: sanitizedReferences.length }),
    createdBy: adminUid,
    createdAt: now,
    updatedAt: now,
  });
};

export const updateClientData = async (
  clientId: string,
  clientData: Partial<Client>,
  adminUid: string
) => {
  const now = Date.now();
  const clientRef = doc(db, `companies/${COMPANY_ID}/clients`, clientId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  const sanitizedReferences = (clientData.references || []).map((reference) => ({
    name: reference.name.trim(),
    relationship: reference.relationship.trim(),
    workplace: reference.workplace.trim(),
    phone: reference.phone.trim(),
  }));

  const payload: Partial<Client> & { updatedAt: number } = {
    fullName: clientData.fullName?.trim() || '',
    fullNameLower: normalizeSearchText(clientData.fullName),
    documentId: clientData.documentId?.trim() || '',
    documentSearch: normalizeDigits(clientData.documentId),
    birthDate: clientData.birthDate?.trim() || '',
    nationality: clientData.nationality?.trim() || '',
    phone: clientData.phone?.trim() || '',
    phoneSearch: normalizeDigits(clientData.phone),
    email: clientData.email?.trim() || '',
    address: clientData.address?.trim() || '',
    city: clientData.city?.trim() || '',
    neighborhood: clientData.neighborhood?.trim() || '',
    housingType: clientData.housingType || 'PROPIA',
    workplaceName: clientData.workplaceName?.trim() || '',
    workplaceAddress: clientData.workplaceAddress?.trim() || '',
    workplaceCity: clientData.workplaceCity?.trim() || '',
    workplaceNeighborhood: clientData.workplaceNeighborhood?.trim() || '',
    seniority: clientData.seniority?.trim() || '',
    employmentStatus: clientData.employmentStatus || 'EMPLEADO',
    workPhone: clientData.workPhone?.trim() || '',
    position: clientData.position?.trim() || '',
    department: clientData.department?.trim() || '',
    references: sanitizedReferences,
    location: {
      latitude: Number(clientData.location?.latitude || 0),
      longitude: Number(clientData.location?.longitude || 0),
      googleMapsUrl: clientData.location?.googleMapsUrl?.trim() || '',
    },
    updatedAt: now,
  };

  const batch = writeBatch(db);
  const loansSnap = await getDocs(
    query(collection(db, `companies/${COMPANY_ID}/loans`), where('clientId', '==', clientId))
  );

  batch.set(clientRef, payload, { merge: true });
  loansSnap.docs.forEach((loanDoc) => {
    batch.set(
      doc(db, `companies/${COMPANY_ID}/loans`, loanDoc.id),
      {
        clientName: payload.fullName,
        clientNameLower: payload.fullNameLower,
        clientDocumentId: payload.documentId,
        clientPhone: payload.phone,
        clientAddress: payload.address,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  batch.set(auditRef, {
    id: auditRef.id,
    companyId: COMPANY_ID,
    action: 'UPDATE_CLIENT_DATA',
    entity: 'CLIENT',
    entityId: clientId,
    details: JSON.stringify({
      fullName: payload.fullName,
      documentId: payload.documentId,
      phone: payload.phone,
    }),
    createdBy: adminUid,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
};
