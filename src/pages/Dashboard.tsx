import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import type { CurrencyCode, Loan, Payment, User } from '../types';
import {
  adminRebuildLoans,
  adminSyncFinancialMovements,
  syncJuridicoInboundCredits,
  syncPosInboundUsers,
} from '../services/userService';
import { getCreditInfo, type CreditStatus } from '../utils/loanUtils';
import { formatCurrencyAmount } from '../utils/currencyUtils';

interface AdminStats {
  totalLoanAmount: number;
  totalCollectors: number;
  totalRecovered: number;
  categoryCounts: Record<CreditStatus, number>;
  pendingLoansCount: number;
  pendingPaymentsCount: number;
  approvedLoans: Loan[];
  approvedPayments: Payment[];
}

interface CollectorStats {
  totalLoanAmount: number;
  totalRecovered: number;
  activeLoans: number;
  totalClients: number;
  monthlyCollected: number;
  pendingPayments: number;
}

type ChartPoint = {
  label: string;
  value: number;
};

const severityOrder: Record<CreditStatus, number> = {
  BUENO: 0,
  INFORCONF: 1,
  PREJUDICIAL: 2,
  JUDICIAL: 3,
};

const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const formatMonthInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const getRangeForMonth = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  const daysInMonth = new Date(year, month, 0).getDate();
  return { year, month, start, end, daysInMonth };
};

