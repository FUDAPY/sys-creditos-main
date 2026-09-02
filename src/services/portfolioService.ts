import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { Loan } from '../types';
import { getLoanFinancialSnapshot } from './loanService';
import { getCreditInfo } from '../utils/loanUtils';

export interface PortfolioEntry {
  id: string;
  loanId: string;
  loanType: Loan['loanType'];
  origen: Loan['origen'];
  clientId: string;
  clientName?: string;
  clientPhone?: string;
  currency: Loan['currency'];
  principal: number;
  principalDue: number;
  interestDue: number;
  lateFeesDue: number;
  totalDue: number;
  status: 'ACTIVE' | 'FROZEN' | 'CONGELADO' | 'PAID' | 'ANULADO';
  expiresAt: number;
  createdAt: number;
  lastUpdatedAt: number;
  collectorId?: string;
  collectorName?: string;
  daysOverdue: number;
  isOverdue: boolean;
  classification: 'BUENO' | 'INFORCONF' | 'PREJUDICIAL' | 'JUDICIAL';
}

export const refreshPortfolioEntry = async (loan: Loan): Promise<void> => {
  if (!loan.id) throw new Error('El credito no tiene identificador.');

  const portfolioRef = doc(db, `companies/${COMPANY_ID}/portfolio`, loan.id);
  const snapshot = getLoanFinancialSnapshot(loan, Date.now());

  const now = Date.now();
  const daysBetween = Math.floor((now - loan.expiresAt) / (1000 * 60 * 60 * 24));
  const isOverdue = loan.expiresAt < now;

  const entry: PortfolioEntry = {
    id: loan.id,
    loanId: loan.id,
    loanType: loan.loanType,
    origen: loan.origen || 'sistema_creditos',
    clientId: loan.clientId,
    clientName: loan.clientName,
    clientPhone: loan.clientPhone,
    currency: loan.currency,
    principal: loan.principal,
    principalDue: snapshot.effectiveBalance,
    interestDue: snapshot.accruedInterest,
    lateFeesDue: snapshot.mora,
    totalDue: snapshot.totalDue,
    status: loan.status,
    expiresAt: loan.expiresAt,
    createdAt: loan.createdAt,
    lastUpdatedAt: now,
    collectorId: loan.collectorId,
    collectorName: loan.collectorName,
    daysOverdue: isOverdue ? daysBetween : 0,
    isOverdue,
    classification: getCreditInfo(loan.expiresAt, loan.inforconfConfirmedAt).status,
  };

  await setDoc(portfolioRef, entry, { merge: true });
};

export const removePortfolioEntry = async (loanId: string): Promise<void> => {
  const portfolioRef = doc(db, `companies/${COMPANY_ID}/portfolio`, loanId);
  await deleteDoc(portfolioRef);
};

export const getActivePortfolio = async (): Promise<PortfolioEntry[]> => {
  const portfolioRef = collection(db, `companies/${COMPANY_ID}/portfolio`);
  const portfolioQuery = query(
    portfolioRef,
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(portfolioQuery);
  return snapshot.docs.map((doc) => doc.data() as PortfolioEntry);
};

export const getPortfolioByOrigen = async (
  origen: Loan['origen']
): Promise<PortfolioEntry[]> => {
  const portfolioRef = collection(db, `companies/${COMPANY_ID}/portfolio`);
  const portfolioQuery = query(
    portfolioRef,
    where('origen', '==', origen),
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(portfolioQuery);
  return snapshot.docs.map((doc) => doc.data() as PortfolioEntry);
};

export const getPortfolioByClassification = async (
  classification: 'BUENO' | 'INFORCONF' | 'PREJUDICIAL' | 'JUDICIAL'
): Promise<PortfolioEntry[]> => {
  const portfolioRef = collection(db, `companies/${COMPANY_ID}/portfolio`);
  const portfolioQuery = query(
    portfolioRef,
    where('classification', '==', classification),
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(portfolioQuery);
  return snapshot.docs.map((doc) => doc.data() as PortfolioEntry);
};

export const getOverduePortfolio = async (): Promise<PortfolioEntry[]> => {
  const portfolioRef = collection(db, `companies/${COMPANY_ID}/portfolio`);
  const portfolioQuery = query(
    portfolioRef,
    where('isOverdue', '==', true),
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO'])
  );

  const snapshot = await getDocs(portfolioQuery);
  return snapshot.docs.map((doc) => doc.data() as PortfolioEntry);
};

export const getPortfolioSummary = async () => {
  const portfolio = await getActivePortfolio();

  const summary = {
    totalEntries: portfolio.length,
    totalPrincipalDue: portfolio.reduce((sum, entry) => sum + entry.principalDue, 0),
    totalInterestDue: portfolio.reduce((sum, entry) => sum + entry.interestDue, 0),
    totalLateFeesDue: portfolio.reduce((sum, entry) => sum + entry.lateFeesDue, 0),
    totalDue: portfolio.reduce((sum, entry) => sum + entry.totalDue, 0),
    overdueCount: portfolio.filter((entry) => entry.isOverdue).length,
    overdueAmount: portfolio
      .filter((entry) => entry.isOverdue)
      .reduce((sum, entry) => sum + entry.totalDue, 0),
    byOrigen: {
      sistema_creditos: portfolio.filter((e) => e.origen === 'sistema_creditos').length,
      empeno: portfolio.filter((e) => e.origen === 'empeno').length,
      alquiler: portfolio.filter((e) => e.origen === 'alquiler').length,
      prestacion_servicios: portfolio.filter((e) => e.origen === 'prestacion_servicios').length,
      juridico: portfolio.filter((e) => e.origen === 'juridico').length,
      pos: portfolio.filter((e) => e.origen === 'pos').length,
    },
    byClassification: {
      BUENO: portfolio.filter((e) => e.classification === 'BUENO').length,
      INFORCONF: portfolio.filter((e) => e.classification === 'INFORCONF').length,
      PREJUDICIAL: portfolio.filter((e) => e.classification === 'PREJUDICIAL').length,
      JUDICIAL: portfolio.filter((e) => e.classification === 'JUDICIAL').length,
    },
  };

  return summary;
};

export const bulkRefreshPortfolio = async (): Promise<{ refreshed: number; errors: string[] }> => {
  const loansRef = collection(db, `companies/${COMPANY_ID}/loans`);
  const loansQuery = query(
    loansRef,
    where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO']),
    where('approvalStatus', '==', 'APPROVED')
  );

  const loansSnapshot = await getDocs(loansQuery);
  const loans = loansSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Loan));

  let refreshed = 0;
  const errors: string[] = [];

  for (const loan of loans) {
    try {
      await refreshPortfolioEntry(loan);
      refreshed++;
    } catch (error) {
      errors.push(`Error refreshing loan ${loan.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { refreshed, errors };
};
