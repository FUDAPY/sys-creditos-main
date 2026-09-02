import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { COMPANY_ID, db } from '../lib/firebase';
import type { ApprovalStatus, Client, Loan, Payment, PaymentType, Role } from '../types';
import { accrueLoanState } from './loanService';
import { addUtcMonthsPreservingDay } from '../utils/dateUtils';

const removeUndefinedFields = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as T;

const applyPaymentByType = (
  projected: {
    principalBalance: number;
    accruedInterestBalance: number;
    accruedLateFeeBalance: number;
  },
  amountPaid: number,
  paymentType: PaymentType
) => {
  if (paymentType === 'CAPITAL') {
    const principalApplied = Math.min(amountPaid, projected.principalBalance);
    return {
      lateFeeApplied: 0,
      interestApplied: 0,
      principalApplied,
      resultingPrincipalBalance: Math.max(0, projected.principalBalance - principalApplied),
      resultingInterestBalance: projected.accruedInterestBalance,
      resultingLateFeeBalance: projected.accruedLateFeeBalance,
      maxAllowed: projected.principalBalance,
    };
  }

  if (paymentType === 'INTEREST') {
    const lateFeeApplied = Math.min(amountPaid, projected.accruedLateFeeBalance);
    const afterLateFee = amountPaid - lateFeeApplied;
    const interestApplied = Math.min(afterLateFee, projected.accruedInterestBalance);
    return {
      lateFeeApplied,
      interestApplied,
      principalApplied: 0,
      resultingPrincipalBalance: projected.principalBalance,
      resultingInterestBalance: Math.max(0, projected.accruedInterestBalance - interestApplied),
      resultingLateFeeBalance: Math.max(0, projected.accruedLateFeeBalance - lateFeeApplied),
      maxAllowed: projected.accruedLateFeeBalance + projected.accruedInterestBalance,
    };
  }

  const lateFeeApplied = Math.min(amountPaid, projected.accruedLateFeeBalance);
  const afterLateFee = amountPaid - lateFeeApplied;
  const interestApplied = Math.min(afterLateFee, projected.accruedInterestBalance);
  const afterInterest = afterLateFee - interestApplied;
  const principalApplied = Math.min(afterInterest, projected.principalBalance);

  return {
    lateFeeApplied,
    interestApplied,
    principalApplied,
    resultingPrincipalBalance: Math.max(0, projected.principalBalance - principalApplied),
    resultingInterestBalance: Math.max(0, projected.accruedInterestBalance - interestApplied),
    resultingLateFeeBalance: Math.max(0, projected.accruedLateFeeBalance - lateFeeApplied),
    maxAllowed:
      projected.principalBalance +
      projected.accruedInterestBalance +
      projected.accruedLateFeeBalance,
  };
};

