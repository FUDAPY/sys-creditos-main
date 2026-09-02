import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocsFromServer, query, type QueryConstraint, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Loan, Payment, User } from '../../types';
import { getCreditInfo, type CreditStatus } from '../../utils/loanUtils';

type CommissionOverride = 'AUTO' | '5' | '10';

type MovementRow = {
  id: string;
  rendered: 'SI' | 'NO';
  principalAmount: number;
  collectorName: string;
  clientName: string;
  description: string;
  amount: number;
  interestPortion: number;
  commissionRate: number;
  commissionAmount: number;
  clientCategory: CreditStatus | 'SIN_CREDITO';
  date: number;
  currencyLabel: string;
  movementType: 'COBRO';
  interestAmount: number;
  atrasoDays: number;
  creditIdLabel: string;
};

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfDay = (value: string) => new Date(`${value}T00:00:00`).getTime();
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).getTime();
const DEFAULT_GOOD_CLIENT_COMMISSION_RATE = 5;
const BAD_CLIENT_COMMISSION_RATE = 10;

const getDefaultCommissionRate = (loan?: Loan | null) => {
  if (!loan) return DEFAULT_GOOD_CLIENT_COMMISSION_RATE;

  const category = getCreditInfo(loan.expiresAt, loan.inforconfConfirmedAt).status;
  return category === 'BUENO' ? DEFAULT_GOOD_CLIENT_COMMISSION_RATE : BAD_CLIENT_COMMISSION_RATE;
};

