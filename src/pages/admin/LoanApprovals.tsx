import { useEffect, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { COMPANY_ID, db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Loan, User } from '../../types';
import { approveLoan } from '../../services/loanService';
import { syncFinancialLoan } from '../../services/userService';
import { formatCurrencyAmount } from '../../utils/currencyUtils';

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfDay = (value: string) => new Date(`${value}T00:00:00`).getTime();
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).getTime();

export default function LoanApprovals() {
  const { userData } = useAuth();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clientsById, setClientsById] = useState<Record<string, string>>({});
  const [collectors, setCollectors] = useState<User[]>([]);
  const [selectedLoanIds, setSelectedLoanIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingBulk, setProcessingBulk] = useState(false);
  const todayInput = formatDateInput(new Date());
  const [dateFrom, setDateFrom] = useState(todayInput);
  const [dateTo, setDateTo] = useState(todayInput);
  const [selectedCollectorId, setSelectedCollectorId] = useState<'ALL' | string>('ALL');

  async function loadLoans() {
    setLoading(true);
    const [loansSnapshot, usersSnapshot] = await Promise.all([
      getDocs(query(collection(db, `companies/${COMPANY_ID}/loans`), where('approvalStatus', '==', 'PENDING'))),
      getDocs(query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))),
    ]);

    const pendingLoans = loansSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }) as Loan)
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    const clientIds = [...new Set(pendingLoans.map((loan) => loan.clientId))];
    const nextClientsById: Record<string, string> = {};

    for (let index = 0; index < clientIds.length; index += 10) {
      const batch = clientIds.slice(index, index + 10);
      const clientsSnapshot = await getDocs(
        query(collection(db, `companies/${COMPANY_ID}/clients`), where(documentId(), 'in', batch))
      );
      clientsSnapshot.docs.forEach((item) => {
        const data = item.data() as { fullName?: string };
        nextClientsById[item.id] = data.fullName || item.id;
      });
    }

    setClientsById(nextClientsById);

    setCollectors(
      usersSnapshot.docs
        .map((item) => item.data() as User)
        .filter((user) => user.isActive && (user.role === 'COLLECTOR' || user.role === 'ADMIN'))
        .sort((left, right) => left.name.localeCompare(right.name, 'es'))
    );

    setLoans(
      pendingLoans
    );
    setSelectedLoanIds([]);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLoans();
  }, []);

  const filteredLoans = loans.filter((loan) => {
    const loanDate = loan.createdAt || loan.grantedAt || 0;
    const matchesDate = loanDate >= startOfDay(dateFrom) && loanDate <= endOfDay(dateTo);
    const matchesCollector =
      selectedCollectorId === 'ALL' || loan.collectorId === selectedCollectorId;
    return matchesDate && matchesCollector;
  });

  const handleToggleSelection = (loanId: string) => {
    setSelectedLoanIds((current) =>
      current.includes(loanId) ? current.filter((id) => id !== loanId) : [...current, loanId]
    );
  };

  const handleToggleSelectAll = () => {
    setSelectedLoanIds((current) =>
      current.length === filteredLoans.length ? [] : filteredLoans.map((loan) => loan.id!)
    );
  };

  const handleConfirmSelected = async () => {
    if (!userData || selectedLoanIds.length === 0) return;
    setProcessingBulk(true);
    for (const loanId of selectedLoanIds) {
      await approveLoan(loanId, userData.uid);
      await syncFinancialLoan(loanId);
    }
    await loadLoans();
    setProcessingBulk(false);
  };

  const selectedTotal = loans
    .filter((loan) => loan.id && selectedLoanIds.includes(loan.id))
    .reduce((accumulator, loan) => accumulator + (loan.principal || 0), 0);
  const pendingTotal = filteredLoans.reduce((accumulator, loan) => accumulator + (loan.principal || 0), 0);
  const totalToConfirm = selectedLoanIds.length > 0 ? selectedTotal : pendingTotal;
  const totalCurrency = filteredLoans[0]?.currency || 'PYG';

  if (loading) {
    return <div className="text-gray-500">Cargando creditos pendientes...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-white border border-gray-200 rounded-lg p-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
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
        <div className="flex items-end">
          <button
            onClick={() => void loadLoans()}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Actualizar
          </button>
        </div>
      </div>

      {filteredLoans.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
          No hay creditos pendientes para esos filtros.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => void handleConfirmSelected()}
              disabled={selectedLoanIds.length === 0 || processingBulk}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {processingBulk ? 'Procesando...' : `Confirmar seleccionados (${selectedLoanIds.length})`}
            </button>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={selectedLoanIds.length > 0 && selectedLoanIds.length === filteredLoans.length}
                onChange={handleToggleSelectAll}
                className="rounded border-gray-300"
              />
              Seleccionar todos
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="py-2 px-3 text-left">SEL</th>
                  <th className="py-2 px-3 text-left">CONFIRMADO</th>
                  <th className="py-2 px-3 text-right">PRESTADO</th>
                  <th className="py-2 px-3 text-left">CLIENTE</th>
                  <th className="py-2 px-3 text-left">DESCRIPCION</th>
                  <th className="py-2 px-3 text-right">MONTO</th>
                  <th className="py-2 px-3 text-right">INTERES</th>
                  <th className="py-2 px-3 text-left">FECHA</th>
                  <th className="py-2 px-3 text-left">MONEDA</th>
                  <th className="py-2 px-3 text-left">TIPO</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-slate-50">
                  <td className="px-3 py-2 text-xs font-semibold text-slate-700" colSpan={10}>
                    MONEDA: Guarani
                  </td>
                </tr>
                {filteredLoans.map((loan) => {
                  const description =
                    loan.description ||
                    loan.pawnDescription ||
                    (loan.status === 'FROZEN' ? 'CREDITO CONGELADO' : 'CREDITO');
                  const interestAmount =
                    loan.loanType === 'ALQUILER_INMUEBLE' || loan.loanType === 'PRESTACION_SERVICIOS'
                      ? 0
                      : Math.round((loan.principal || 0) * ((loan.interestRate || 0) / 100));
                  return (
                    <tr key={loan.id} className="border-b border-gray-100 last:border-b-0 text-gray-800">
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={!!loan.id && selectedLoanIds.includes(loan.id)}
                          onChange={() => loan.id && handleToggleSelection(loan.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="py-2 px-3">NO</td>
                      <td className="py-2 px-3 text-right">{(loan.principal || 0).toLocaleString('es-PY')}</td>
                      <td className="py-2 px-3">{clientsById[loan.clientId] || loan.clientId}</td>
                      <td className="py-2 px-3">{description}</td>
                      <td className="py-2 px-3 text-right">{(loan.principal || 0).toLocaleString('es-PY')}</td>
                      <td className="py-2 px-3 text-right">{interestAmount.toLocaleString('es-PY')}</td>
                      <td className="py-2 px-3">{new Date(loan.createdAt).toLocaleDateString('es-PY')}</td>
                      <td className="py-2 px-3">{loan.currency === 'PYG' ? 'Guarani' : 'USD'}</td>
                      <td className="py-2 px-3 font-semibold text-indigo-700">CREDITO</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-100 font-semibold">
                  <td className="px-3 py-3 text-slate-800">Suma</td>
                  <td className="px-3 py-3" colSpan={4}></td>
                  <td className="px-3 py-3 text-right text-slate-800">{pendingTotal.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3" colSpan={4}></td>
                </tr>
                <tr className="bg-slate-200 font-bold">
                  <td className="px-3 py-3 text-slate-900">Total Acumulado({filteredLoans.length}) - Suma</td>
                  <td className="px-3 py-3" colSpan={4}></td>
                  <td className="px-3 py-3 text-right text-slate-900">{pendingTotal.toLocaleString('es-PY')}</td>
                  <td className="px-3 py-3" colSpan={4}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="pt-2 border-t border-gray-200 flex justify-end">
            <p className="text-base font-semibold text-gray-900">
              Total a confirmar: {formatCurrencyAmount(totalToConfirm, totalCurrency)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