export const registerPayment = async (
  loanId: string,
  amountPaid: number,
  collectorUid: string,
  collectorName: string,
  actorRole: Role,
  paidAt?: number,
  paymentType: PaymentType = 'MIXED'
) => {
  const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, loanId);
  const paymentRef = doc(collection(db, `companies/${COMPANY_ID}/payments`));
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  return await runTransaction(db, async (transaction) => {
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('Credito no encontrado.');

    const loan = loanDoc.data() as Loan;
    const clientRef = doc(db, `companies/${COMPANY_ID}/clients`, loan.clientId);
    const clientDoc = await transaction.get(clientRef);
    const client = clientDoc.exists() ? (clientDoc.data() as Client) : null;
    if (loan.status === 'PAID') throw new Error('Este credito ya esta cancelado.');
    if (loan.approvalStatus && loan.approvalStatus !== 'APPROVED') {
      throw new Error('Este credito aun no fue aprobado por administracion.');
    }
    if (amountPaid <= 0) throw new Error('El monto a pagar debe ser mayor a 0.');

    const now = Date.now();
    const effectivePaidAt = paidAt || now;
    const projected = accrueLoanState(loan, effectivePaidAt);
    const allocation = applyPaymentByType(projected, amountPaid, paymentType);
    const pendingBefore = Math.max(0, loan.totalPendienteAprobacion || 0);
    const availableAfterPending = Math.max(0, allocation.maxAllowed - pendingBefore);

    if (amountPaid > allocation.maxAllowed) {
      if (paymentType === 'CAPITAL') {
        throw new Error('El monto supera el capital pendiente del credito.');
      }
      if (paymentType === 'INTEREST') {
        throw new Error('El monto supera la deuda de interes y mora pendiente.');
      }
      throw new Error('El monto supera la deuda total del credito.');
    }
    if (amountPaid > availableAfterPending) {
      throw new Error('El monto supera la deuda disponible considerando cobros pendientes de aprobacion.');
    }

    const {
      lateFeeApplied,
      interestApplied,
      principalApplied,
      resultingPrincipalBalance,
      resultingInterestBalance,
      resultingLateFeeBalance,
    } = allocation;
    const renewMonthlyRental =
      loan.loanType === 'ALQUILER_INMUEBLE' && resultingPrincipalBalance <= 0;
    const finalPrincipalBalance = renewMonthlyRental ? loan.principal : resultingPrincipalBalance;
    const finalInterestBalance = renewMonthlyRental ? 0 : resultingInterestBalance;
    const finalLateFeeBalance = renewMonthlyRental ? 0 : resultingLateFeeBalance;
    const cyclesCovered = Math.max(
      1,
      loan.montoCuota && loan.montoCuota > 0
        ? Math.floor(amountPaid / loan.montoCuota)
        : 1
    );
    const finalNextDueDate = renewMonthlyRental
      ? addUtcMonthsPreservingDay(projected.currentDueDate || loan.expiresAt, 1)
      : addUtcMonthsPreservingDay(projected.currentDueDate || loan.expiresAt, cyclesCovered);
    const commissionAmount = amountPaid * 0.07;
    const approvalStatus: ApprovalStatus = 'PENDING';
    const definitiveTotalBeforePayment =
      projected.principalBalance + projected.accruedInterestBalance + projected.accruedLateFeeBalance;
    const pendingAfter = pendingBefore + amountPaid;
    const provisionalTotalAfterPending = Math.max(0, definitiveTotalBeforePayment - pendingAfter);

    const newPayment = removeUndefinedFields({
      id: paymentRef.id,
      companyId: COMPANY_ID,
      loanId: loan.id || loanId,
      clientId: loan.clientId,
      clientName: client?.fullName || loan.clientName || '',
      clientNameLower: (client?.fullName || loan.clientName || '').trim().toLocaleLowerCase('es'),
      clientDocumentId: client?.documentId || loan.clientDocumentId || '',
      collectorId: collectorUid,
      collectorName,
      currency: loan.currency || 'PYG',
      paymentType,
      paidAt: effectivePaidAt,
      amount: amountPaid,
      previousBalance: projected.principalBalance,
      newBalance: finalPrincipalBalance,
      principalApplied,
      interestApplied,
      interestDueAtPayment: projected.accruedInterestBalance,
      lateFeeDueAtPayment: projected.accruedLateFeeBalance,
      arrearsApplied: lateFeeApplied,
      resultingInterestBalance: finalInterestBalance,
      resultingLateFeeBalance: finalLateFeeBalance,
      nextDueDateAfterPayment: finalNextDueDate,
      lastAccruedAtAfterPayment: projected.lastAccruedAt,
      refinancingApplied: 0,
      refinancingCycles: 0,
      interestCharged: projected.interestPerCycle,
      commissionAmount,
      approvalStatus,
      estadoRendicion: 'pendiente_rendicion',
      loanImpactApplied: false,
      approvedAt: undefined,
      approvedBy: undefined,
      approvedByName: undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: collectorUid,
    }) as Payment;

    transaction.set(paymentRef, newPayment);

    transaction.update(loanRef, {
      saldoInicial: loan.saldoInicial || loan.principal,
      saldoProvisorio: provisionalTotalAfterPending,
      totalPendienteAprobacion: pendingAfter,
      tienePagosPendientes: true,
      estadoCobranza:
        provisionalTotalAfterPending <= 0 ? 'pendiente_aprobacion' : 'pendiente_rendicion',
      ultimoPagoPendienteAt: effectivePaidAt,
      ultimoPagoPendienteId: paymentRef.id,
      updatedAt: now,
    });

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: actorRole === 'ADMIN' ? 'PAYMENT' : 'PAYMENT_SETTLEMENT_PENDING',
      entity: 'LOAN',
      entityId: loan.id || loanId,
      details: JSON.stringify({
        amount: amountPaid,
        previousBalance: projected.principalBalance,
        newBalance: finalPrincipalBalance,
        lateFeeApplied,
        interestApplied,
        principalApplied,
        paymentType,
        approvalStatus,
      }),
      createdBy: collectorUid,
      createdAt: now,
      updatedAt: now,
    });

    return newPayment;
  });
};

