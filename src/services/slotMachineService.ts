import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, COMPANY_ID } from '../lib/firebase';
import type { SlotMachineEntry, SlotMachineSite, User } from '../types';

const SITES_PATH = `companies/${COMPANY_ID}/slotMachineSites`;
const ENTRIES_PATH = `companies/${COMPANY_ID}/slotMachineEntries`;
const DEFAULT_COMMISSION_RATE = 10;

export async function getSlotMachineSites(userData: User) {
  const baseRef = collection(db, SITES_PATH);
  const baseQuery =
    userData.role === 'ADMIN'
      ? query(baseRef, orderBy('locationName', 'asc'))
      : query(baseRef, where('collectorId', '==', userData.uid));

  const snapshot = await getDocs(baseQuery);
  return snapshot.docs
    .map((item) => item.data() as SlotMachineSite)
    .sort((left, right) => left.locationName.localeCompare(right.locationName, 'es'));
}

export async function getSlotMachineEntries(userData: User) {
  const baseRef = collection(db, ENTRIES_PATH);
  const baseQuery =
    userData.role === 'ADMIN'
      ? query(baseRef, orderBy('collectionDate', 'desc'))
      : query(baseRef, where('collectorId', '==', userData.uid));

  const snapshot = await getDocs(baseQuery);
  return snapshot.docs
    .map((item) => item.data() as SlotMachineEntry)
    .sort((left, right) => right.collectionDate - left.collectionDate);
}

export async function getSlotMachineEntriesForApproval(options: {
  userData: User;
  approvalStatus?: 'PENDING' | 'APPROVED';
  collectorId?: string;
  dateFrom?: number;
  dateTo?: number;
  maxResults?: number;
}) {
  const baseRef = collection(db, ENTRIES_PATH);
  const constraints: QueryConstraint[] = [];

  if (options.userData.role !== 'ADMIN') {
    constraints.push(where('collectorId', '==', options.userData.uid));
  } else if (options.collectorId) {
    constraints.push(where('collectorId', '==', options.collectorId));
  }
  if (options.approvalStatus) {
    constraints.push(where('approvalStatus', '==', options.approvalStatus));
  }
  if (options.dateFrom !== undefined) {
    constraints.push(where('collectionDate', '>=', options.dateFrom));
  }
  if (options.dateTo !== undefined) {
    constraints.push(where('collectionDate', '<=', options.dateTo));
  }
  constraints.push(orderBy('collectionDate', 'desc'), limit(options.maxResults || 150));

  const snapshot = await getDocs(query(baseRef, ...constraints));
  return snapshot.docs.map((item) => item.data() as SlotMachineEntry);
}

export async function createSlotMachineSite(
  siteData: {
    name: string;
    locationName: string;
    address?: string;
    collectorId: string;
    collectorName: string;
  },
  createdBy: string
) {
  const siteRef = doc(collection(db, SITES_PATH));
  const now = Date.now();

  const site: SlotMachineSite = {
    id: siteRef.id,
    companyId: COMPANY_ID,
    createdAt: now,
    updatedAt: now,
    createdBy,
    name: siteData.name.trim(),
    locationName: siteData.locationName.trim(),
    address: siteData.address?.trim() || '',
    collectorId: siteData.collectorId,
    collectorName: siteData.collectorName,
    commissionRate: DEFAULT_COMMISSION_RATE,
    isActive: true,
  };

  await setDoc(siteRef, site);
  return site;
}

export async function createSlotMachineEntry(
  entryData: {
    siteId: string;
    siteName: string;
    locationName: string;
    collectorId: string;
    collectorName: string;
    collectionDate: number;
    amount: number;
    commissionRate?: number;
    notes?: string;
  },
  createdBy: string
) {
  const entryRef = doc(collection(db, ENTRIES_PATH));
  const now = Date.now();
  const amount = Math.max(0, Math.round(entryData.amount));
  const commissionRate = Number.isFinite(entryData.commissionRate)
    ? entryData.commissionRate!
    : DEFAULT_COMMISSION_RATE;

  const entry: SlotMachineEntry = {
    id: entryRef.id,
    companyId: COMPANY_ID,
    createdAt: now,
    updatedAt: now,
    createdBy,
    siteId: entryData.siteId,
    siteName: entryData.siteName,
    locationName: entryData.locationName,
    collectorId: entryData.collectorId,
    collectorName: entryData.collectorName,
    collectionDate: entryData.collectionDate,
    amount,
    commissionRate,
    commissionAmount: Math.round(amount * (commissionRate / 100)),
    approvalStatus: 'PENDING',
    notes: entryData.notes?.trim() || '',
  };

  await setDoc(entryRef, entry);
  return entry;
}

export async function approveSlotMachineEntry(
  entryId: string,
  adminUid: string,
  adminName: string
) {
  const entryRef = doc(db, ENTRIES_PATH, entryId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const entryDoc = await transaction.get(entryRef);
    if (!entryDoc.exists()) throw new Error('La recaudacion de tragamonedas no existe.');

    const entry = entryDoc.data() as SlotMachineEntry;
    if (entry.approvalStatus === 'APPROVED') return;

    const now = Date.now();
    transaction.update(entryRef, {
      approvalStatus: 'APPROVED',
      approvedAt: now,
      approvedBy: adminUid,
      approvedByName: adminName,
      updatedAt: now,
    });

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'APPROVE_SLOT_MACHINE_SETTLEMENT',
      entity: 'SLOT_MACHINE_ENTRY',
      entityId: entryId,
      details: JSON.stringify({
        siteId: entry.siteId,
        amount: entry.amount,
        commissionAmount: entry.commissionAmount,
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export async function unapproveSlotMachineEntry(
  entryId: string,
  adminUid: string,
  adminName: string,
  reason = ''
) {
  const entryRef = doc(db, ENTRIES_PATH, entryId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const entryDoc = await transaction.get(entryRef);
    if (!entryDoc.exists()) throw new Error('La recaudacion de tragamonedas no existe.');

    const entry = entryDoc.data() as SlotMachineEntry;
    const now = Date.now();
    transaction.delete(entryRef);

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'DELETE_UNAPPROVED_SLOT_MACHINE_SETTLEMENT',
      entity: 'SLOT_MACHINE_ENTRY',
      entityId: entryId,
      details: JSON.stringify({
        siteId: entry.siteId,
        amount: entry.amount,
        commissionAmount: entry.commissionAmount,
        adminName,
        reason,
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
}