export default function Dashboard() {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [collectorStats, setCollectorStats] = useState<CollectorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => formatMonthInput(new Date()));
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>('PYG');

  useEffect(() => {
    if (!userData) {
      setLoading(false);
      return;
    }

    if (userData.role === 'ADMIN') {
      void loadDashboardStats();
      return;
    }

    void loadCollectorDashboard();
  }, [userData]);

  const loadDashboardStats = async () => {
    try {
      setLoading(true);
      setError(null);
      setCollectorStats(null);

      const [usersSnapshot, loansSnapshot, paymentsSnapshot] = await Promise.all([
        getDocs(query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))),
        getDocs(query(collection(db, `companies/${COMPANY_ID}/loans`), where('approvalStatus', '==', 'APPROVED'))),
        getDocs(query(collection(db, `companies/${COMPANY_ID}/payments`), where('approvalStatus', '==', 'APPROVED'))),
      ]);
      const [pendingLoansSnapshot, pendingPaymentsSnapshot] = await Promise.all([
        getDocs(query(collection(db, `companies/${COMPANY_ID}/loans`), where('approvalStatus', '==', 'PENDING'))),
        getDocs(query(collection(db, `companies/${COMPANY_ID}/payments`), where('approvalStatus', '==', 'PENDING'))),
      ]);

      const collectors = usersSnapshot.docs
        .map((item) => ({ id: item.id, ...(item.data() as User) }))
        .filter((user) => (user.role === 'COLLECTOR' || user.role === 'ADMIN') && user.isActive);

      const loans = loansSnapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Loan) }));
      const payments = paymentsSnapshot.docs.map(
        (item) => ({ id: item.id, ...(item.data() as Payment) })
      );

      const approvedLoans = loans.filter((loan) => (loan.approvalStatus || 'APPROVED') === 'APPROVED');
      const approvedPayments = payments.filter(
        (payment) => (payment.approvalStatus || 'APPROVED') === 'APPROVED'
      );
      const pendingLoans = pendingLoansSnapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Loan) }));
      const pendingPayments = pendingPaymentsSnapshot.docs.map(
        (item) => ({ id: item.id, ...(item.data() as Payment) })
      );

      const totalLoanAmount = approvedLoans.reduce((sum, loan) => sum + loan.principal, 0);
      const totalRecovered = approvedPayments.reduce((sum, payment) => sum + payment.amount, 0);

      const clientWorstCategory = new Map<string, CreditStatus>();
      approvedLoans
        .filter((loan) => loan.status === 'ACTIVE')
        .forEach((loan) => {
          const currentStatus = getCreditInfo(loan.expiresAt, loan.inforconfConfirmedAt).status;
          const previousStatus = clientWorstCategory.get(loan.clientId);

          if (!previousStatus || severityOrder[currentStatus] > severityOrder[previousStatus]) {
            clientWorstCategory.set(loan.clientId, currentStatus);
          }
        });

      const categoryCounts: Record<CreditStatus, number> = {
        BUENO: 0,
        INFORCONF: 0,
        PREJUDICIAL: 0,
        JUDICIAL: 0,
      };
      clientWorstCategory.forEach((status) => {
        categoryCounts[status] += 1;
      });

      setStats({
        totalLoanAmount,
        totalCollectors: collectors.length,
        totalRecovered,
        categoryCounts,
        pendingLoansCount: pendingLoans.length,
        pendingPaymentsCount: pendingPayments.length,
        approvedLoans,
        approvedPayments,
      });
    } catch (err) {
      console.error('Error loading dashboard stats:', err);
      setError('Error al cargar las estadisticas. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const loadCollectorDashboard = async () => {
    if (!userData) return;

    try {
      setLoading(true);
      setError(null);
      setStats(null);

      const [loansSnapshot, paymentsSnapshot] = await Promise.all([
        getDocs(
          query(collection(db, `companies/${COMPANY_ID}/loans`), where('collectorId', '==', userData.uid))
        ),
        getDocs(
          query(collection(db, `companies/${COMPANY_ID}/payments`), where('collectorId', '==', userData.uid))
        ),
      ]);

      const loans = loansSnapshot.docs
        .map((item) => ({ id: item.id, ...(item.data() as Loan) }))
        .filter(
          (loan) =>
            loan.collectorId === userData.uid && (loan.approvalStatus || 'APPROVED') === 'APPROVED'
        );
      const allPayments = paymentsSnapshot.docs.map(
        (item) => ({ id: item.id, ...(item.data() as Payment) })
      );
      const approvedPayments = allPayments.filter(
        (payment) =>
          payment.collectorId === userData.uid &&
          (payment.approvalStatus || 'APPROVED') === 'APPROVED'
      );
      const pendingPayments = allPayments.filter(
        (payment) => payment.collectorId === userData.uid && payment.approvalStatus === 'PENDING'
      );

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      const monthlyCollected = approvedPayments
        .filter((payment) => {
          const paidAt = payment.paidAt || payment.createdAt || 0;
          return paidAt >= monthStart && paidAt < nextMonthStart;
        })
        .reduce((sum, payment) => sum + payment.amount, 0);

      setCollectorStats({
        totalLoanAmount: loans.reduce((sum, loan) => sum + loan.principal, 0),
        totalRecovered: approvedPayments.reduce((sum, payment) => sum + payment.amount, 0),
        activeLoans: loans.filter((loan) => loan.status === 'ACTIVE').length,
        totalClients: new Set(loans.map((loan) => loan.clientId)).size,
        monthlyCollected,
        pendingPayments: pendingPayments.length,
      });
    } catch (err) {
      console.error('Error loading collector dashboard:', err);
      setError('Error al cargar las estadisticas del cobrador. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleRebuildLoans = async () => {
    setProcessing('rebuild-loans');
    try {
      const preview = await adminRebuildLoans(false);
      const sampleText =
        preview.samples.length > 0
          ? `\nEjemplos: ${preview.samples
              .map((item) => `${item.id.slice(0, 8)} [${item.changedKeys.join(', ')}]`)
              .join(' | ')}`
          : '';

      const shouldApply = window.confirm(
        `Vista previa de regrabado:\n` +
          `Creditos analizados: ${preview.totalLoans}\n` +
          `Creditos a actualizar: ${preview.changedLoans}${sampleText}\n\n` +
          `Deseas aplicar ahora el regrabado masivo?`
      );

      if (!shouldApply) return;

      const result = await adminRebuildLoans(true);
      alert(
        `Regrabado completado.\nCreditos revisados: ${result.totalLoans}\nCreditos actualizados: ${result.changedLoans}`
      );
      await loadDashboardStats();
    } catch (error) {
      console.error(error);
      setError('No se pudo ejecutar el regrabado masivo de creditos.');
    } finally {
      setProcessing(null);
    }
  };

  const handleSyncFinancial = async () => {
    setProcessing('sync-financial');
    try {
      const preview = await adminSyncFinancialMovements(false);
      const shouldApply = window.confirm(
        `Vista previa de sincronizacion financiera:\n` +
          `Sucursal: ${preview.branchName}\n` +
          `Ingresos historicos a cargar: ${preview.incomesCount}\n` +
          `Egresos historicos a cargar: ${preview.expensesCount}\n\n` +
          `Nota: los egresos nuevos se seguiran enviando solo cuando se aprueben creditos nuevos.\n\n` +
          `Deseas sincronizar ahora el historico con el otro Firebase?`
      );

      if (!shouldApply) return;

      const result = await adminSyncFinancialMovements(true);
      alert(
        `Sincronizacion completada.\n` +
          `Sucursal: ${result.branchName}\n` +
          `Ingresos historicos sincronizados: ${result.incomesCount}\n` +
          `Egresos historicos sincronizados: ${result.expensesCount}`
      );
    } catch (error) {
      console.error(error);
      setError('No se pudo sincronizar con el sistema financiero.');
    } finally {
      setProcessing(null);
    }
  };

  const handleSyncExternalSystem = async (system: 'POS' | 'JURIDICO') => {
    const processingKey = system === 'POS' ? 'sync-pos' : 'sync-juridico';
    setProcessing(processingKey);
    try {
      const result = system === 'POS'
        ? await syncPosInboundUsers()
        : await syncJuridicoInboundCredits();
      alert(
        `${system} sincronizado. Clientes: ${result.clientsCount}. ` +
        `Operaciones: ${result.replicatedCount}. Pagos: ${result.paymentsCount}.`
      );
    } catch (syncError) {
      console.error(syncError);
      setError(`No se pudo sincronizar ${system}.`);
    } finally {
      setProcessing(null);
    }
  };

  const monthRange = useMemo(() => getRangeForMonth(selectedMonth), [selectedMonth]);
  const availableYears = useMemo(() => {
    if (!stats) return [selectedYear];

    const years = new Set<string>();
    stats.approvedLoans.forEach((loan) => {
      years.add(String(new Date(loan.grantedAt || loan.createdAt).getFullYear()));
    });
    stats.approvedPayments.forEach((payment) => {
      years.add(String(new Date(payment.paidAt || payment.createdAt).getFullYear()));
    });
    years.add(selectedYear);
    return Array.from(years).sort((left, right) => Number(right) - Number(left));
  }, [selectedYear, stats]);

  const adminMetrics = useMemo(() => {
    if (!stats) return null;

    const monthlyLoans = stats.approvedLoans.filter((loan) => {
      const grantedAt = loan.grantedAt || loan.createdAt || 0;
      return (
        (loan.currency || 'PYG') === selectedCurrency &&
        grantedAt >= monthRange.start &&
        grantedAt < monthRange.end
      );
    });

    const monthlyPayments = stats.approvedPayments.filter((payment) => {
      const paidAt = payment.paidAt || payment.createdAt || 0;
      return (
        (payment.currency || 'PYG') === selectedCurrency &&
        paidAt >= monthRange.start &&
        paidAt < monthRange.end
      );
    });

    const yearStart = new Date(Number(selectedYear), 0, 1).getTime();
    const nextYearStart = new Date(Number(selectedYear) + 1, 0, 1).getTime();

    const yearlyLoans = stats.approvedLoans.filter((loan) => {
      const grantedAt = loan.grantedAt || loan.createdAt || 0;
      return (
        (loan.currency || 'PYG') === selectedCurrency &&
        grantedAt >= yearStart &&
        grantedAt < nextYearStart
      );
    });

    const yearlyPayments = stats.approvedPayments.filter((payment) => {
      const paidAt = payment.paidAt || payment.createdAt || 0;
      return (
        (payment.currency || 'PYG') === selectedCurrency &&
        paidAt >= yearStart &&
        paidAt < nextYearStart
      );
    });

    const loansByDay: ChartPoint[] = Array.from({ length: monthRange.daysInMonth }, (_, index) => {
      const day = index + 1;
      const value = monthlyLoans
        .filter((loan) => new Date(loan.grantedAt || loan.createdAt).getDate() === day)
        .reduce((sum, loan) => sum + loan.principal, 0);
      return { label: String(day).padStart(2, '0'), value };
    });

    const paymentsByDay: ChartPoint[] = Array.from({ length: monthRange.daysInMonth }, (_, index) => {
      const day = index + 1;
      const value = monthlyPayments
        .filter((payment) => new Date(payment.paidAt || payment.createdAt).getDate() === day)
        .reduce((sum, payment) => sum + payment.amount, 0);
      return { label: String(day).padStart(2, '0'), value };
    });

    const loansByMonth: ChartPoint[] = monthNames.map((label, index) => {
      const value = yearlyLoans
        .filter((loan) => new Date(loan.grantedAt || loan.createdAt).getMonth() === index)
        .reduce((sum, loan) => sum + loan.principal, 0);
      return { label, value };
    });

    const paymentsByMonth: ChartPoint[] = monthNames.map((label, index) => {
      const value = yearlyPayments
        .filter((payment) => new Date(payment.paidAt || payment.createdAt).getMonth() === index)
        .reduce((sum, payment) => sum + payment.amount, 0);
      return { label, value };
    });

    return {
      monthlyLoansAmount: monthlyLoans.reduce((sum, loan) => sum + loan.principal, 0),
      monthlyLoansCount: monthlyLoans.length,
      monthlyPaymentsAmount: monthlyPayments.reduce((sum, payment) => sum + payment.amount, 0),
      monthlyPaymentsCount: monthlyPayments.length,
      yearlyLoansAmount: yearlyLoans.reduce((sum, loan) => sum + loan.principal, 0),
      yearlyLoansCount: yearlyLoans.length,
      yearlyPaymentsAmount: yearlyPayments.reduce((sum, payment) => sum + payment.amount, 0),
      yearlyPaymentsCount: yearlyPayments.length,
      loansByDay,
      paymentsByDay,
      loansByMonth,
      paymentsByMonth,
    };
  }, [monthRange, selectedCurrency, selectedYear, stats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{error}</div>
      </div>
    );
  }

  if (userData?.role !== 'ADMIN' && collectorStats) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Mi Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              Resumen operativo de tu cartera y tu recaudo.
            </p>
          </div>
          <button
            onClick={() => void loadCollectorDashboard()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard
            title="Clientes"
            value={String(collectorStats.totalClients)}
            helper="Clientes con credito aprobado"
            borderClass="border-slate-600"
          />
          <KpiCard
            title="Creditos Activos"
            value={String(collectorStats.activeLoans)}
            helper="Pendientes de gestion"
            borderClass="border-blue-600"
          />
          <KpiCard
            title="Total Dado"
            value={`Gs. ${(collectorStats.totalLoanAmount / 1000000).toFixed(1)}M`}
            helper={`${collectorStats.totalLoanAmount.toLocaleString('es-PY')} Guaranies`}
            borderClass="border-indigo-600"
          />
          <KpiCard
            title="Recaudo del Mes"
            value={`Gs. ${(collectorStats.monthlyCollected / 1000000).toFixed(1)}M`}
            helper="Pagos aprobados del mes actual"
            borderClass="border-emerald-600"
            valueClass="text-emerald-600"
          />
          <KpiCard
            title="Total Recuperado"
            value={`Gs. ${(collectorStats.totalRecovered / 1000000).toFixed(1)}M`}
            helper={`${collectorStats.totalRecovered.toLocaleString('es-PY')} Guaranies`}
            borderClass="border-green-600"
            valueClass="text-green-600"
          />
          <KpiCard
            title="Recibos Pendientes"
            value={String(collectorStats.pendingPayments)}
            helper="Pendientes de confirmacion"
            borderClass="border-amber-600"
            valueClass="text-amber-600"
          />
        </div>
      </div>
    );
  }

  if (!stats || !adminMetrics) {
    return (
      <div className="p-6">
        <div className="text-gray-600">No hay datos disponibles</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Central de control de cartera, cobros y evolucion del negocio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void handleSyncFinancial()}
            disabled={processing === 'sync-financial'}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {processing === 'sync-financial' ? 'Sincronizando...' : 'Sincronizar financiero'}
          </button>
          <button
            onClick={() => void handleSyncExternalSystem('POS')}
            disabled={processing === 'sync-pos'}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
          >
            {processing === 'sync-pos' ? 'Sincronizando POS...' : 'Sincronizar POS'}
          </button>
          <button
            onClick={() => void handleSyncExternalSystem('JURIDICO')}
            disabled={processing === 'sync-juridico'}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
          >
            {processing === 'sync-juridico' ? 'Sincronizando juridico...' : 'Sincronizar juridico'}
          </button>
          <button
            onClick={() => void handleRebuildLoans()}
            disabled={processing === 'rebuild-loans'}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50"
          >
            {processing === 'rebuild-loans' ? 'Regrabando...' : 'Regrabar creditos'}
          </button>
          <button
            onClick={() => void loadDashboardStats()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg bg-white p-4 shadow md:grid-cols-3 xl:grid-cols-5">
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Mes</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(event) => {
              setSelectedMonth(event.target.value);
              setSelectedYear(event.target.value.slice(0, 4));
            }}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Año</label>
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Moneda</label>
          <select
            value={selectedCurrency}
            onChange={(event) => setSelectedCurrency(event.target.value as CurrencyCode)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2"
          >
            <option value="PYG">Gs</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <KpiMini label="Pend. creditos" value={String(stats.pendingLoansCount)} />
        <KpiMini label="Pend. rendiciones" value={String(stats.pendingPaymentsCount)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Cobros del mes"
          value={formatCurrencyAmount(adminMetrics.monthlyPaymentsAmount, selectedCurrency)}
          helper={`${adminMetrics.monthlyPaymentsCount} movimiento(s)`}
          borderClass="border-emerald-600"
          valueClass="text-emerald-600"
        />
        <KpiCard
          title="Creditos del mes"
          value={formatCurrencyAmount(adminMetrics.monthlyLoansAmount, selectedCurrency)}
          helper={`${adminMetrics.monthlyLoansCount} credito(s)`}
          borderClass="border-blue-600"
        />
        <KpiCard
          title="Cobros del año"
          value={formatCurrencyAmount(adminMetrics.yearlyPaymentsAmount, selectedCurrency)}
          helper={`${adminMetrics.yearlyPaymentsCount} movimiento(s)`}
          borderClass="border-green-700"
          valueClass="text-green-700"
        />
        <KpiCard
          title="Creditos del año"
          value={formatCurrencyAmount(adminMetrics.yearlyLoansAmount, selectedCurrency)}
          helper={`${adminMetrics.yearlyLoansCount} credito(s)`}
          borderClass="border-indigo-700"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="Total historico dado"
          value={`Gs. ${(stats.totalLoanAmount / 1000000).toFixed(1)}M`}
          helper={`${stats.totalLoanAmount.toLocaleString('es-PY')} Guaranies`}
          borderClass="border-slate-600"
        />
        <KpiCard
          title="Total historico cobrado"
          value={`Gs. ${(stats.totalRecovered / 1000000).toFixed(1)}M`}
          helper={`${stats.totalRecovered.toLocaleString('es-PY')} Guaranies`}
          borderClass="border-emerald-800"
          valueClass="text-emerald-700"
        />
        <KpiCard
          title="Recaudadores activos"
          value={String(stats.totalCollectors)}
          helper="Cobradores y admins activos"
          borderClass="border-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title={`Cobros por dia - ${selectedMonth}`}>
          <BarChart points={adminMetrics.paymentsByDay} currency={selectedCurrency} colorClass="bg-emerald-500" />
        </Panel>
        <Panel title={`Creditos por dia - ${selectedMonth}`}>
          <BarChart points={adminMetrics.loansByDay} currency={selectedCurrency} colorClass="bg-blue-500" />
        </Panel>
        <Panel title={`Cobros por mes - ${selectedYear}`}>
          <BarChart points={adminMetrics.paymentsByMonth} currency={selectedCurrency} colorClass="bg-green-600" />
        </Panel>
        <Panel title={`Creditos por mes - ${selectedYear}`}>
          <BarChart points={adminMetrics.loansByMonth} currency={selectedCurrency} colorClass="bg-indigo-600" />
        </Panel>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Clasificacion de cartera</h2>
            <p className="text-sm text-gray-500">
              Personas activas segun la peor categoria de sus creditos aprobados.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-6">
          <CategoryCard label="BUENO" count={stats.categoryCounts.BUENO} className="bg-green-50 text-green-800 border-green-200" onClick={() => navigate('/creditos?categoria=BUENO')} />
          <CategoryCard label="INFORCONF" count={stats.categoryCounts.INFORCONF} className="bg-yellow-50 text-yellow-800 border-yellow-200" onClick={() => navigate('/creditos?categoria=INFORCONF')} />
          <CategoryCard label="PREJUDICIAL" count={stats.categoryCounts.PREJUDICIAL} className="bg-orange-50 text-orange-800 border-orange-200" onClick={() => navigate('/creditos?categoria=PREJUDICIAL')} />
          <CategoryCard label="JUDICIAL" count={stats.categoryCounts.JUDICIAL} className="bg-red-50 text-red-800 border-red-200" onClick={() => navigate('/creditos?categoria=JUDICIAL')} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function KpiCard({
  title,
  value,
  helper,
  borderClass,
  valueClass = 'text-gray-900',
}: {
  title: string;
  value: string;
  helper: string;
  borderClass: string;
  valueClass?: string;
}) {
  return (
    <div className={`bg-white rounded-lg shadow p-6 border-l-4 ${borderClass}`}>
      <p className="text-gray-600 text-sm font-medium">{title}</p>
      <p className={`text-3xl font-bold mt-2 ${valueClass}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-2">{helper}</p>
    </div>
  );
}

function CategoryCard({
  label,
  count,
  className,
  onClick,
}: {
  label: string;
  count: number;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition hover:scale-[1.01] hover:shadow-md ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em]">{label}</p>
      <p className="text-3xl font-bold mt-3">{count}</p>
      <p className="text-sm mt-1">persona(s)</p>
    </button>
  );
}

function BarChart({
  points,
  currency,
  colorClass,
}: {
  points: ChartPoint[];
  currency: CurrencyCode;
  colorClass: string;
}) {
  const maxValue = Math.max(...points.map((point) => point.value), 0);

  return (
    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
      {points.map((point) => {
        const width = maxValue > 0 ? Math.max((point.value / maxValue) * 100, point.value > 0 ? 4 : 0) : 0;
        return (
          <div key={point.label} className="grid grid-cols-[48px,1fr,130px] items-center gap-3">
            <div className="text-sm font-semibold text-slate-600">{point.label}</div>
            <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${width}%` }} />
            </div>
            <div className="text-right text-sm font-semibold text-slate-800">
              {formatCurrencyAmount(point.value, currency)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