export const approvePayment = async (
  paymentId: string,
  adminUid: string,
  adminName: string
) => {
  const paymentRef = doc(db, `companies/${COMPANY_ID}/payments`, paymentId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const paymentDoc = await transaction.get(paymentRef);
    if (!paymentDoc.exists()) throw new Error('El recibo no existe');

    const payment = paymentDoc.data() as Payment;
    if (payment.approvalStatus === 'APPROVED') return;
    const loanImpactAlreadyApplied = payment.loanImpactApplied !== false;
    const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, payment.loanId);
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito asociado no existe');
    const loan = loanDoc.data() as Loan;
    let principalApplied = payment.principalApplied || 0;
    let interestApplied = payment.interestApplied || 0;
    let lateFeeApplied = payment.arrearsApplied || 0;
    let finalPrincipalBalance = payment.newBalance || loan.currentBalance || 0;
    let finalInterestBalance = payment.resultingInterestBalance ?? loan.accruedInterestBalance ?? 0;
    let finalLateFeeBalance = payment.resultingLateFeeBalance ?? loan.accruedLateFeeBalance ?? 0;
    let finalNextDueDate = payment.nextDueDateAfterPayment || loan.nextDueDate || loan.expiresAt;
    let lastAccruedAt = payment.lastAccruedAtAfterPayment || loan.lastAccruedAt || Date.now();
    let newStatus: Loan['status'] = loan.status;
    let previousBalance = payment.previousBalance || loan.currentBalance || 0;
    let interestDueAtPayment = payment.interestDueAtPayment || loan.accruedInterestBalance || 0;
    let lateFeeDueAtPayment = payment.lateFeeDueAtPayment || loan.accruedLateFeeBalance || 0;

    if (!loanImpactAlreadyApplied) {
      const effectivePaidAt = payment.paidAt || payment.createdAt || Date.now();
      const projected = accrueLoanState(loan, effectivePaidAt);
      const allocation = applyPaymentByType(
        {
          principalBalance: projected.principalBalance,
          accruedInterestBalance: projected.accruedInterestBalance,
          accruedLateFeeBalance: projected.accruedLateFeeBalance,
        },
        payment.amount || 0,
        payment.paymentType || 'MIXED'
      );

      if ((payment.amount || 0) > allocation.maxAllowed) {
        throw new Error('El monto pendiente supera la deuda actual del credito.');
      }

      lateFeeApplied = allocation.lateFeeApplied;
      interestApplied = allocation.interestApplied;
      principalApplied = allocation.principalApplied;
      const renewMonthlyRental =
        loan.loanType === 'ALQUILER_INMUEBLE' && allocation.resultingPrincipalBalance <= 0;
      finalPrincipalBalance = renewMonthlyRental ? loan.principal : allocation.resultingPrincipalBalance;
      finalInterestBalance = renewMonthlyRental ? 0 : allocation.resultingInterestBalance;
      finalLateFeeBalance = renewMonthlyRental ? 0 : allocation.resultingLateFeeBalance;
      const cyclesCovered = Math.max(
        1,
        loan.montoCuota && loan.montoCuota > 0
          ? Math.floor((payment.amount || 0) / loan.montoCuota)
          : 1
      );
      finalNextDueDate = renewMonthlyRental
        ? addUtcMonthsPreservingDay(projected.currentDueDate || loan.expiresAt, 1)
        : addUtcMonthsPreservingDay(projected.currentDueDate || loan.expiresAt, cyclesCovered);
      lastAccruedAt = projected.lastAccruedAt;
      newStatus =
        renewMonthlyRental
          ? 'ACTIVE'
          : allocation.resultingPrincipalBalance <= 0 &&
              allocation.resultingInterestBalance <= 0 &&
              allocation.resultingLateFeeBalance <= 0
            ? 'PAID'
            : loan.status;
      previousBalance = projected.principalBalance;
      interestDueAtPayment = projected.accruedInterestBalance;
      lateFeeDueAtPayment = projected.accruedLateFeeBalance;
    }

    const now = Date.now();
    const pendingBeforeApproval = Math.max(
      0,
      loan.totalPendienteAprobacion || (!loanImpactAlreadyApplied ? payment.amount || 0 : 0)
    );
    const pendingAfterApproval = !loanImpactAlreadyApplied
      ? Math.max(0, pendingBeforeApproval - (payment.amount || 0))
      : pendingBeforeApproval;
    const definitiveTotalAfterApproval =
      finalPrincipalBalance + finalInterestBalance + finalLateFeeBalance;
    transaction.update(paymentRef, {
      approvalStatus: 'APPROVED',
      estadoRendicion: 'aprobado',
      approvedAt: now,
      approvedBy: adminUid,
      approvedByName: adminName,
      loanImpactApplied: true,
      previousBalance,
      newBalance: finalPrincipalBalance,
      principalApplied,
      interestApplied,
      interestDueAtPayment,
      lateFeeDueAtPayment,
      arrearsApplied: lateFeeApplied,
      resultingInterestBalance: finalInterestBalance,
      resultingLateFeeBalance: finalLateFeeBalance,
      nextDueDateAfterPayment: finalNextDueDate,
      lastAccruedAtAfterPayment: lastAccruedAt,
      updatedAt: now,
    });
    if (!loanImpactAlreadyApplied) {
      transaction.update(loanRef, {
        currentBalance: finalPrincipalBalance,
        totalAmount:
          finalPrincipalBalance +
          finalInterestBalance +
          finalLateFeeBalance,
        paidAmount: (loan.paidAmount || 0) + (payment.amount || 0),
        interestPaidAmount:
          (loan.interestPaidAmount || 0) + lateFeeApplied + interestApplied,
        accruedInterestBalance: finalInterestBalance,
        accruedLateFeeBalance: finalLateFeeBalance,
        nextDueDate: finalNextDueDate,
        lastAccruedAt: lastAccruedAt,
        status: newStatus,
        saldoInicial: loan.saldoInicial || loan.principal,
        saldoDefinitivo: definitiveTotalAfterApproval,
        saldoProvisorio: Math.max(0, definitiveTotalAfterApproval - pendingAfterApproval),
        totalPagadoAprobado: (loan.totalPagadoAprobado || loan.paidAmount || 0) + (payment.amount || 0),
        totalPendienteAprobacion: pendingAfterApproval,
        tienePagosPendientes: pendingAfterApproval > 0,
        estadoCobranza:
          newStatus === 'PAID' && pendingAfterApproval === 0
            ? 'pagado'
            : pendingAfterApproval > 0
              ? 'pendiente_aprobacion'
              : 'activo',
        updatedAt: now,
      });
    }

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'APPROVE_SETTLEMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      details: JSON.stringify({
        loanId: payment.loanId,
        amount: payment.amount,
        principalApplied,
        interestApplied,
        lateFeeApplied,
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const unapprovePayment = async (
  paymentId: string,
  adminUid: string,
  adminName: string,
  reason = ''
) => {
  const paymentRef = doc(db, `companies/${COMPANY_ID}/payments`, paymentId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

  await runTransaction(db, async (transaction) => {
    const paymentDoc = await transaction.get(paymentRef);
    if (!paymentDoc.exists()) throw new Error('El recibo no existe');

    const payment = paymentDoc.data() as Payment;
    const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, payment.loanId);
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito asociado no existe');

    const loan = loanDoc.data() as Loan;
    const now = Date.now();
    if (payment.approvalStatus === 'PENDING' && payment.loanImpactApplied === false) {
      const pendingAfterDelete = Math.max(
        0,
        (loan.totalPendienteAprobacion || payment.amount || 0) - (payment.amount || 0)
      );
      const definitiveTotal =
        loan.saldoDefinitivo ??
        (loan.currentBalance || 0) +
          (loan.accruedInterestBalance || 0) +
          (loan.accruedLateFeeBalance || 0);

      transaction.update(loanRef, {
        saldoProvisorio: Math.max(0, definitiveTotal - pendingAfterDelete),
        totalPendienteAprobacion: pendingAfterDelete,
        tienePagosPendientes: pendingAfterDelete > 0,
        estadoCobranza: pendingAfterDelete > 0 ? 'pendiente_aprobacion' : 'activo',
        updatedAt: now,
      });
      transaction.update(paymentRef, {
        approvalStatus: 'REJECTED',
        estadoRendicion: 'anulado',
        anuladoAt: now,
        anuladoBy: adminUid,
        anulacionRazon: reason.trim() || 'Desconfirmacion administrativa',
        updatedAt: now,
      });
      transaction.set(auditRef, {
        id: auditRef.id,
        companyId: COMPANY_ID,
        action: 'ANNUL_PENDING_SETTLEMENT',
        entity: 'PAYMENT',
        entityId: paymentId,
        details: JSON.stringify({
          loanId: payment.loanId,
          amount: payment.amount,
          adminName,
          reason,
        }),
        createdBy: adminUid,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    const principalApplied = payment.principalApplied || 0;
    const interestApplied = payment.interestApplied || 0;
    const lateFeeApplied = payment.arrearsApplied || 0;
    const shouldRevertLoanImpact = payment.loanImpactApplied !== false;
    const revertedPrincipalBalance = Math.max(0, (loan.currentBalance || 0) + principalApplied);
    const revertedInterestBalance = Math.max(
      0,
      (loan.accruedInterestBalance || 0) + interestApplied
    );
    const revertedLateFeeBalance = Math.max(
      0,
      (loan.accruedLateFeeBalance || 0) + lateFeeApplied
    );
    const revertedStatus: Loan['status'] =
      loan.status === 'FROZEN' ? 'FROZEN' : revertedPrincipalBalance <= 0 &&
        revertedInterestBalance <= 0 &&
        revertedLateFeeBalance <= 0
        ? 'PAID'
        : 'ACTIVE';

    if (shouldRevertLoanImpact) {
      const revertedTotal = revertedPrincipalBalance + revertedInterestBalance + revertedLateFeeBalance;
      const pendingAfterRevert = Math.max(0, loan.totalPendienteAprobacion || 0);
      transaction.update(loanRef, {
        currentBalance: revertedPrincipalBalance,
        totalAmount: revertedTotal,
        paidAmount: Math.max(0, (loan.paidAmount || 0) - (payment.amount || 0)),
        interestPaidAmount: Math.max(
          0,
          (loan.interestPaidAmount || 0) - interestApplied - lateFeeApplied
        ),
        accruedInterestBalance: revertedInterestBalance,
        accruedLateFeeBalance: revertedLateFeeBalance,
        status: revertedStatus,
        saldoDefinitivo: revertedTotal,
        saldoProvisorio: Math.max(0, revertedTotal - pendingAfterRevert),
        totalPagadoAprobado: Math.max(
          0,
          (loan.totalPagadoAprobado || loan.paidAmount || 0) - (payment.amount || 0)
        ),
        tienePagosPendientes: pendingAfterRevert > 0,
        estadoCobranza:
          revertedStatus === 'PAID' && pendingAfterRevert === 0
            ? 'pagado'
            : pendingAfterRevert > 0
              ? 'pendiente_aprobacion'
              : 'activo',
        updatedAt: now,
      });
    }

    transaction.update(paymentRef, {
      approvalStatus: 'REJECTED',
      estadoRendicion: 'anulado',
      anuladoAt: now,
      anuladoBy: adminUid,
      anulacionRazon: reason.trim() || 'Desconfirmacion administrativa',
      updatedAt: now,
    });

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'ANNUL_SETTLEMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      details: JSON.stringify({
        loanId: payment.loanId,
        amount: payment.amount,
        principalApplied,
        interestApplied,
        lateFeeApplied,
        loanImpactReverted: shouldRevertLoanImpact,
        adminName,
        reason,
      }),
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
    });
  });
};

