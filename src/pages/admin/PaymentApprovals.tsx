import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  where,
} from 'firebase/firestore';
import { COMPANY_ID, db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Loan, Payment, SlotMachineEntry, User } from '../../types';
import {
  approvePayment,
  regularizeLegacyPendingPayments,
  unapprovePayment,
} from '../../services/paymentService';
import {
  approveSlotMachineEntry,
  getSlotMachineEntries,
  getSlotMachineEntriesForApproval,
  unapproveSlotMachineEntry,
} from '../../services/slotMachineService';
import { syncFinancialPayment } from '../../services/userService';
import { formatCurrencyAmount } from '../../utils/currencyUtils';

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfDay = (value: string) => new Date(`${value}T00:00:00`).getTime();
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).getTime();
const isCompleteDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(startOfDay(value));
const paymentSelectionId = (paymentId: string) => `PAYMENT:${paymentId}`;
const slotMachineSelectionId = (entryId: string) => `SLOT_MACHINE:${entryId}`;
const APPROVAL_PAGE_LIMIT = 150;

const isIndexBuildError = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('requires an index') ||
    error.message.includes('currently building') ||
    error.message.includes('FAILED_PRECONDITION'));

const fetchMappedDocsByIds = async <T,>(
  collectionPath: string,
  ids: string[],
  mapValue: (id: string, data: T) => T | string
) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const mapped: Record<string, T | string> = {};

  for (let index = 0; index < uniqueIds.length; index += 10) {
    const batch = uniqueIds.slice(index, index + 10);
    const snapshot = await getDocs(
      query(collection(db, collectionPath), where(documentId(), 'in', batch))
    );
    snapshot.docs.forEach((item) => {
      mapped[item.id] = mapValue(item.id, item.data() as T);
    });
  }

  return mapped;
};

