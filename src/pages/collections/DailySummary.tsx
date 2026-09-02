import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, documentId, getDocsFromServer, query, type QueryConstraint, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Client, CollectionManagement, Loan, Payment, User } from '../../types';
import {
  getCollectionManagementId,
  getLoanDueDateForManagement,
  loadCollectionManagements,
  markCollectionAsContacted,
  markCollectionAsManaged,
} from '../../services/collectionManagementService';
import { formatDateInputValue, formatDisplayDate, parseDateInputValue } from '../../utils/dateUtils';
import { getLoanFinancialSnapshot } from '../../services/loanService';

type SummaryRow = {
  loan: Loan;
  client: Client | null;
  dueDate: number;
  hasPaymentInRange: boolean;
  management: CollectionManagement | null;
};

const getDayRangeFromInput = (value: string) => {
  const midday = parseDateInputValue(value);
  const date = new Date(midday);
  return {
    start: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
    end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  };
};

const getDayOfMonthFromInput = (value: string) => new Date(parseDateInputValue(value)).getUTCDate();

const matchesSelectedDayRange = (dayOfMonth: number, fromDay: number, toDay: number) => {
  if (fromDay <= toDay) {
    return dayOfMonth >= fromDay && dayOfMonth <= toDay;
  }

  return dayOfMonth >= fromDay || dayOfMonth <= toDay;
};