export const regularizeLegacyPendingPayments = async (adminUid: string) => {
  const pendingPaymentsSnap = await getDocs(
    query(collection(db, `companies/${COMPANY_ID}/payments`), where('approvalStatus', '==', 'PENDING'))
  );

  let processed = 0;

  for (const paymentDoc of pendingPaymentsSnap.docs) {
    const payment = paymentDoc.data() as Payment;
    if (payment.loanImpactApplied === false) continue;

    const paymentRef = doc(db, `companies/${COMPANY_ID}/payments`, paymentDoc.id);
    const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, payment.loanId);
    const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));

    await runTransaction(db, async (transaction) => {
      const loanDoc = await transaction.get(loanRef);
      const paymentTxDoc = await transaction.get(paymentRef);
      if (!loanDoc.exists() || !paymentTxDoc.exists()) return;

      const currentPayment = paymentTxDoc.data() as Payment;
      if (currentPayment.approvalStatus !== 'PENDING' || currentPayment.loanImpactApplied === false) return;

      const loan = loanDoc.data() as Loan;
      const principalApplied = currentPayment.principalApplied || 0;
      const interestApplied = currentPayment.interestApplied || 0;
      const arrearsApplied = currentPayment.arrearsApplied || 0;

      const revertedPrincipal = (loan.currentBalance || 0) + principalApplied;
      const revertedInterest = (loan.accruedInterestBalance || 0) + interestApplied;
      const revertedLateFee = (loan.accruedLateFeeBalance || 0) + arrearsApplied;

      transaction.update(loanRef, {
        currentBalance: revertedPrincipal,
        totalAmount: revertedPrincipal + revertedInterest + revertedLateFee,
        paidAmount: Math.max(0, (loan.paidAmount || 0) - (currentPayment.amount || 0)),
        interestPaidAmount: Math.max(
          0,
          (loan.interestPaidAmount || 0) - interestApplied - arrearsApplied
        ),
        accruedInterestBalance: revertedInterest,
        accruedLateFeeBalance: revertedLateFee,
        status: loan.status === 'FROZEN' ? 'FROZEN' : 'ACTIVE',
        updatedAt: Date.now(),
      });

      transaction.update(paymentRef, {
        loanImpactApplied: false,
        updatedAt: Date.now(),
      });

      transaction.set(auditRef, {
        id: auditRef.id,
        companyId: COMPANY_ID,
        action: 'REGULARIZE_PENDING_SETTLEMENT',
        entity: 'PAYMENT',
        entityId: paymentDoc.id,
        details: JSON.stringify({
          loanId: currentPayment.loanId,
          amount: currentPayment.amount,
        }),
        createdBy: adminUid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    processed += 1;
  }

  return processed;
};

const getLatestApprovedPaymentForLoan = async (loanId: string) => {
  const paymentsSnap = await getDocs(
    query(collection(db, `companies/${COMPANY_ID}/payments`), where('loanId', '==', loanId))
  );

  return paymentsSnap.docs
    .filter((docItem) => ((docItem.data() as Payment).approvalStatus || 'APPROVED') === 'APPROVED')
    .sort((left, right) => {
      const leftData = left.data() as Payment;
      const rightData = right.data() as Payment;
      return (
        (rightData.paidAt || rightData.createdAt || 0) -
        (leftData.paidAt || leftData.createdAt || 0)
      );
    })[0];
};

export const updatePaymentAdmin = async (
  paymentId: string,
  newAmount: number,
  adminUid: string
) => {
  if (newAmount <= 0) {
    throw new Error('El monto del abono debe ser mayor a 0.');
  }

  const paymentRef = doc(db, `companies/${COMPANY_ID}/payments`, paymentId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));
  const paymentDoc = await getDoc(paymentRef);
  if (!paymentDoc.exists()) throw new Error('El abono no existe.');
  const payment = paymentDoc.data() as Payment;
  const latestApproved = await getLatestApprovedPaymentForLoan(payment.loanId);
  if (!latestApproved || latestApproved.id !== paymentId) {
    throw new Error('Solo se puede editar el ultimo abono aprobado de este credito.');
  }

  await runTransaction(db, async (transaction) => {
    const paymentDocTx = await transaction.get(paymentRef);
    if (!paymentDocTx.exists()) throw new Error('El abono no existe.');
    if ((payment.approvalStatus || 'APPROVED') !== 'APPROVED') {
      throw new Error('Solo se pueden editar abonos ya aprobados.');
    }

    const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, payment.loanId);
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito asociado no existe.');
    const loan = loanDoc.data() as Loan;

    const revertedPrincipalBalance = (loan.currentBalance || 0) + (payment.principalApplied || 0);
    const revertedInterestBalance =
      (loan.accruedInterestBalance || 0) + (payment.interestApplied || 0);
    const revertedLateFeeBalance =
      (loan.accruedLateFeeBalance || 0) + (payment.arrearsApplied || 0);
    const revertedPaidAmount = Math.max(0, (loan.paidAmount || 0) - payment.amount);
    const revertedInterestPaid = Math.max(
      0,
      (loan.interestPaidAmount || 0) -
        (payment.interestApplied || 0) -
        (payment.arrearsApplied || 0)
    );

    const maxEditableAmount =
      payment.paymentType === 'CAPITAL'
        ? revertedPrincipalBalance
        : payment.paymentType === 'INTEREST'
          ? revertedInterestBalance + revertedLateFeeBalance
          : revertedPrincipalBalance + revertedInterestBalance + revertedLateFeeBalance;

    if (newAmount > maxEditableAmount) {
      throw new Error(
        `El nuevo monto no puede superar ${(payment.currency || 'PYG') === 'USD' ? 'USD' : 'Gs.'} ${maxEditableAmount.toLocaleString('es-PY')}.`
      );
    }

    const recalculated = applyPaymentByType(
      {
        principalBalance: payment.previousBalance || revertedPrincipalBalance,
        accruedInterestBalance: payment.interestDueAtPayment || revertedInterestBalance,
        accruedLateFeeBalance: payment.lateFeeDueAtPayment || revertedLateFeeBalance,
      },
      newAmount,
      payment.paymentType || 'MIXED'
    );

    const newLateFeeApplied = recalculated.lateFeeApplied;
    const newInterestApplied = recalculated.interestApplied;
    const newPrincipalApplied = recalculated.principalApplied;
    const newPrincipalBalance = recalculated.resultingPrincipalBalance;
    const newInterestBalance = recalculated.resultingInterestBalance;
    const newLateFeeBalance = recalculated.resultingLateFeeBalance;

    transaction.update(loanRef, {
      currentBalance: newPrincipalBalance,
      totalAmount: newPrincipalBalance + newInterestBalance + newLateFeeBalance,
      paidAmount: revertedPaidAmount + newAmount,
      interestPaidAmount: revertedInterestPaid + newLateFeeApplied + newInterestApplied,
      accruedInterestBalance: newInterestBalance,
      accruedLateFeeBalance: newLateFeeBalance,
      status:
        newPrincipalBalance <= 0 && newInterestBalance <= 0 && newLateFeeBalance <= 0
          ? 'PAID'
          : loan.status === 'FROZEN'
            ? 'FROZEN'
            : 'ACTIVE',
      updatedAt: Date.now(),
    });

    transaction.update(paymentRef, {
      amount: newAmount,
      newBalance: newPrincipalBalance,
      principalApplied: newPrincipalApplied,
      interestApplied: newInterestApplied,
      arrearsApplied: newLateFeeApplied,
      resultingInterestBalance: newInterestBalance,
      resultingLateFeeBalance: newLateFeeBalance,
      commissionAmount: newAmount * 0.07,
      updatedAt: Date.now(),
    });

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'UPDATE_PAYMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      details: JSON.stringify({
        loanId: payment.loanId,
        previousAmount: payment.amount,
        newAmount,
      }),
      createdBy: adminUid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
};