export default function PaymentApprovals() {
  const { userData } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [slotMachineEntries, setSlotMachineEntries] = useState<SlotMachineEntry[]>([]);
  const [clientsById, setClientsById] = useState<Record<string, string>>({});
  const [loansById, setLoansById] = useState<Record<string, Loan>>({});
  const [collectors, setCollectors] = useState<User[]>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [regularizing, setRegularizing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const todayInput = formatDateInput(new Date());
  const [dateFrom, setDateFrom] = useState(todayInput);
  const [dateTo, setDateTo] = useState(todayInput);
  const [dateFromDraft, setDateFromDraft] = useState(todayInput);
  const [dateToDraft, setDateToDraft] = useState(todayInput);
  const [selectedCollectorId, setSelectedCollectorId] = useState<'ALL' | string>('ALL');
  const [renderedFilter, setRenderedFilter] = useState<'ALL' | 'SI' | 'NO'>('NO');

  const updateDateRangeDraft = (nextDateFrom: string, nextDateTo: string) => {
    setDateFromDraft(nextDateFrom);
    setDateToDraft(nextDateTo);
    if (isCompleteDate(nextDateFrom) && isCompleteDate(nextDateTo)) {
      setDateFrom(nextDateFrom);
      setDateTo(nextDateTo);
    }
  };

  const applyDateRange = () => {
    if (!isCompleteDate(dateFromDraft) || !isCompleteDate(dateToDraft)) {
      setActionError('Completa ambas fechas antes de buscar.');
      return;
    }
    setActionError(null);
    setDateFrom(dateFromDraft);
    setDateTo(dateToDraft);
  };

  const loadPendingPayments = useCallback(async () => {
    if (!userData) return;
    setLoading(true);
    try {
      const approvalStatus =
        renderedFilter === 'NO' ? 'PENDING' : renderedFilter === 'SI' ? 'APPROVED' : undefined;
      const paymentConstraints: QueryConstraint[] = [
        where('paidAt', '>=', startOfDay(dateFrom)),
        where('paidAt', '<=', endOfDay(dateTo)),
      ];

      if (approvalStatus) {
        paymentConstraints.push(where('approvalStatus', '==', approvalStatus));
      }
      if (selectedCollectorId !== 'ALL') {
        paymentConstraints.push(where('collectorId', '==', selectedCollectorId));
      }
      paymentConstraints.push(orderBy('paidAt', 'desc'), limit(APPROVAL_PAGE_LIMIT));

      const paymentsPromise = getDocs(
        query(collection(db, `companies/${COMPANY_ID}/payments`), ...paymentConstraints)
      ).catch((error: unknown) => {
        if (!isIndexBuildError(error)) throw error;

        const fallbackConstraints: QueryConstraint[] = [];
        if (approvalStatus) {
          fallbackConstraints.push(where('approvalStatus', '==', approvalStatus));
        } else if (selectedCollectorId !== 'ALL') {
          fallbackConstraints.push(where('collectorId', '==', selectedCollectorId));
        } else {
          fallbackConstraints.push(where('paidAt', '>=', startOfDay(dateFrom)));
          fallbackConstraints.push(where('paidAt', '<=', endOfDay(dateTo)));
        }
        fallbackConstraints.push(limit(APPROVAL_PAGE_LIMIT * 3));
        return getDocs(query(collection(db, `companies/${COMPANY_ID}/payments`), ...fallbackConstraints));
      });

      const slotEntriesPromise = getSlotMachineEntriesForApproval({
        userData,
        approvalStatus,
        collectorId: selectedCollectorId === 'ALL' ? undefined : selectedCollectorId,
        dateFrom: startOfDay(dateFrom),
        dateTo: endOfDay(dateTo),
        maxResults: APPROVAL_PAGE_LIMIT,
      }).catch((error: unknown) => {
        if (!isIndexBuildError(error)) throw error;
        return getSlotMachineEntries(userData);
      });

      const [paymentsSnapshot, usersSnapshot, slotEntriesData] = await Promise.all([
        paymentsPromise,
        getDocs(
          query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))
        ),
        slotEntriesPromise,
      ]);

      const nextPayments = paymentsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Payment)
        .filter((payment) => payment.estadoRendicion !== 'anulado')
        .filter((payment) => {
          const paymentDate = payment.paidAt || payment.createdAt || 0;
          const matchesDate = paymentDate >= startOfDay(dateFrom) && paymentDate <= endOfDay(dateTo);
          const matchesCollector =
            selectedCollectorId === 'ALL' || payment.collectorId === selectedCollectorId;
          const isRendered = payment.approvalStatus === 'APPROVED';
          const matchesRendered =
            renderedFilter === 'ALL' ||
            (renderedFilter === 'SI' && isRendered) ||
            (renderedFilter === 'NO' && !isRendered);
          return matchesDate && matchesCollector && matchesRendered;
        })
        .slice(0, APPROVAL_PAGE_LIMIT);
      const [mappedClients, mappedLoans] = await Promise.all([
        fetchMappedDocsByIds<{ fullName?: string }>(
          `companies/${COMPANY_ID}/clients`,
          nextPayments.map((payment) => payment.clientId),
          (id, data) => data.fullName || id
        ),
        fetchMappedDocsByIds<Loan>(
          `companies/${COMPANY_ID}/loans`,
          nextPayments.map((payment) => payment.loanId),
          (id, data) => ({ id, ...data } as Loan)
        ),
      ]);

      setClientsById(mappedClients as Record<string, string>);
      setLoansById(mappedLoans as Record<string, Loan>);
      setCollectors(
        usersSnapshot.docs
          .map((item) => item.data() as User)
          .filter((user) => user.isActive && (user.role === 'COLLECTOR' || user.role === 'ADMIN'))
          .sort((left, right) => left.name.localeCompare(right.name, 'es'))
      );

      setPayments(
        nextPayments.sort((left, right) => (right.paidAt || right.createdAt) - (left.paidAt || left.createdAt))
      );
      setSlotMachineEntries(slotEntriesData);
      setSelectedPaymentIds([]);
    } catch (error) {
      console.error('Error cargando rendiciones:', error);
      alert('No se pudieron cargar las rendiciones con los filtros seleccionados.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, renderedFilter, selectedCollectorId, userData]);

  useEffect(() => {
    void loadPendingPayments();
  }, [loadPendingPayments]);

  const filteredPayments = payments.filter((payment) => {
    if (payment.estadoRendicion === 'anulado') return false;
    const paymentDate = payment.paidAt || payment.createdAt || 0;
    const matchesDate = paymentDate >= startOfDay(dateFrom) && paymentDate <= endOfDay(dateTo);
    const matchesCollector =
      selectedCollectorId === 'ALL' || payment.collectorId === selectedCollectorId;
    const isRendered = payment.approvalStatus === 'APPROVED';
    const matchesRendered =
      renderedFilter === 'ALL' ||
      (renderedFilter === 'SI' && isRendered) ||
      (renderedFilter === 'NO' && !isRendered);
    return matchesDate && matchesCollector && matchesRendered;
  });
  const filteredSlotMachineEntries = slotMachineEntries.filter((entry) => {
    const entryDate = entry.collectionDate || entry.createdAt || 0;
    const matchesDate = entryDate >= startOfDay(dateFrom) && entryDate <= endOfDay(dateTo);
    const matchesCollector =
      selectedCollectorId === 'ALL' || entry.collectorId === selectedCollectorId;
    const isRendered = entry.approvalStatus === 'APPROVED';
    const matchesRendered =
      renderedFilter === 'ALL' ||
      (renderedFilter === 'SI' && isRendered) ||
      (renderedFilter === 'NO' && !isRendered);
    return matchesDate && matchesCollector && matchesRendered;
  });
  const pendingFilteredPayments = filteredPayments.filter(
    (payment) => payment.approvalStatus === 'PENDING'
  );
  const renderedFilteredPayments = filteredPayments.filter(
    (payment) => payment.approvalStatus === 'APPROVED'
  );
  const pendingFilteredSlotMachineEntries = filteredSlotMachineEntries.filter(
    (entry) => entry.approvalStatus !== 'APPROVED'
  );
  const renderedFilteredSlotMachineEntries = filteredSlotMachineEntries.filter(
    (entry) => entry.approvalStatus === 'APPROVED'
  );
  const filteredSettlementIds = [
    ...filteredPayments.map((payment) => payment.id).filter(Boolean).map((id) => paymentSelectionId(id!)),
    ...filteredSlotMachineEntries.map((entry) => entry.id).filter(Boolean).map((id) => slotMachineSelectionId(id!)),
  ];
  const pendingFilteredSettlementIds = [
    ...pendingFilteredPayments.map((payment) => payment.id).filter(Boolean).map((id) => paymentSelectionId(id!)),
    ...pendingFilteredSlotMachineEntries.map((entry) => entry.id).filter(Boolean).map((id) => slotMachineSelectionId(id!)),
  ];
  const renderedFilteredSettlementIds = [
    ...renderedFilteredPayments.map((payment) => payment.id).filter(Boolean).map((id) => paymentSelectionId(id!)),
    ...renderedFilteredSlotMachineEntries.map((entry) => entry.id).filter(Boolean).map((id) => slotMachineSelectionId(id!)),
  ];

  const handleToggleSelection = (paymentId: string) => {
    setSelectedPaymentIds((current) =>
      current.includes(paymentId)
        ? current.filter((id) => id !== paymentId)
        : [...current, paymentId]
    );
  };

  const handleToggleSelectAll = () => {
    setSelectedPaymentIds((current) =>
      current.length === filteredSettlementIds.length
        ? []
        : filteredSettlementIds
    );
  };

  const handleApproveSelected = async () => {
    if (!userData || selectedPaymentIds.length === 0) return;
    if (
      !window.confirm(
        'Esta accion aprobara los pagos seleccionados y actualizara saldos definitivos. Desea continuar?'
      )
    ) {
      return;
    }
    setProcessingBulk(true);
    setActionError(null);
    try {
      for (const settlementId of selectedPaymentIds) {
        const [kind, itemId] = settlementId.split(':');
        if (kind === 'PAYMENT') {
          await approvePayment(itemId, userData.uid, userData.name);
          await syncFinancialPayment(itemId);
        }
        if (kind === 'SLOT_MACHINE') {
          await approveSlotMachineEntry(itemId, userData.uid, userData.name);
        }
      }
      await loadPendingPayments();
    } catch (error) {
      console.error('Error aprobando rendicion:', error);
      setActionError('No se pudo aprobar la rendicion seleccionada.');
    } finally {
      setProcessingBulk(false);
    }
  };

  const handleUnapproveSelected = async () => {
    if (!userData || selectedPaymentIds.length === 0) return;
    if (
      !window.confirm(
        'Esta accion desconfirmara la rendicion seleccionada. Los pagos no impactaran como saldo definitivo. Desea continuar?'
      )
    ) {
      return;
    }
    const reason = window.prompt('Indique el motivo de desconfirmacion/rechazo:');
    if (reason === null) return;
    if (!reason.trim()) {
      setActionError('Debes indicar un motivo de desconfirmacion.');
      return;
    }
    setProcessingBulk(true);
    setActionError(null);
    try {
      for (const settlementId of selectedPaymentIds) {
        const [kind, itemId] = settlementId.split(':');
        if (kind === 'PAYMENT') {
          await unapprovePayment(itemId, userData.uid, userData.name, reason.trim());
          await syncFinancialPayment(itemId);
        }
        if (kind === 'SLOT_MACHINE') {
          await unapproveSlotMachineEntry(itemId, userData.uid, userData.name, reason.trim());
        }
      }
      await loadPendingPayments();
    } catch (error) {
      console.error('Error desconfirmando rendicion:', error);
      setActionError('No se pudo desconfirmar la rendicion seleccionada.');
    } finally {
      setProcessingBulk(false);
    }
  };

  const handleRegularizeLegacyPending = async () => {
    if (!userData) return;
    if (!window.confirm('Esto regulariza NO rendidos antiguos para que no impacten como abonado. Continuar?')) return;
    setRegularizing(true);
    const processed = await regularizeLegacyPendingPayments(userData.uid);
    await loadPendingPayments();
    setRegularizing(false);
    alert(`Regularizacion completada. Cobros ajustados: ${processed}`);
  };

  const selectedTotal = payments
    .filter((payment) => payment.id && selectedPaymentIds.includes(paymentSelectionId(payment.id)))
    .reduce((accumulator, payment) => accumulator + payment.amount, 0);
  const selectedSlotMachineTotal = slotMachineEntries
    .filter((entry) => entry.id && selectedPaymentIds.includes(slotMachineSelectionId(entry.id)))
    .reduce((accumulator, entry) => accumulator + entry.amount, 0);

  const pendingTotal =
    filteredPayments.reduce((accumulator, payment) => accumulator + payment.amount, 0) +
    filteredSlotMachineEntries.reduce((accumulator, entry) => accumulator + entry.amount, 0);
  const totalToRender = selectedPaymentIds.length > 0
    ? selectedTotal + selectedSlotMachineTotal
    : pendingTotal;
  const totalCurrency = filteredPayments[0]?.currency || 'PYG';
  const sumInterestPortion = filteredPayments.reduce(
    (accumulator, payment) => accumulator + (payment.interestApplied || 0) + (payment.arrearsApplied || 0),
    0
  );
  const sumPrincipalPortion = filteredPayments.reduce(
    (accumulator, payment) => accumulator + (payment.principalApplied || 0),
    0
  );

  if (loading) {
    return <div className="text-gray-500">Cargando rendiciones pendientes...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
        Aqui se confirma o desconfirma la rendicion del cobrador.
      </div>
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {actionError}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white border border-gray-200 rounded-lg p-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Desde</label>
          <input
            type="date"
            value={dateFromDraft}
            onChange={(event) => updateDateRangeDraft(event.target.value, dateToDraft)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Hasta</label>
          <input
            type="date"
            value={dateToDraft}
            onChange={(event) => updateDateRangeDraft(dateFromDraft, event.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Cobrador/Admin</label>
          <select
            value={selectedCollectorId}
            onChange={(event) => setSelectedCollectorId(event.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="ALL">Todos</option>
            {collectors.map((collector) => (
              <option key={collector.uid} value={collector.uid}>
                {collector.name} {collector.role === 'ADMIN' ? '(Admin)' : '(Cobrador)'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Rendido</label>
          <select
            value={renderedFilter}
            onChange={(event) => setRenderedFilter(event.target.value as 'ALL' | 'SI' | 'NO')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="NO">NO</option>
            <option value="SI">SI</option>
            <option value="ALL">Todas</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={applyDateRange}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Actualizar
          </button>
        </div>
      </div>

      {filteredSettlementIds.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
          No hay rendiciones para esos filtros.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleRegularizeLegacyPending()}
                disabled={regularizing || processingBulk}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {regularizing ? 'Regularizando...' : 'Regularizar NO rendidos antiguos'}
              </button>
              <button
                onClick={() => void handleApproveSelected()}
                disabled={selectedPaymentIds.length === 0 || processingBulk}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {processingBulk ? 'Procesando...' : `Confirmar seleccionados (${selectedPaymentIds.length})`}
              </button>
              <button
                onClick={() => void handleUnapproveSelected()}
                disabled={selectedPaymentIds.length === 0 || processingBulk}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {processingBulk ? 'Procesando...' : `Desconfirmar seleccionados (${selectedPaymentIds.length})`}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
              <button
                type="button"
                onClick={() => setSelectedPaymentIds(pendingFilteredSettlementIds)}
                className="text-slate-700 hover:underline"
              >
                Seleccionar NO
              </button>
              <button
                type="button"
                onClick={() => setSelectedPaymentIds(renderedFilteredSettlementIds)}
                className="text-slate-700 hover:underline"
              >
                Seleccionar SI
              </button>
              <button
                type="button"
                onClick={() => setSelectedPaymentIds([])}
                className="text-slate-500 hover:underline"
              >
                Limpiar
              </button>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedPaymentIds.length > 0 && selectedPaymentIds.length === filteredSettlementIds.length}
                  onChange={handleToggleSelectAll}
                  className="rounded border-gray-300"
                />
                Seleccionar todos
              </label>
            </div>
          </div>

          {filteredPayments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="py-2 px-3 text-left">SEL</th>
                    <th className="py-2 px-3 text-left">RENDIDO</th>
                    <th className="py-2 px-3 text-right">PRESTADO</th>
                    <th className="py-2 px-3 text-left">CLIENTE</th>
                    <th className="py-2 px-3 text-left">DESCRIPCION</th>
                    <th className="py-2 px-3 text-right">MONTO</th>
                    <th className="py-2 px-3 text-right">MORA/INTERES</th>
                    <th className="py-2 px-3 text-right">CAPITAL</th>
                    <th className="py-2 px-3 text-right">SALDO ANT.</th>
                    <th className="py-2 px-3 text-right">PROVISORIO</th>
                    <th className="py-2 px-3 text-right">RESULTADO</th>
                    <th className="py-2 px-3 text-left">FECHA</th>
                    <th className="py-2 px-3 text-left">MONEDA</th>
                    <th className="py-2 px-3 text-left">TIPO</th>
                    <th className="py-2 px-3 text-right">INTERES</th>
                    <th className="py-2 px-3 text-right">ATRASO</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 text-xs font-semibold text-slate-700" colSpan={16}>
                      COBROS
                    </td>
                  </tr>
                  {filteredPayments.map((payment) => {
                    const linkedLoan = loansById[payment.loanId];
                    const paymentDate = payment.paidAt || payment.createdAt || 0;
                    const dueDate = linkedLoan?.expiresAt || paymentDate;
                    const atrasoDays = Math.max(0, Math.floor((paymentDate - dueDate) / (1000 * 60 * 60 * 24)));
                    const description =
                      linkedLoan?.description ||
                      linkedLoan?.pawnDescription ||
                      (linkedLoan?.status === 'FROZEN' ? 'CREDITO CONGELADO' : 'CREDITO');
                    const interestAmount =
                      payment.interestDueAtPayment ||
                      payment.interestCharged ||
                      payment.resultingInterestBalance ||
                      0;
                    const interestAndMoraApplied =
                      (payment.interestApplied || 0) + (payment.arrearsApplied || 0);
                    const saldoAnterior =
                      payment.previousBalance ||
                      (linkedLoan?.currentBalance || 0) +
                        (linkedLoan?.accruedInterestBalance || 0) +
                        (linkedLoan?.accruedLateFeeBalance || 0);
                    const saldoProvisorio = Math.max(0, saldoAnterior - (payment.amount || 0));
                    const saldoResultante =
                      payment.approvalStatus === 'APPROVED'
                        ? payment.newBalance ?? linkedLoan?.currentBalance ?? saldoProvisorio
                        : saldoProvisorio;
                    const selectionId = payment.id ? paymentSelectionId(payment.id) : '';

                    return (
                      <tr key={payment.id} className="border-b border-gray-100 last:border-b-0 text-gray-800">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={!!selectionId && selectedPaymentIds.includes(selectionId)}
                            onChange={() => selectionId && handleToggleSelection(selectionId)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="py-2 px-3">{payment.approvalStatus === 'APPROVED' ? 'SI' : 'NO'}</td>
                        <td className="py-2 px-3 text-right">{(linkedLoan?.principal || 0).toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3">{payment.clientName || clientsById[payment.clientId] || payment.clientId}</td>
                        <td className="py-2 px-3">{description}</td>
                        <td className="py-2 px-3 text-right">{payment.amount.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">{interestAndMoraApplied.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">{(payment.principalApplied || 0).toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">{saldoAnterior.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">{saldoProvisorio.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">{saldoResultante.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3">{new Date(paymentDate).toLocaleDateString('es-PY')}</td>
                        <td className="py-2 px-3">{(payment.currency || 'PYG') === 'PYG' ? 'Guarani' : 'USD'}</td>
                        <td className="py-2 px-3 font-semibold text-emerald-600">COBRO</td>
                        <td className="py-2 px-3 text-right">{interestAmount.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">{atrasoDays}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-3 py-3 text-slate-800">Suma cobros</td>
                    <td className="px-3 py-3" colSpan={4}></td>
                    <td className="px-3 py-3 text-right text-slate-800">
                      {filteredPayments.reduce((accumulator, payment) => accumulator + payment.amount, 0).toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-800">{sumInterestPortion.toLocaleString('es-PY')}</td>
                    <td className="px-3 py-3 text-right text-slate-800">{sumPrincipalPortion.toLocaleString('es-PY')}</td>
                    <td className="px-3 py-3" colSpan={8}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {filteredSlotMachineEntries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="py-2 px-3 text-left">SEL</th>
                    <th className="py-2 px-3 text-left">RENDIDO</th>
                    <th className="py-2 px-3 text-left">UBICACION</th>
                    <th className="py-2 px-3 text-left">COBRADOR</th>
                    <th className="py-2 px-3 text-left">FECHA</th>
                    <th className="py-2 px-3 text-right">MONTO</th>
                    <th className="py-2 px-3 text-right">COMISION</th>
                    <th className="py-2 px-3 text-left">OBSERVACION</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 text-xs font-semibold text-slate-700" colSpan={8}>
                      TRAGAMONEDAS
                    </td>
                  </tr>
                  {filteredSlotMachineEntries.map((entry) => {
                    const selectionId = entry.id ? slotMachineSelectionId(entry.id) : '';
                    return (
                      <tr key={entry.id} className="border-b border-gray-100 last:border-b-0 text-gray-800">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={!!selectionId && selectedPaymentIds.includes(selectionId)}
                            onChange={() => selectionId && handleToggleSelection(selectionId)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="py-2 px-3">{entry.approvalStatus === 'APPROVED' ? 'SI' : 'NO'}</td>
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-900">{entry.locationName}</div>
                          <div className="text-xs text-slate-500">{entry.siteName}</div>
                        </td>
                        <td className="py-2 px-3">{entry.collectorName}</td>
                        <td className="py-2 px-3">{new Date(entry.collectionDate).toLocaleDateString('es-PY')}</td>
                        <td className="py-2 px-3 text-right font-semibold">{entry.amount.toLocaleString('es-PY')}</td>
                        <td className="py-2 px-3 text-right">
                          {entry.commissionAmount.toLocaleString('es-PY')}
                          <span className="ml-1 text-xs text-slate-500">({entry.commissionRate ?? 10}%)</span>
                        </td>
                        <td className="py-2 px-3">{entry.notes || '-'}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-100 font-semibold">
                    <td className="px-3 py-3 text-slate-800" colSpan={5}>Suma tragamonedas</td>
                    <td className="px-3 py-3 text-right text-slate-800">
                      {filteredSlotMachineEntries.reduce((accumulator, entry) => accumulator + entry.amount, 0).toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-800">
                      {filteredSlotMachineEntries.reduce((accumulator, entry) => accumulator + entry.commissionAmount, 0).toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="pt-2 border-t border-gray-200 flex justify-end">
            <p className="text-base font-semibold text-gray-900">
              Total a rendir: {formatCurrencyAmount(totalToRender, totalCurrency)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