export default function DailySummary() {
  const { userData } = useAuth();
  const todayInput = useMemo(() => formatDateInputValue(Date.now()), []);
  const [dateFrom, setDateFrom] = useState(todayInput);
  const [dateTo, setDateTo] = useState(todayInput);
  const [selectedUserId, setSelectedUserId] = useState<'ALL' | string>('ALL');
  const [users, setUsers] = useState<Array<User & { id: string }>>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clientsById, setClientsById] = useState<Map<string, Client>>(new Map());
  const [payments, setPayments] = useState<Payment[]>([]);
  const [managements, setManagements] = useState<Map<string, CollectionManagement>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!userData) return;

    try {
      setLoading(true);

      const rangeStart = getDayRangeFromInput(dateFrom).start;
      const rangeEnd = getDayRangeFromInput(dateTo).end;
      const loansConstraints: QueryConstraint[] = [
        where('approvalStatus', '==', 'APPROVED'),
        where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO']),
      ];
      const paymentsConstraints: QueryConstraint[] = [
        where('paidAt', '>=', rangeStart),
        where('paidAt', '<=', rangeEnd),
      ];
      const managementCollectorId =
        selectedUserId !== 'ALL'
          ? selectedUserId
          : userData.role === 'COLLECTOR'
            ? userData.uid
            : undefined;

      if (managementCollectorId) {
        loansConstraints.push(where('collectorId', '==', managementCollectorId));
        paymentsConstraints.push(where('collectorId', '==', managementCollectorId));
      }

      const [usersSnapshot, loansSnapshot, paymentsSnapshot, managementMap] = await Promise.all([
        getDocsFromServer(
          query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))
        ),
        getDocsFromServer(query(collection(db, `companies/${COMPANY_ID}/loans`), ...loansConstraints)),
        getDocsFromServer(query(collection(db, `companies/${COMPANY_ID}/payments`), ...paymentsConstraints)),
        loadCollectionManagements(managementCollectorId),
      ]);

      const activeUsers = usersSnapshot.docs
        .map((docItem) => ({ id: docItem.id, ...(docItem.data() as User) }))
        .filter((item) => item.role === 'ADMIN' || item.role === 'COLLECTOR')
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));

      const approvedLoans = loansSnapshot.docs
        .map((docItem) => ({ id: docItem.id, ...(docItem.data() as Loan) }))
        .filter(
          (loan) =>
            (loan.approvalStatus || 'APPROVED') === 'APPROVED' &&
            loan.status !== 'PAID'
        );

      const nextClients = new Map<string, Client>();
      const clientIds = [...new Set(approvedLoans.map((loan) => loan.clientId))];
      for (let index = 0; index < clientIds.length; index += 10) {
        const batch = clientIds.slice(index, index + 10);
        const clientsSnapshot = await getDocsFromServer(
          query(collection(db, `companies/${COMPANY_ID}/clients`), where(documentId(), 'in', batch))
        );
        clientsSnapshot.docs.forEach((docItem) => {
          nextClients.set(docItem.id, { id: docItem.id, ...(docItem.data() as Client) });
        });
      }

      setUsers(activeUsers);
      setLoans(approvedLoans);
      setClientsById(nextClients);
      setPayments(
        paymentsSnapshot.docs.map((docItem) => ({ id: docItem.id, ...(docItem.data() as Payment) }))
      );
      setManagements(managementMap);

    } catch (error) {
      console.error('Error cargando resumen del dia:', error);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedUserId, userData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const userOptions = useMemo(
    () => [{ id: 'ALL', name: 'Todos' }, ...users.map((item) => ({ id: item.uid, name: item.name }))],
    [users]
  );

  const selectedRange = useMemo(() => {
    const from = getDayRangeFromInput(dateFrom);
    const to = getDayRangeFromInput(dateTo);
    return { start: from.start, end: to.end };
  }, [dateFrom, dateTo]);

  const rows = useMemo<SummaryRow[]>(() => {
    const fromDay = getDayOfMonthFromInput(dateFrom);
    const toDay = getDayOfMonthFromInput(dateTo);
    const paymentDatesByLoan = new Map<string, number>();

    payments
      .filter((payment) => {
        const paidAt = payment.paidAt || payment.createdAt || 0;
        const matchesDate = paidAt >= selectedRange.start && paidAt <= selectedRange.end;
        const matchesUser = selectedUserId === 'ALL' || payment.collectorId === selectedUserId;
        return matchesDate && matchesUser;
      })
      .forEach((payment) => {
        const paidAt = payment.paidAt || payment.createdAt || 0;
        const current = paymentDatesByLoan.get(payment.loanId);
        if (!current || paidAt < current) {
          paymentDatesByLoan.set(payment.loanId, paidAt);
        }
      });

    return loans
      .filter((loan) => {
        const matchesUser = selectedUserId === 'ALL' || loan.collectorId === selectedUserId;
        const dueDay = new Date(getLoanDueDateForManagement(loan)).getUTCDate();
        const hasMora = getLoanFinancialSnapshot(loan).mora > 0;
        return matchesUser && (hasMora || matchesSelectedDayRange(dueDay, fromDay, toDay));
      })
      .map((loan) => {
        const dueDate = getLoanDueDateForManagement(loan);
        const paymentDate = paymentDatesByLoan.get(loan.id!);
        const managementId = getCollectionManagementId(loan.id!, dueDate);
        return {
          loan,
          client: clientsById.get(loan.clientId) || null,
          dueDate,
          hasPaymentInRange: Boolean(paymentDate),
          management: managements.get(managementId) || null,
        };
      })
      .sort((left, right) => {
        const leftDay = new Date(left.dueDate).getUTCDate();
        const rightDay = new Date(right.dueDate).getUTCDate();
        if (leftDay !== rightDay) return leftDay - rightDay;
        return left.dueDate - right.dueDate;
      });
  }, [
    clientsById,
    dateFrom,
    dateTo,
    loans,
    managements,
    payments,
    selectedRange.end,
    selectedRange.start,
    selectedUserId,
  ]);

  const pendingRows = useMemo(
    () => rows.filter((row) => !row.hasPaymentInRange && row.management?.status !== 'MANAGED'),
    [rows]
  );

  const summary = useMemo(
    () => ({
      total: rows.length,
      charged: rows.filter((row) => row.hasPaymentInRange).length,
      managed: rows.filter((row) => row.management?.status === 'MANAGED').length,
      contacted: rows.filter((row) => Boolean(row.management?.contactedAt)).length,
      pending: pendingRows.length,
    }),
    [pendingRows.length, rows]
  );

  const updateLocalManagement = (loan: Loan, partial: Partial<CollectionManagement>) => {
    const dueDate = getLoanDueDateForManagement(loan);
    const id = getCollectionManagementId(loan.id!, dueDate);
    const now = Date.now();

    setManagements((previous) => {
      const next = new Map(previous);
      const current = previous.get(id);
      next.set(id, {
        id,
        companyId: COMPANY_ID,
        loanId: loan.id!,
        clientId: loan.clientId,
        collectorId: loan.collectorId,
        collectorName: loan.collectorName,
        dueDate,
        status: current?.status || 'PENDING',
        managedBy: current?.managedBy || userData!.uid,
        managedByName: current?.managedByName || userData!.name,
        createdAt: current?.createdAt || now,
        createdBy: current?.createdBy || userData!.uid,
        ...current,
        ...partial,
        updatedAt: now,
      });
      return next;
    });
  };

  const handleMarkManaged = async (loan: Loan) => {
    if (!userData) return;
    const key = `managed-${loan.id}`;

    try {
      setSavingKey(key);
      await markCollectionAsManaged(loan, userData);
      updateLocalManagement(loan, {
        status: 'MANAGED',
        managedAt: Date.now(),
        managedBy: userData.uid,
        managedByName: userData.name,
      });
    } catch (error) {
      console.error('Error marcando gestionado:', error);
      alert('No se pudo marcar como gestionado.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleMarkContacted = async (loan: Loan) => {
    if (!userData) return;
    const key = `contact-${loan.id}`;

    try {
      setSavingKey(key);
      await markCollectionAsContacted(loan, userData);
      updateLocalManagement(loan, {
        contactedAt: Date.now(),
        contactedBy: userData.uid,
        contactedByName: userData.name,
      });
    } catch (error) {
      console.error('Error marcando escribio:', error);
      alert('No se pudo marcar que se escribio al cliente.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6 rounded-lg bg-white p-6 shadow">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Resumen del dia</h2>
          <p className="text-sm text-gray-600">Control de vencimientos, gestion y cobros por rango.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Cobrador / Admin</label>
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2"
            >
              {userOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <SummaryCard title="Por cobrar" value={summary.total} color="border-slate-500" />
        <SummaryCard title="Cobrados" value={summary.charged} color="border-green-600" />
        <SummaryCard title="Gestionados" value={summary.managed} color="border-blue-600" />
        <SummaryCard title="Escritos" value={summary.contacted} color="border-cyan-600" />
        <SummaryCard title="Pendientes" value={summary.pending} color="border-orange-500" />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
          Todos los creditos no cancelados, ordenados por vencimiento
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-gray-500">Cargando resumen...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No hay creditos para mostrar.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Telefono</th>
                  <th className="px-4 py-3 text-left">Trabajo</th>
                  <th className="px-4 py-3 text-left">Vencimiento</th>
                  <th className="px-4 py-3 text-center">Cobro</th>
                  <th className="px-4 py-3 text-center">Gestionado</th>
                  <th className="px-4 py-3 text-center">Escribio</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const contacted = Boolean(row.management?.contactedAt);
                  const managed = row.management?.status === 'MANAGED';

                  return (
                    <tr key={row.loan.id} className="border-t border-gray-200">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{row.client?.fullName || 'Cliente'}</div>
                        <div className="text-xs text-gray-500">{row.loan.collectorName}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{row.client?.phone || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{row.client?.workplaceName || '-'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {formatDisplayDate(row.dueDate)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.hasPaymentInRange ? (
                          <span className="rounded bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                            SI
                          </span>
                        ) : (
                          <span className="rounded bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">
                            NO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {managed ? (
                          <span className="rounded bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                            SI
                          </span>
                        ) : (
                          <span className="rounded bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">
                            NO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {contacted ? (
                          <span className="rounded bg-cyan-100 px-3 py-1 text-xs font-bold text-cyan-800">
                            SI
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                            NO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-center gap-2">
                          {!managed && (
                            <button
                              type="button"
                              onClick={() => void handleMarkManaged(row.loan)}
                              disabled={savingKey === `managed-${row.loan.id}`}
                              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                              {savingKey === `managed-${row.loan.id}` ? 'Guardando...' : 'Gestionado'}
                            </button>
                          )}
                          {!contacted && (
                            <button
                              type="button"
                              onClick={() => void handleMarkContacted(row.loan)}
                              disabled={savingKey === `contact-${row.loan.id}`}
                              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
                            >
                              {savingKey === `contact-${row.loan.id}` ? 'Guardando...' : 'Escribio'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`rounded-lg border-l-4 bg-white p-4 shadow ${color}`}>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