export const deletePaymentAdmin = async (paymentId: string, adminUid: string, reason: string) => {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error('La razon de anulacion es obligatoria.');
  const paymentRef = doc(db, `companies/${COMPANY_ID}/payments`, paymentId);
  const auditRef = doc(collection(db, `companies/${COMPANY_ID}/auditLogs`));
  const paymentDoc = await getDoc(paymentRef);
  if (!paymentDoc.exists()) throw new Error('El abono no existe.');
  const payment = paymentDoc.data() as Payment;
  const latestApproved = await getLatestApprovedPaymentForLoan(payment.loanId);
  if (!latestApproved || latestApproved.id !== paymentId) {
    throw new Error('Solo se puede eliminar el ultimo abono aprobado de este credito.');
  }

  await runTransaction(db, async (transaction) => {
    const paymentDocTx = await transaction.get(paymentRef);
    if (!paymentDocTx.exists()) throw new Error('El abono no existe.');
    if ((payment.approvalStatus || 'APPROVED') !== 'APPROVED' || payment.estadoRendicion === 'anulado') {
      throw new Error('Solo se pueden eliminar abonos ya aprobados.');
    }

    const loanRef = doc(db, `companies/${COMPANY_ID}/loans`, payment.loanId);
    const loanDoc = await transaction.get(loanRef);
    if (!loanDoc.exists()) throw new Error('El credito asociado no existe.');
    const loan = loanDoc.data() as Loan;

    transaction.update(loanRef, {
      currentBalance: (loan.currentBalance || 0) + (payment.principalApplied || 0),
      totalAmount:
        (loan.currentBalance || 0) +
        (payment.principalApplied || 0) +
        (loan.accruedInterestBalance || 0) +
        (payment.interestApplied || 0) +
        (loan.accruedLateFeeBalance || 0) +
        (payment.arrearsApplied || 0),
      paidAmount: Math.max(0, (loan.paidAmount || 0) - payment.amount),
      interestPaidAmount: Math.max(
        0,
        (loan.interestPaidAmount || 0) -
          (payment.interestApplied || 0) -
          (payment.arrearsApplied || 0)
      ),
      accruedInterestBalance:
        (loan.accruedInterestBalance || 0) + (payment.interestApplied || 0),
      accruedLateFeeBalance:
        (loan.accruedLateFeeBalance || 0) + (payment.arrearsApplied || 0),
      status: loan.status === 'FROZEN' ? 'FROZEN' : 'ACTIVE',
      updatedAt: Date.now(),
    });

    transaction.update(paymentRef, {
      estadoRendicion: 'anulado',
      anuladoAt: Date.now(),
      anuladoBy: adminUid,
      anulacionRazon: normalizedReason,
      updatedAt: Date.now(),
    });

    transaction.set(auditRef, {
      id: auditRef.id,
      companyId: COMPANY_ID,
      action: 'ANNUL_PAYMENT',
      entity: 'PAYMENT',
      entityId: paymentId,
      details: JSON.stringify({
        loanId: payment.loanId,
        amount: payment.amount,
        reason: normalizedReason,
      }),
      createdBy: adminUid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
};