export default function ConsultorRecaudador() {
  const { userData } = useAuth();
  const today = useMemo(() => new Date(), []);
  const todayInput = useMemo(() => formatDateInput(today), [today]);

  const [collectors, setCollectors] = useState<Array<User & { id: string }>>([]);
  const [allLoans, setAllLoans] = useState<Array<Loan & { id: string }>>([]);
  const [allPayments, setAllPayments] = useState<Array<Payment & { id: string }>>([]);
  const [clientNamesById, setClientNamesById] = useState<Record<string, string>>({});
  const [selectedCollectorId, setSelectedCollectorId] = useState<'ALL' | string>('ALL');
  const [dateFrom, setDateFrom] = useState(todayInput);
  const [dateTo, setDateTo] = useState(todayInput);
  const [collectorCommissionOverrides, setCollectorCommissionOverrides] = useState<
    Record<string, CommissionOverride>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const rangeStart = startOfDay(dateFrom);
      const rangeEnd = endOfDay(dateTo);
      const loanConstraints: QueryConstraint[] = [
        where('grantedAt', '>=', rangeStart),
        where('grantedAt', '<=', rangeEnd),
      ];
      const paymentConstraints: QueryConstraint[] = [
        where('paidAt', '>=', rangeStart),
        where('paidAt', '<=', rangeEnd),
      ];
      if (selectedCollectorId !== 'ALL') {
        loanConstraints.push(where('collectorId', '==', selectedCollectorId));
        paymentConstraints.push(where('collectorId', '==', selectedCollectorId));
      }

      const usersSnapshot = await getDocsFromServer(
        query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))
      );
      const collectorList = usersSnapshot.docs
        .map((docItem) => ({ id: docItem.id, ...(docItem.data() as User) }))
        .filter((user) => user.role === 'COLLECTOR' || user.role === 'ADMIN')
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));
      setCollectors(collectorList);

      const [loansSnapshot, paymentsSnapshot] = await Promise.all([
        getDocsFromServer(query(collection(db, `companies/${COMPANY_ID}/loans`), ...loanConstraints)),
        getDocsFromServer(query(collection(db, `companies/${COMPANY_ID}/payments`), ...paymentConstraints)),
      ]);

      const payments = paymentsSnapshot.docs.map(
        (docItem) => ({ id: docItem.id, ...(docItem.data() as Payment) })
      );
      const loansById = new Map<string, Loan & { id: string }>();
      loansSnapshot.docs.forEach((docItem) => {
        loansById.set(docItem.id, { id: docItem.id, ...(docItem.data() as Loan) });
      });

      const missingLoanIds = [...new Set(payments.map((payment) => payment.loanId).filter((id) => !loansById.has(id)))];
      for (let index = 0; index < missingLoanIds.length; index += 10) {
        const batch = missingLoanIds.slice(index, index + 10);
        const linkedLoansSnapshot = await getDocsFromServer(
          query(collection(db, `companies/${COMPANY_ID}/loans`), where(documentId(), 'in', batch))
        );
        linkedLoansSnapshot.docs.forEach((docItem) => {
          loansById.set(docItem.id, { id: docItem.id, ...(docItem.data() as Loan) });
        });
      }

      const clientIds = [
        ...new Set([
          ...Array.from(loansById.values()).map((loan) => loan.clientId),
          ...payments.map((payment) => payment.clientId),
        ]),
      ];
      const nextClientNames: Record<string, string> = {};
      for (let index = 0; index < clientIds.length; index += 10) {
        const batch = clientIds.slice(index, index + 10);
        const clientsSnapshot = await getDocsFromServer(
          query(collection(db, `companies/${COMPANY_ID}/clients`), where(documentId(), 'in', batch))
        );
        clientsSnapshot.docs.forEach((clientDoc) => {
          nextClientNames[clientDoc.id] =
            (clientDoc.data() as { fullName?: string }).fullName || 'Cliente no disponible';
        });
      }

      setClientNamesById(nextClientNames);
      setAllLoans(Array.from(loansById.values()));
      setAllPayments(payments);
    } catch (err) {
      console.error('Error cargando datos del consultor:', err);
      setError('No se pudieron cargar los movimientos.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedCollectorId]);

  useEffect(() => {
    if (userData && userData.role !== 'ADMIN') {
      setError('Solo administradores pueden acceder a este consultor.');
      setLoading(false);
      return;
    }
    void loadInitialData();
  }, [loadInitialData, userData]);

  const collectorOptions = useMemo(
    () => [{ id: 'ALL', name: 'Todos' }, ...collectors.map((collector) => ({ id: collector.uid, name: collector.name }))],
    [collectors]
  );

  const rangeStart = useMemo(() => startOfDay(dateFrom), [dateFrom]);
  const rangeEnd = useMemo(() => endOfDay(dateTo), [dateTo]);

  const filteredLoans = useMemo(
    () =>
      allLoans.filter((loan) => {
        const movementDate = loan.grantedAt || loan.createdAt || 0;
        const matchesCollector = selectedCollectorId === 'ALL' || loan.collectorId === selectedCollectorId;
        return loan.currency === 'PYG' && movementDate >= rangeStart && movementDate <= rangeEnd && matchesCollector;
      }),
    [allLoans, rangeEnd, rangeStart, selectedCollectorId]
  );

  const filteredPayments = useMemo(
    () =>
      allPayments.filter((payment) => {
        const movementDate = payment.paidAt || payment.createdAt || 0;
        const matchesCollector = selectedCollectorId === 'ALL' || payment.collectorId === selectedCollectorId;
        return (payment.currency || 'PYG') === 'PYG' && movementDate >= rangeStart && movementDate <= rangeEnd && matchesCollector;
      }),
    [allPayments, rangeEnd, rangeStart, selectedCollectorId]
  );

  const totalGiven = useMemo(
    () => filteredLoans.reduce((sum, loan) => sum + (loan.principal || 0), 0),
    [filteredLoans]
  );
  const totalCollected = useMemo(
    () => filteredPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0),
    [filteredPayments]
  );
  const totalRendered = useMemo(
    () =>
      filteredPayments.reduce(
        (sum, payment) =>
          sum + ((payment.approvalStatus || 'APPROVED') === 'APPROVED' ? payment.amount || 0 : 0),
        0
      ),
    [filteredPayments]
  );
  const totalCommission = useMemo(
    () =>
      filteredPayments.reduce((sum, payment) => {
        if ((payment.approvalStatus || 'APPROVED') !== 'APPROVED') return sum;

        const linkedLoan = allLoans.find((loan) => loan.id === payment.loanId);
        const override = collectorCommissionOverrides[payment.collectorId || ''];
        const commissionRate = override === '5' || override === '10'
          ? Number(override)
          : getDefaultCommissionRate(linkedLoan);

        return sum + (payment.amount || 0) * (commissionRate / 100);
      }, 0),
    [allLoans, collectorCommissionOverrides, filteredPayments]
  );

  const movementRows = useMemo<MovementRow[]>(
    () =>
      filteredPayments
        .map((payment) => {
          const linkedLoan = allLoans.find((loan) => loan.id === payment.loanId);
          const paymentDate = payment.paidAt || payment.createdAt || 0;
          const dueDate = linkedLoan?.expiresAt || paymentDate;
          const dayMs = 1000 * 60 * 60 * 24;
          const atrasoDays = Math.max(0, Math.floor((paymentDate - dueDate) / dayMs));
          const interestPortion = payment.interestApplied || 0;
          const interestAmount =
            payment.interestDueAtPayment ||
            payment.interestCharged ||
            payment.resultingInterestBalance ||
            0;
          const clientCategory: MovementRow['clientCategory'] = linkedLoan
            ? getCreditInfo(linkedLoan.expiresAt, linkedLoan.inforconfConfirmedAt).status
            : 'SIN_CREDITO';
          const override = collectorCommissionOverrides[payment.collectorId || ''];
          const commissionRate = override === '5' || override === '10'
            ? Number(override)
            : getDefaultCommissionRate(linkedLoan);
          const commissionAmount =
            ((payment.approvalStatus || 'APPROVED') === 'APPROVED' ? payment.amount || 0 : 0) *
            (commissionRate / 100);
          const description =
            linkedLoan?.description ||
            linkedLoan?.pawnDescription ||
            (linkedLoan?.status === 'FROZEN' ? 'CREDITO CONGELADO' : 'CREDITO');

          return {
            id: payment.id!,
            rendered: ((payment.approvalStatus || 'APPROVED') === 'APPROVED' ? 'SI' : 'NO') as MovementRow['rendered'],
            principalAmount: linkedLoan?.principal || 0,
            collectorName: payment.collectorName || linkedLoan?.collectorName || 'Sin cobrador',
            clientName: clientNamesById[payment.clientId] || 'Cliente no disponible',
            description: description || 'CREDITO',
            amount: payment.amount || 0,
            interestPortion,
            commissionRate,
            commissionAmount,
            clientCategory,
            date: paymentDate,
            currencyLabel: (payment.currency || linkedLoan?.currency || 'PYG') === 'PYG' ? 'Guarani' : 'USD',
            movementType: 'COBRO' as const,
            interestAmount,
            atrasoDays,
            creditIdLabel: linkedLoan?.id ? linkedLoan.id.slice(0, 8).toUpperCase() : payment.loanId?.slice(0, 8).toUpperCase() || 'N/A',
          };
        })
        .sort((left, right) => right.date - left.date),
    [allLoans, clientNamesById, collectorCommissionOverrides, filteredPayments]
  );

  const sumAmount = useMemo(
    () => movementRows.reduce((sum, row) => sum + row.amount, 0),
    [movementRows]
  );
  const sumInterestPortion = useMemo(
    () => movementRows.reduce((sum, row) => sum + row.interestPortion, 0),
    [movementRows]
  );

  if (userData?.role !== 'ADMIN') {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          Solo administradores pueden acceder a este consultor.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Consultor de Recaudo</h1>
        <p className="mt-1 text-gray-600">Historial por rango de fechas y cobrador.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg bg-white p-4 shadow md:grid-cols-4">
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Cobrador</label>
          <select
            value={selectedCollectorId}
            onChange={(event) => setSelectedCollectorId(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          >
            {collectorOptions.map((collector) => (
              <option key={collector.id} value={collector.id}>
                {collector.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void loadInitialData()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Creditos dados en Gs"
          value={`Gs. ${totalGiven.toLocaleString('es-PY')}`}
          detail="Dentro del rango"
          accent="border-indigo-600"
        />
        <MetricCard
          title="Cobros registrados en Gs"
          value={`Gs. ${totalCollected.toLocaleString('es-PY')}`}
          detail="Dentro del rango"
          accent="border-green-600"
        />
        <MetricCard
          title="Cobros rendidos en Gs"
          value={`Gs. ${totalRendered.toLocaleString('es-PY')}`}
          detail="Aprobados por admin"
          accent="border-blue-600"
        />
        <MetricCard
          title="COMISION"
          value={`Gs. ${Math.round(totalCommission).toLocaleString('es-PY')}`}
          detail="Buenos 5% / malos 10%"
          accent="border-amber-600"
        />
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">Comision por recaudador</h2>
            <p className="text-sm text-gray-500">Auto aplica 5% para BUENO y 10% para clientes malos.</p>
          </div>
          <button
            type="button"
            onClick={() => setCollectorCommissionOverrides({})}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Restablecer auto
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {collectors
            .filter((collector) => selectedCollectorId === 'ALL' || collector.uid === selectedCollectorId)
            .map((collector) => (
              <div
                key={collector.uid}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{collector.name}</p>
                  <p className="text-xs text-gray-500">
                    {collectorCommissionOverrides[collector.uid] === '5'
                      ? 'Forzado 5%'
                      : collectorCommissionOverrides[collector.uid] === '10'
                        ? 'Forzado 10%'
                        : 'Auto'}
                  </p>
                </div>
                <select
                  value={collectorCommissionOverrides[collector.uid] || 'AUTO'}
                  onChange={(event) =>
                    setCollectorCommissionOverrides((previous) => ({
                      ...previous,
                      [collector.uid]: event.target.value as CommissionOverride,
                    }))
                  }
                  className="w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold"
                >
                  <option value="AUTO">Auto</option>
                  <option value="5">5%</option>
                  <option value="10">10%</option>
                </select>
              </div>
            ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h3 className="font-bold text-gray-900">Historial de movimientos</h3>
        </div>
        {error && <div className="border-b border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        <div className="border-b border-gray-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-blue-800">
          Mostrando {movementRows.length} movimiento(s) del {dateFrom} al {dateTo}
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-500">Cargando movimientos...</div>
          ) : movementRows.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">Sin cobros en ese rango.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">RENDIDO</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">PRESTADO</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">CLIENTE</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">DESCRIPCION</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">MONTO</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">POR INTERES</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">CATEGORIA</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">%</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">COMISION</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">FECHA</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">MONEDA</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">TIPO</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">INTERES</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700">ATRASO</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700">Id Credito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr className="bg-slate-50">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-700" colSpan={15}>
                    MONEDA: Guarani
                  </td>
                </tr>
                {movementRows.map((movement) => (
                  <tr key={movement.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 text-xs font-semibold text-gray-700">{movement.rendered}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold text-gray-800">
                      {movement.principalAmount.toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-900">{movement.clientName}</td>
                    <td className="px-3 py-3 text-sm text-gray-700">{movement.description}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                      {movement.amount.toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-gray-800">
                      {movement.interestPortion.toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-xs font-semibold text-gray-700">{movement.clientCategory}</td>
                    <td className="px-3 py-3 text-right text-sm font-semibold text-gray-800">
                      {movement.commissionRate}%
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-semibold text-amber-700">
                      {Math.round(movement.commissionAmount).toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600">
                      {new Date(movement.date).toLocaleDateString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700">{movement.currencyLabel}</td>
                    <td className="px-3 py-3 text-xs font-semibold text-emerald-600">{movement.movementType}</td>
                    <td className="px-3 py-3 text-right text-sm text-gray-800">
                      {movement.interestAmount.toLocaleString('es-PY')}
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-gray-800">{movement.atrasoDays}</td>
                    <td className="px-3 py-3 text-sm text-gray-700">
                      {movement.creditIdLabel}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-100 font-semibold">
                  <td className="px-3 py-3 text-slate-800">Suma</td>
                  <td className="px-3 py-3 text-right text-slate-800">{totalGiven.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3 text-right text-slate-800">{sumAmount.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3 text-right text-slate-800">{sumInterestPortion.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3 text-right text-amber-800">
                    {Math.round(totalCommission).toLocaleString('es-PY')}
                  </td>
                  <td className="px-3 py-3" colSpan={6}></td>
                </tr>
                <tr className="bg-slate-200 font-bold">
                  <td className="px-3 py-3 text-slate-900">Total Acumulado({movementRows.length}) - Suma</td>
                  <td className="px-3 py-3 text-right text-slate-900">{totalGiven.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3 text-right text-slate-900">{sumAmount.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3 text-right text-slate-900">{sumInterestPortion.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3 text-right text-amber-900">
                    {Math.round(totalCommission).toLocaleString('es-PY')}
                  </td>
                  <td className="px-3 py-3" colSpan={6}></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  accent,
}: {
  title: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <div className={`rounded-lg border-l-4 bg-white p-4 shadow ${accent}`}>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}
