import {
  collection,
  doc,
  getDoc,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { ApprovalStatus, Client, Loan, LoanType, PlanFrecuencia, Role } from '../types';
import { getCalendarMonthSpanFromDays } from '../utils/dateUtils';

const DAY_MS = 1000 * 60 * 60 * 24;
export const DEFAULT_INTEREST_RATE = 20;
export const DEFAULT_CYCLE_DAYS = 30;

const getLoansRef = () => collection(db, `companies/${COMPANY_ID}/loans`);
const normalizeSearchText = (value?: string) => (value || '').trim().toLocaleLowerCase('es');

const normalizePrincipalBalance = (loan: Pick<Loan, 'currentBalance' | 'principal'>) =>
  Math.max(0, Math.min(loan.currentBalance || 0, loan.principal || 0));

const startOfUtcDay = (timestamp: number) => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export const getLoanCycleDays = (loan: Pick<Loan, 'cycleDays' | 'grantedAt' | 'expiresAt'>) => {
  if (loan.cycleDays && loan.cycleDays > 0) {
    return loan.cycleDays;
  }

  const derivedDays = Math.round((loan.expiresAt - loan.grantedAt) / DAY_MS);
  return derivedDays > 0 ? derivedDays : DEFAULT_CYCLE_DAYS;
};

export const getLoanCycleMonths = (loan: Pick<Loan, 'cycleDays' | 'grantedAt' | 'expiresAt'>) =>
  getCalendarMonthSpanFromDays(getLoanCycleDays(loan));

export const loanTypeUsesInitialInterest = (loanType?: LoanType) =>
  loanType !== 'ALQUILER_INMUEBLE' &&
  loanType !== 'PRESTACION_SERVICIOS' &&
  loanType !== 'CONGELADO';

export const loanTypeUsesDailyInterest = (loanType?: LoanType) =>
  loanType !== 'CONGELADO';

export const loanTypeStartsFrozen = (loanType?: LoanType) =>
  loanType === 'PRESTACION_SERVICIOS';

const isFrozenLoan = (loan: { loanType?: LoanType; status?: Loan['status'] }) =>
  loan.status === 'FROZEN' || loan.status === 'CONGELADO' || loan.loanType === 'CONGELADO';

const isStandardCredit = (loan: Pick<Loan, 'origen' | 'status'> & { loanType?: LoanType }) =>
  (loan.origen === undefined || loan.origen === 'sistema_creditos') &&
  (loan.loanType === 'PRESTAMO' || loan.loanType === 'CELULAR') &&
  loan.status !== 'FROZEN' &&
  loan.status !== 'CONGELADO';

export const calculateInterestAmount = (
  loan: Pick<Loan, 'principal' | 'interestRate'> & { loanType?: LoanType; status?: Loan['status'] }
) => {
  if (!loanTypeUsesInitialInterest(loan.loanType) || isFrozenLoan(loan)) {
    return 0;
  }
  const rate = loan.interestRate >= 0 ? loan.interestRate : DEFAULT_INTEREST_RATE;
  return Math.round(loan.principal * (rate / 100));
};

export const calculateDaysLate = (
  loan: Pick<Loan, 'expiresAt' | 'nextDueDate' | 'status' | 'approvalStatus'>,
  referenceTime = Date.now()
) => {
    if (isFrozenLoan(loan) || loan.status === 'PAID' || (loan.approvalStatus && loan.approvalStatus !== 'APPROVED')) {
    return 0;
  }

  const referenceDay = startOfUtcDay(referenceTime);
  const dueDay = startOfUtcDay(loan.nextDueDate || loan.expiresAt);

  if (referenceDay <= dueDay) {
    return 0;
  }

  return Math.floor((referenceDay - dueDay) / DAY_MS);
};

export const getCollectionDayIndicator = (
  loan: Pick<Loan, 'expiresAt' | 'nextDueDate' | 'status' | 'approvalStatus'> & {
    currentDueDate?: number;
  },
  referenceTime = Date.now()
) => {
    if (isFrozenLoan(loan) || loan.status === 'PAID' || (loan.approvalStatus && loan.approvalStatus !== 'APPROVED')) {
    return {
      mode: 'neutral' as const,
      value: 0,
      label: 'Sin cobro pendiente',
    };
  }

  const referenceDay = startOfUtcDay(referenceTime);
  const dueDay = startOfUtcDay(loan.currentDueDate || loan.nextDueDate || loan.expiresAt);
  const dayDifference = Math.floor((dueDay - referenceDay) / DAY_MS);

  if (dayDifference > 0) {
    return {
      mode: 'upcoming' as const,
      value: dayDifference,
      label: `${dayDifference} dia(s) para cobrar`,
    };
  }

  if (dayDifference === 0) {
    return {
      mode: 'due_today' as const,
      value: 0,
      label: 'Cobro hoy',
    };
  }

  return {
    mode: 'late' as const,
    value: Math.abs(dayDifference),
    label: `${Math.abs(dayDifference)} dia(s) de mora`,
  };
};

export const calculateDailyInterestAmount = (
  loan: Pick<Loan, 'principal' | 'interestRate' | 'totalAmount' | 'montoCuota' | 'origen' | 'status'> & { loanType?: LoanType }
) => {
  if (!isStandardCredit(loan)) return 0;
  return calculateInterestAmount(loan) / 30;
};
export const calculatePendingRefinancing = (loan: Loan) => ({
  cyclesToApply: 0,
  interestPerCycle: calculateInterestAmount(loan),
  refinancingAmount: 0,
  nextExpiresAt: loan.expiresAt,
});

export const accrueLoanState = (loan: Loan, referenceTime = Date.now()) => {
  const principalBalance = normalizePrincipalBalance(loan);
  const interestPerCycle = calculateInterestAmount(loan);
  const currentDueDate = loan.nextDueDate || loan.expiresAt;
  const daysLate = calculateDaysLate(loan, referenceTime);
  const cycleDays = getLoanCycleDays(loan);
  const cyclesElapsed =
    isStandardCredit(loan) && referenceTime >= currentDueDate
      ? Math.floor((startOfUtcDay(referenceTime) - startOfUtcDay(currentDueDate)) / (cycleDays * DAY_MS)) + 1
      : 0;
  const dailyInterest = calculateDailyInterestAmount(loan);
  const overdueInterestCharged = Math.round(dailyInterest * daysLate);
  const interestPaidAmount = Math.max(0, loan.interestPaidAmount || 0);
  const overdueInterestPaid = Math.min(interestPaidAmount, overdueInterestCharged);
  const initialInterestPaid = Math.max(0, interestPaidAmount - overdueInterestPaid);
  const accruedLateFeeBalance = Math.max(0, overdueInterestCharged - overdueInterestPaid);
  const recurringInterest = isStandardCredit(loan) ? interestPerCycle * cyclesElapsed : 0;
  const accruedInterestBalance =
    principalBalance > 0
      ? Math.max(0, interestPerCycle + recurringInterest - initialInterestPaid)
      : 0;

  if (
      isFrozenLoan(loan) || loan.status === 'PAID' || (loan.approvalStatus && loan.approvalStatus !== 'APPROVED')
    ) {
    return {
      principalBalance,
      accruedInterestBalance,
      accruedLateFeeBalance,
      nextDueDate: loan.expiresAt,
      currentDueDate,
      lastAccruedAt: loan.lastAccruedAt || loan.expiresAt,
      chargedCycles: cyclesElapsed,
      interestPerCycle,
    };
  }
  return {
    principalBalance,
    accruedInterestBalance,
    accruedLateFeeBalance,
    nextDueDate: loan.expiresAt,
    currentDueDate,
    lastAccruedAt: referenceTime,
    chargedCycles: cyclesElapsed,
    interestPerCycle,
  };
};

export const calculateOutstandingInterest = (loan: Loan, referenceTime = Date.now()) =>
  accrueLoanState(loan, referenceTime).accruedInterestBalance;

export const calculateMora = (loan: Loan, referenceTime = Date.now()) =>
  accrueLoanState(loan, referenceTime).accruedLateFeeBalance;

export const getLoanFinancialSnapshot = (loan: Loan, referenceTime = Date.now()) => {
  if (loan.approvalStatus && loan.approvalStatus !== 'APPROVED') {
    const initialInterest = calculateInterestAmount(loan);
    const principalBalance = normalizePrincipalBalance(loan);
    return {
      cyclesToApply: 0,
      interestPerCycle: initialInterest,
      refinancingAmount: 0,
      nextExpiresAt: loan.expiresAt,
      daysLate: 0,
      effectiveBalance: principalBalance,
      mora: 0,
      accruedInterest: principalBalance > 0 ? initialInterest : 0,
      totalDue: principalBalance + (principalBalance > 0 ? initialInterest : 0),
    };
  }

  const projected = accrueLoanState(loan, referenceTime);
  const referenceDay = startOfUtcDay(referenceTime);
  const currentDueDay = startOfUtcDay(projected.currentDueDate);
  const daysLate =
    referenceDay > currentDueDay ? Math.floor((referenceDay - currentDueDay) / DAY_MS) : 0;

  return {
    cyclesToApply: projected.chargedCycles,
    interestPerCycle: projected.interestPerCycle,
    refinancingAmount: 0,
    nextExpiresAt: loan.expiresAt,
    currentDueDate: projected.currentDueDate,
    daysLate,
    effectiveBalance: projected.principalBalance,
    mora: projected.accruedLateFeeBalance,
    accruedInterest: projected.accruedInterestBalance,
    totalDue:
      projected.principalBalance +
      projected.accruedInterestBalance +
      projected.accruedLateFeeBalance,
  };
};

type LoanCreateInput = Omit<
  Loan,
  | 'id'
  | 'companyId'
  | 'createdAt'
  | 'updatedAt'
  | 'createdBy'
  | 'status'
  | 'paidAmount'
  | 'currentBalance'
  | 'interestPaidAmount'
  | 'accruedInterestBalance'
  | 'accruedLateFeeBalance'
  | 'nextDueDate'
  | 'lastAccruedAt'
  | 'totalAmount'
  | 'refinancingCount'
  | 'approvalStatus'
  | 'approvedAt'
  | 'approvedBy'
  | 'inforconfConfirmedAt'
  | 'inforconfConfirmedBy'
> & { tomo?: string | number; planFrecuencia?: PlanFrecuencia; cantidadCuotas?: number; montoCuota?: number };

export const createLoan = async (
  loanData: LoanCreateInput,
  creatorUid: string,
  creatorRole: Role
) => {
  const batch = writeBatch(db);
  const loanRef = doc(getLoansRef());
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));
  const now = Date.now();
  const approvalStatus: ApprovalStatus = creatorRole === 'ADMIN' ? 'APPROVED' : 'PENDING';
  const initialInterest = calculateInterestAmount(loanData);
  const initialStatus = loanTypeStartsFrozen(loanData.loanType) ? 'FROZEN' : 'ACTIVE';
  const clientSnap = await getDoc(doc(db, `companies/${COMPANY_ID}/clients`, loanData.clientId));
  const client = clientSnap.exists() ? (clientSnap.data() as Client) : null;

  const newLoan: Loan = {
    ...loanData,
    origen: loanData.origen || 'sistema_creditos',
    hasPagare: Boolean(loanData.hasPagare || loanData.tomo),
    clientName: client?.fullName || loanData.clientName || '',
    clientNameLower: normalizeSearchText(client?.fullName || loanData.clientName),
    clientDocumentId: client?.documentId || loanData.clientDocumentId || '',
    clientPhone: client?.phone || loanData.clientPhone || '',
    clientAddress: client?.address || loanData.clientAddress || '',
    id: loanRef.id,
    companyId: COMPANY_ID,
    status: initialStatus,
    approvalStatus,
    totalAmount: loanData.principal + initialInterest,
    currentBalance: loanData.principal,
    saldoInicial: loanData.principal,
    saldoDefinitivo: loanData.principal + initialInterest,
    saldoProvisorio: loanData.principal + initialInterest,
    totalPagadoAprobado: 0,
    totalPendienteAprobacion: 0,
    tienePagosPendientes: false,
    estadoCobranza: initialStatus === 'ACTIVE' ? 'activo' : 'activo',
    paidAmount: 0,
    interestPaidAmount: 0,
    accruedInterestBalance: initialInterest,
    accruedLateFeeBalance: 0,
    nextDueDate: loanData.expiresAt,
    lastAccruedAt: loanData.grantedAt,
    refinancingCount: 0,
    cycleDays: loanData.cycleDays || getLoanCycleDays(loanData),
    createdAt: now,
    updatedAt: now,
    createdBy: creatorUid,
  };

  if (approvalStatus === 'APPROVED') {
    newLoan.approvedAt = now;
    newLoan.approvedBy = creatorUid;
  }

  batch.set(loanRef, newLoan);

  if (loanData.tomo) {
    const pagareRef = doc(collection(db, `companies/${COMPANY_ID}/pagares`));
    batch.set(pagareRef, {
      id: pagareRef.id,
      loanId: loanRef.id,
      companyId: COMPANY_ID,
      nombre: (client?.fullName || loanData.clientName || '').trim(),
      nombreLower: (client?.fullName || loanData.clientName || '').trim().toLowerCase(),
      cedula: (client?.documentId || loanData.clientDocumentId || '').trim(),
      cedulaSearch: (client?.documentId || loanData.clientDocumentId || '').trim().toLowerCase(),
      monto: loanData.principal,
      tomo: String(loanData.tomo).trim(),
      cobrador: loanData.collectorName || '',
      estado: 'activo',
      createdAt: now,
      updatedAt: now,
      createdBy: creatorUid,
    });
  }

  if (creatorRole === 'ADMIN') {
    const clientRef = doc(db, `companies/${COMPANY_ID}/clients`, loanData.clientId);
    batch.set(
      clientRef,
      {
        collectorId: loanData.collectorId,
        collectorName: loanData.collectorName,
        updatedAt: now,
      },
      { merge: true }
    );
  }
  batch.set(auditRef, {
    id: auditRef.id,
    companyId: COMPANY_ID,
    action: approvalStatus === 'APPROVED' ? 'CREATE' : 'LOAN_REQUEST',
    entity: 'LOAN',
    entityId: loanRef.id,
    details: JSON.stringify({
      principal: loanData.principal,
      currency: loanData.currency,
      clientId: loanData.clientId,
      interestRate: loanData.interestRate,
      cycleDays: newLoan.cycleDays,
      approvalStatus,
      hasPagare: newLoan.hasPagare,
      tomo: loanData.tomo || null,
      isLocatable: loanData.isLocatable || false,
      description: loanData.description || '',
    }),
    createdBy: creatorUid,
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
  return newLoan;
};

export const approveLoan = async (loanId: string, adminUid: string) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const loan = loanDoc.data() as Loan;
    if (loan.approvalStatus === 'APPROVED') return;

    const now = Date.now();
    transaction.update(loanRef, {
      approvalStatus: 'APPROVED',
      approvedAt: now,
      approvedBy: adminUid,
      updatedAt: now,
      currentBalance: normalizePrincipalBalance(loan),
      totalAmount: normalizePrincipalBalance(loan) + calculateInterestAmount(loan),
      nextDueDate: loan.nextDueDate || loan.expiresAt,
      lastAccruedAt: loan.lastAccruedAt || loan.grantedAt || now,
      accruedInterestBalance:
        typeof loan.accruedInterestBalance === 'number'
          ? loan.accruedInterestBalance
          : calculateInterestAmount(loan),
      accruedLateFeeBalance: loan.accruedLateFeeBalance || 0,
    });
    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'APPROVE_LOAN',
      entity: 'LOAN',
      entityId: loanId,
      details: JSON.stringify({ clientId: loan.clientId }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const updateLoanAdminMeta = async (
  loanId: string,
  adminUid: string,
  changes: Pick<Loan, 'hasPagare' | 'isLocatable'>
) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const now = Date.now();
    transaction.update(loanRef, {
      hasPagare: changes.hasPagare || false,
      isLocatable: changes.isLocatable || false,
      updatedAt: now,
    });
    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'UPDATE_LOAN_META',
      entity: 'LOAN',
      entityId: loanId,
      details: JSON.stringify(changes),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const updateLoanAdmin = async (
  loanId: string,
  adminUid: string,
  changes: Pick<
    Loan,
    | 'principal'
    | 'currency'
    | 'interestRate'
    | 'cycleDays'
    | 'grantedAt'
    | 'expiresAt'
    | 'collectorId'
    | 'collectorName'
    | 'hasPagare'
    | 'isLocatable'
  >
  ) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const loan = loanDoc.data() as Loan;
    const now = Date.now();
    const principalPaid = Math.max(0, loan.principal - normalizePrincipalBalance(loan));
    const nextPrincipalBalance = Math.max(0, changes.principal - principalPaid);
    const accrued = accrueLoanState(loan, now);
    const hasAnyPayment = (loan.paidAmount || 0) > 0 || (loan.interestPaidAmount || 0) > 0;
    const updatedInterestPerCycle = calculateInterestAmount({
      principal: changes.principal,
      interestRate: changes.interestRate,
      loanType: loan.loanType,
    });
    const nextInterestBalance =
      accrued.accruedInterestBalance > 0 ? accrued.accruedInterestBalance : nextPrincipalBalance > 0 ? updatedInterestPerCycle : 0;
    const nextLateFeeBalance = accrued.accruedLateFeeBalance;

    transaction.update(loanRef, {
      principal: changes.principal,
      interestRate: changes.interestRate,
      cycleDays: changes.cycleDays,
      grantedAt: changes.grantedAt,
      expiresAt: changes.expiresAt,
      collectorId: changes.collectorId,
      collectorName: changes.collectorName,
      hasPagare: changes.hasPagare || false,
      isLocatable: changes.isLocatable || false,
      totalAmount: nextPrincipalBalance + nextInterestBalance + nextLateFeeBalance,
      currentBalance: nextPrincipalBalance,
      accruedInterestBalance: nextInterestBalance,
      accruedLateFeeBalance: nextLateFeeBalance,
      nextDueDate: hasAnyPayment ? loan.nextDueDate || changes.expiresAt : changes.expiresAt,
      lastAccruedAt: accrued.lastAccruedAt,
      status:
        nextPrincipalBalance <= 0 &&
        nextInterestBalance <= 0 &&
        nextLateFeeBalance <= 0
          ? 'PAID'
          : loan.status === 'FROZEN'
            ? 'FROZEN'
            : 'ACTIVE',
      updatedAt: now,
    });

    transaction.set(
      doc(db, `companies/${COMPANY_ID}/clients`, loan.clientId),
      {
        collectorId: changes.collectorId,
        collectorName: changes.collectorName,
        updatedAt: now,
      },
      { merge: true }
    );

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'UPDATE_LOAN',
      entity: 'LOAN',
      entityId: loanId,
      details: JSON.stringify({
        previousPrincipal: loan.principal,
        newPrincipal: changes.principal,
        previousCurrency: loan.currency,
        newCurrency: changes.currency,
        previousInterestRate: loan.interestRate,
        newInterestRate: changes.interestRate,
        previousCollectorId: loan.collectorId,
        newCollectorId: changes.collectorId,
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const confirmInforconf = async (loanId: string, adminUid: string) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const now = Date.now();
    transaction.update(loanRef, {
      inforconfConfirmedAt: now,
      inforconfConfirmedBy: adminUid,
      updatedAt: now,
    });
    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'CONFIRM_INFORCONF',
      entity: 'LOAN',
      entityId: loanId,
      details: 'Cliente marcado como reportado en Inforconf',
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const freezeLoan = async (loanId: string, adminUid: string) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const now = Date.now();
    transaction.update(loanRef, {
      status: 'FROZEN',
      updatedAt: now,
    });

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'FREEZE',
      entity: 'LOAN',
      entityId: loanId,
      details: 'Credito congelado por el administrador',
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const redirectLoanToCollector = async (
  loanId: string,
  newCollectorId: string,
  newCollectorName: string,
  adminUid: string
) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const loan = loanDoc.data() as Loan;
    const now = Date.now();
    const clientRef = doc(db, `companies/${COMPANY_ID}/clients`, loan.clientId);

    transaction.update(loanRef, {
      collectorId: newCollectorId,
      collectorName: newCollectorName,
      updatedAt: now,
    });

    transaction.set(
      clientRef,
      {
        collectorId: newCollectorId,
        collectorName: newCollectorName,
        updatedAt: now,
      },
      { merge: true }
    );

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'REDIRECT',
      entity: 'LOAN',
      entityId: loanId,
      details: JSON.stringify({
        from: loan.collectorName,
        to: newCollectorName,
        reason: 'Redirected by admin',
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const deleteLoan = async (loanId: string, adminUid: string, reason: string) => {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('La razon de anulacion es obligatoria.');
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito no existe');

    const now = Date.now();
    const loan = loanDoc.data() as Loan;

    transaction.update(loanRef, {
      status: 'ANULADO',
      anuladoAt: now,
      anuladoBy: adminUid,
      anulacionRazon: normalizedReason,
      updatedAt: now,
    });
    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'ANNUL_LOAN',
      entity: 'LOAN',
      entityId: loanId,
      details: JSON.stringify({
        clientId: loan.clientId,
        collectorId: loan.collectorId,
        principal: loan.principal,
        reason: normalizedReason,
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};
