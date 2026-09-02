import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { COMPANY_ID, db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Client, CurrencyCode, Loan, Payment, User } from '../../types';
import { formatCurrencyAmount, getCurrencySymbol } from '../../utils/currencyUtils';
import { getCreditInfo, type CreditStatus } from '../../utils/loanUtils';
import {
  confirmInforconf,
  deleteLoan,
  freezeLoan,
  getCollectionDayIndicator,
  getLoanFinancialSnapshot,
  redirectLoanToCollector,
  updateLoanAdmin,
  updateLoanAdminMeta,
} from '../../services/loanService';
import {
  getCollectionManagementId,
  getLoanDueDateForManagement,
  loadCollectionManagements,
} from '../../services/collectionManagementService';
import { deletePaymentAdmin, updatePaymentAdmin } from '../../services/paymentService';
import type { CollectionManagement } from '../../types';
import {
  addUtcMonthsPreservingDay,
  formatDateInputValue,
  formatDisplayDate,
  getCalendarMonthSpanFromDays,
  parseDateInputValue,
} from '../../utils/dateUtils';

interface LoanGroupRow {
  groupKey: string;
  clientId: string;
  currency: Loan['currency'];
  client?: Client;
  loans: Array<
    Loan & {
      snapshot: ReturnType<typeof getLoanFinancialSnapshot>;
      collectionDay: ReturnType<typeof getCollectionDayIndicator>;
      managementStatus: 'PENDING' | 'MANAGED';
      creditStatus: ReturnType<typeof getCreditInfo>;
      principalDue: number;
      interestDue: number;
      moraAmount: number;
      totalDue: number;
    }
  >;
  primaryLoan: LoanGroupRow['loans'][number];
  totalPrincipalDue: number;
  totalInterestDue: number;
  totalMoraAmount: number;
  totalDue: number;
  totalPaidAmount: number;
  totalCredits: number;
  managementStatus: 'PENDING' | 'MANAGED';
  creditStatusLabel: string;
}

const getLoanTypeLabel = (loanType: Loan['loanType']) => {
  if (loanType === 'EMPENO') return 'Empeno';
  if (loanType === 'PRESTACION_SERVICIOS') return 'Prestacion de Servicios';
  if (loanType === 'ALQUILER_INMUEBLE') return 'Alquiler / Inmuebles';
  return 'Credito';
};
const getLoanOriginLabel = (loan: Loan) => {
  if (loan.origen === 'empeno' || loan.loanType === 'EMPENO') return 'Empeno';
  if (loan.origen === 'alquiler' || loan.loanType === 'ALQUILER_INMUEBLE') return 'Alquiler';
  if (loan.origen === 'prestacion_servicios' || loan.loanType === 'PRESTACION_SERVICIOS') {
    return 'Prestacion de servicios';
  }
  if (loan.origen === 'pos' || String(loan.loanType) === 'POS') return 'POS';
  if (loan.origen === 'juridico' || String(loan.loanType) === 'JURIDICO') return 'Juridico';
  return 'Credito';
};

type ClientHealthFilter = 'ALL' | 'GOOD' | 'BAD';

const normalizeCompanyName = (value?: string) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const PAGE_SIZE = 10;

export default function LoansList() {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCategory = searchParams.get('categoria');

  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [collectors, setCollectors] = useState<User[]>([]);
  const [collectionManagements, setCollectionManagements] = useState<Map<string, CollectionManagement>>(new Map());
  const [selectedCollector, setSelectedCollector] = useState<string | 'ALL'>('ALL');
  const [selectedCompany, setSelectedCompany] = useState<string | 'ALL'>('ALL');
  const [selectedClientHealth, setSelectedClientHealth] = useState<ClientHealthFilter>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | CreditStatus>(
    initialCategory === 'BUENO' ||
      initialCategory === 'INFORCONF' ||
      initialCategory === 'PREJUDICIAL' ||
      initialCategory === 'JUDICIAL'
      ? initialCategory
      : 'ALL'
  );
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [redirectingLoan, setRedirectingLoan] = useState<Loan | null>(null);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editingCreditLoan, setEditingCreditLoan] = useState<Loan | null>(null);
  const [managingPaymentsLoan, setManagingPaymentsLoan] = useState<Loan | null>(null);
  const [loanPayments, setLoanPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [previewClient, setPreviewClient] = useState<Client | null>(null);
  const [openCollectionGroupId, setOpenCollectionGroupId] = useState<string | null>(null);
  const [openAdminLoanId, setOpenAdminLoanId] = useState<string | null>(null);
  const [viewingPaymentsGroup, setViewingPaymentsGroup] = useState<LoanGroupRow | null>(null);
  const [viewingPayments, setViewingPayments] = useState<Payment[]>([]);
  const [viewingPaymentsLoading, setViewingPaymentsLoading] = useState(false);
  const [metaForm, setMetaForm] = useState({ hasPagare: false, isLocatable: false });
  const [creditForm, setCreditForm] = useState({
      principal: 0,
      currency: 'PYG' as CurrencyCode,
      interestRate: 20,
      daysToExpire: 30,
      creditDate: formatDateInputValue(Date.now()),
      collectorId: '',
      hasPagare: false,
      isLocatable: false,
  });
  const [newCollectorId, setNewCollectorId] = useState('');
  const [paymentEditAmount, setPaymentEditAmount] = useState<number | ''>('');
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!userData) return;
    void fetchData();
  }, [userData]);

  useEffect(() => {
    const category = searchParams.get('categoria');
    if (
      category === 'BUENO' ||
      category === 'INFORCONF' ||
      category === 'PREJUDICIAL' ||
      category === 'JUDICIAL'
    ) {
      setSelectedCategory(category);
    } else {
      setSelectedCategory('ALL');
    }
  }, [searchParams]);

  const sectionLoanType = useMemo<Loan['loanType'] | 'ALL'>(() => {
    if (location.pathname === '/alquileres') return 'ALQUILER_INMUEBLE';
    if (location.pathname === '/prestacion-servicios') return 'PRESTACION_SERVICIOS';
    if (location.pathname === '/empenos') return 'EMPENO';
    return 'ALL';
  }, [location.pathname]);

  const sectionOrigenFilter = useMemo<string | 'ALL'>(() => {
    if (location.pathname === '/alquileres') return 'alquiler';
    if (location.pathname === '/prestacion-servicios') return 'prestacion_servicios';
    if (location.pathname === '/empenos') return 'empeno';
    if (location.pathname === '/juridico') return 'juridico';
    if (location.pathname === '/pos') return 'pos';
    if (location.pathname === '/creditos') return 'sistema_creditos';
    return 'ALL';
  }, [location.pathname]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const loansRef = collection(db, `companies/${COMPANY_ID}/loans`);
      const loansQuery = query(loansRef);

      const [loansSnap, managementMap] = await Promise.all([
        getDocs(loansQuery),
        loadCollectionManagements(),
      ]);
      const approvedLoans = loansSnap.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Loan)
        .filter((loan) => {
          const status = String(loan.status || '').toUpperCase();
          const approvalStatus = String(loan.approvalStatus || 'APPROVED').toUpperCase();
          return (
            ['ACTIVE', 'FROZEN', 'CONGELADO', 'ACTIVO'].includes(status) &&
            approvalStatus === 'APPROVED'
          );
        });
      setLoans(
        approvedLoans.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
      );
      setCollectionManagements(managementMap);

      const clientIds = [...new Set(approvedLoans.map((loan) => loan.clientId))];
      const clientsMap: Record<string, Client> = {};

      const clientBatchPromises: Array<Promise<void>> = [];
      for (let index = 0; index < clientIds.length; index += 10) {
        const batch = clientIds.slice(index, index + 10);
        clientBatchPromises.push(
          getDocs(query(collection(db, `companies/${COMPANY_ID}/clients`), where('__name__', 'in', batch))).then(
            (clientsSnap) => {
              clientsSnap.docs.forEach((clientDoc) => {
                clientsMap[clientDoc.id] = { id: clientDoc.id, ...clientDoc.data() } as Client;
              });
            }
          )
        );
      }
      await Promise.all(clientBatchPromises);

      setClients(clientsMap);

      if (userData?.role === 'ADMIN') {
        const usersSnap = await getDocs(
          query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))
        );
        setCollectors(
          usersSnap.docs
            .map((item) => item.data() as User)
            .filter((user) => user.role === 'COLLECTOR' || user.role === 'ADMIN')
        );
      }
    } catch (error) {
      console.error('Error cargando datos:', error);
      alert('Error al cargar la cartera de creditos.');
    } finally {
      setLoading(false);
    }
  };

  const filteredLoans = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return loans
      .filter((loan) => {
        const client = clients[loan.clientId];
        const snapshot = getLoanFinancialSnapshot(loan);
        const hasPendingApproval =
          loan.tienePagosPendientes ||
          (loan.totalPendienteAprobacion || 0) > 0 ||
          loan.estadoCobranza === 'pendiente_aprobacion' ||
          loan.estadoCobranza === 'pendiente_rendicion';
        const hasOutstandingDebt = snapshot.totalDue > 0 || hasPendingApproval;
        const matchesCollector = selectedCollector === 'ALL' || loan.collectorId === selectedCollector;
        const matchesCompany =
          selectedCompany === 'ALL' ||
          normalizeCompanyName(client?.workplaceName) === selectedCompany;
        const matchesLoanType =
          sectionLoanType === 'ALL' || loan.loanType === sectionLoanType;
        const matchesOrigen =
          sectionOrigenFilter === 'ALL' ||
          loan.origen === sectionOrigenFilter ||
          (sectionOrigenFilter === 'sistema_creditos' &&
            !loan.origen &&
            ['PRESTAMO', 'CELULAR', 'CONGELADO'].includes(String(loan.loanType))) ||
          (sectionOrigenFilter === 'empeno' && loan.loanType === 'EMPENO') ||
          (sectionOrigenFilter === 'alquiler' && loan.loanType === 'ALQUILER_INMUEBLE') ||
          (sectionOrigenFilter === 'prestacion_servicios' && loan.loanType === 'PRESTACION_SERVICIOS') ||
          (sectionOrigenFilter === 'pos' && String(loan.loanType) === 'POS') ||
          (sectionOrigenFilter === 'juridico' && String(loan.loanType) === 'JURIDICO');
        const hasMora = (snapshot.mora || 0) > 0;
        const matchesClientHealth =
          selectedClientHealth === 'ALL' ||
          (selectedClientHealth === 'GOOD' && !hasMora) ||
          (selectedClientHealth === 'BAD' && hasMora);
        const matchesCategory =
          selectedCategory === 'ALL' ||
          getCreditInfo(loan.expiresAt, loan.inforconfConfirmedAt).status === selectedCategory;
        const matchesSearch =
          !normalizedSearch ||
          loan.id?.toLowerCase().includes(normalizedSearch) ||
          loan.collectorName.toLowerCase().includes(normalizedSearch) ||
          client?.fullName.toLowerCase().includes(normalizedSearch) ||
          client?.documentId.toLowerCase().includes(normalizedSearch) ||
          client?.phone.toLowerCase().includes(normalizedSearch);

        return Boolean(
          hasOutstandingDebt &&
            matchesCollector &&
            matchesCategory &&
            matchesSearch &&
            matchesCompany &&
            matchesLoanType &&
            matchesOrigen &&
            matchesClientHealth
        );
      })
      .sort((loanA, loanB) => {
        const collectionA = getCollectionDayIndicator(loanA);
        const collectionB = getCollectionDayIndicator(loanB);
        const getPriority = (mode: ReturnType<typeof getCollectionDayIndicator>['mode']) => {
          if (mode === 'due_today') return 0;
          if (mode === 'upcoming') return 1;
          if (mode === 'late') return 2;
          return 3;
        };

        const priorityDifference = getPriority(collectionA.mode) - getPriority(collectionB.mode);
        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        if (collectionA.mode === 'late' && collectionB.mode === 'late') {
          const lateDifference = collectionA.value - collectionB.value;
          if (lateDifference !== 0) {
            return lateDifference;
          }
        } else {
          const dateDifference =
            (loanA.nextDueDate || loanA.expiresAt) - (loanB.nextDueDate || loanB.expiresAt);
          if (dateDifference !== 0) {
            return dateDifference;
          }
        }

        const expirationDifference = loanA.expiresAt - loanB.expiresAt;
        if (expirationDifference !== 0) {
          return expirationDifference;
        }

        const clientNameA = clients[loanA.clientId]?.fullName || '';
        const clientNameB = clients[loanB.clientId]?.fullName || '';
        return clientNameA.localeCompare(clientNameB, 'es');
      });
  }, [clients, loans, search, selectedCategory, selectedCollector, selectedCompany, sectionLoanType, sectionOrigenFilter, selectedClientHealth]);

  const availableCompanies = useMemo(
    () =>
      Array.from(
        Object.values(clients).reduce<Map<string, string>>((accumulator, client) => {
          const normalized = normalizeCompanyName(client.workplaceName);
          if (!normalized) return accumulator;
          if (!accumulator.has(normalized)) {
            accumulator.set(normalized, client.workplaceName.trim());
          }
          return accumulator;
        }, new Map())
      )
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'es')),
    [clients]
  );

  const groupedLoans = useMemo<LoanGroupRow[]>(() => {
    const groups = new Map<string, LoanGroupRow>();

    filteredLoans.forEach((loan) => {
      const groupKey = `${loan.clientId}::${loan.currency || 'PYG'}`;
      const client = clients[loan.clientId];
      const snapshot = getLoanFinancialSnapshot(loan);
      const principalDue = snapshot.effectiveBalance || loan.currentBalance || loan.principal;
      const interestDue = snapshot.accruedInterest || 0;
      const moraAmount = snapshot.mora || 0;
      const totalDue = principalDue + interestDue + moraAmount;
      const collectionDay = getCollectionDayIndicator(
        { ...loan, currentDueDate: snapshot.currentDueDate },
        Date.now()
      );
      const managementKey = getCollectionManagementId(
        loan.id!,
        getLoanDueDateForManagement(loan)
      );
      const managementStatus =
        collectionManagements.get(managementKey)?.status || 'PENDING';
      const creditStatus = getCreditInfo(loan.expiresAt, loan.inforconfConfirmedAt);
      const loanWithComputed = {
        ...loan,
        snapshot,
        collectionDay,
        managementStatus,
        creditStatus,
        principalDue,
        interestDue,
        moraAmount,
        totalDue,
      };

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          clientId: loan.clientId,
          currency: loan.currency || 'PYG',
          client,
          loans: [loanWithComputed],
          primaryLoan: loanWithComputed,
          totalPrincipalDue: principalDue,
          totalInterestDue: interestDue,
          totalMoraAmount: moraAmount,
          totalDue,
          totalPaidAmount: loan.paidAmount || 0,
          totalCredits: 1,
          managementStatus,
          creditStatusLabel: creditStatus.status,
        });
        return;
      }

      const existing = groups.get(groupKey)!;
      existing.loans.push(loanWithComputed);
      existing.totalPrincipalDue += principalDue;
      existing.totalInterestDue += interestDue;
      existing.totalMoraAmount += moraAmount;
      existing.totalDue += totalDue;
      existing.totalPaidAmount += loan.paidAmount || 0;
      existing.totalCredits += 1;
      existing.managementStatus =
        existing.managementStatus === 'MANAGED' && managementStatus === 'MANAGED'
          ? 'MANAGED'
          : 'PENDING';

      const severity: Record<string, number> = {
        BUENO: 0,
        INFORCONF: 1,
        PREJUDICIAL: 2,
        JUDICIAL: 3,
      };
      if (
        severity[creditStatus.status] >
        severity[existing.creditStatusLabel] 
      ) {
        existing.creditStatusLabel = creditStatus.status;
      }
    });

    return Array.from(groups.values());
  }, [clients, collectionManagements, filteredLoans]);

  useEffect(() => {
    setCurrentPage(1);
    setExpandedClientId(null);
  }, [search, selectedCategory, selectedCollector, selectedCompany, sectionLoanType, selectedClientHealth]);

  const sectionTitle =
    location.pathname === '/creditos'
      ? 'Creditos'
      : location.pathname === '/cartera-activa'
        ? 'Cartera Activa'
      : location.pathname === '/alquileres'
        ? 'Alquileres'
        : location.pathname === '/prestacion-servicios'
          ? 'Prestacion de Servicios'
          : location.pathname === '/empenos'
            ? 'Empenos'
            : 'Cartera de Creditos';

  const totalPages = Math.max(1, Math.ceil(groupedLoans.length / PAGE_SIZE));

  const paginatedGroups = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return groupedLoans.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, groupedLoans]);
  const creditPrincipalMin = creditForm.currency === 'USD' ? 1 : 1000;
  const creditPrincipalStep = creditForm.currency === 'USD' ? 1 : 1000;

  const handleFreeze = async (loanId: string) => {
    if (!window.confirm('Seguro que deseas congelar este credito?')) return;
    await freezeLoan(loanId, userData!.uid);
    await fetchData();
  };

  const handleRedirectLoan = async () => {
    if (!redirectingLoan || !newCollectorId) return;
    const selected = collectors.find((collector) => collector.uid === newCollectorId);
    if (!selected) return;
    await redirectLoanToCollector(redirectingLoan.id!, newCollectorId, selected.name, userData!.uid);
    setRedirectingLoan(null);
    setNewCollectorId('');
    await fetchData();
  };

  const handleDeleteLoan = async (loanId: string) => {
    const reason = window.prompt('Indica la razon obligatoria de anulacion del credito:');
    if (!reason?.trim()) return;
    if (!window.confirm('El credito quedara anulado y se conservara todo su historial. Continuar?')) return;
    await deleteLoan(loanId, userData!.uid, reason);
    await fetchData();
  };

  const handleConfirmInforconf = async (loanId: string) => {
    await confirmInforconf(loanId, userData!.uid);
    await fetchData();
  };

  const handleSaveMeta = async () => {
    if (!editingLoan) return;
    await updateLoanAdminMeta(editingLoan.id!, userData!.uid, metaForm);
    setEditingLoan(null);
    await fetchData();
  };

  const openCreditEditor = (loan: Loan) => {
    setEditingCreditLoan(loan);
    setCreditForm({
      principal: loan.principal,
      currency: loan.currency || 'PYG',
      interestRate: loan.interestRate,
      daysToExpire: loan.cycleDays || 30,
      creditDate: formatDateInputValue(loan.grantedAt),
      collectorId: loan.collectorId,
      hasPagare: loan.hasPagare || false,
      isLocatable: loan.isLocatable || false,
    });
  };

  const handleSaveCredit = async () => {
    if (!editingCreditLoan || !userData) return;
    const selectedCollector = collectors.find((collector) => collector.uid === creditForm.collectorId);
    if (!selectedCollector) {
      alert('Selecciona un cobrador valido para este credito.');
      return;
    }

    const grantedAt = parseDateInputValue(creditForm.creditDate);
    if (!grantedAt || creditForm.principal <= 0 || creditForm.daysToExpire <= 0) {
      alert('Verifica el monto, la fecha y los dias del credito.');
      return;
    }

    const cycleMonths = getCalendarMonthSpanFromDays(creditForm.daysToExpire);
    const expiresAt = addUtcMonthsPreservingDay(grantedAt, cycleMonths);
    const cycleDays = Math.round((expiresAt - grantedAt) / (24 * 60 * 60 * 1000));
    await updateLoanAdmin(editingCreditLoan.id!, userData.uid, {
      principal: creditForm.principal,
      currency: creditForm.currency,
      interestRate: creditForm.interestRate,
      cycleDays,
      grantedAt,
      expiresAt,
      collectorId: selectedCollector.uid,
      collectorName: selectedCollector.name,
      hasPagare: creditForm.hasPagare,
      isLocatable: creditForm.isLocatable,
    });

    setEditingCreditLoan(null);
    await fetchData();
  };

  const openPaymentsModal = async (loan: Loan) => {
    setManagingPaymentsLoan(loan);
    setPaymentsLoading(true);
    setEditingPayment(null);
    setPaymentEditAmount('');

    try {
      const paymentsSnap = await getDocs(
        query(collection(db, `companies/${COMPANY_ID}/payments`), where('loanId', '==', loan.id))
      );
      const orderedPayments = paymentsSnap.docs
        .map((item) => ({ id: item.id, ...(item.data() as Payment) }))
        .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      setLoanPayments(orderedPayments);
    } catch (error) {
      console.error('Error cargando abonos del credito:', error);
      alert('No se pudieron cargar los abonos de este credito.');
    } finally {
      setPaymentsLoading(false);
    }
  };

  const handleEditPayment = (payment: Payment) => {
    setEditingPayment(payment);
    setPaymentEditAmount(payment.amount);
  };

  const handleSavePayment = async () => {
    if (!editingPayment || !userData || typeof paymentEditAmount !== 'number') return;

    await updatePaymentAdmin(editingPayment.id!, paymentEditAmount, userData.uid);
    setEditingPayment(null);
    setPaymentEditAmount('');

    if (managingPaymentsLoan) {
      await openPaymentsModal(managingPaymentsLoan);
    }
    await fetchData();
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!userData) return;
    const reason = window.prompt('Indica la razon obligatoria de anulacion del cobro:');
    if (!reason?.trim()) return;
    if (!window.confirm('El cobro quedara anulado y se conservara todo su historial. Continuar?')) return;

    await deletePaymentAdmin(paymentId, userData.uid, reason);
    if (managingPaymentsLoan) {
      await openPaymentsModal(managingPaymentsLoan);
    }
    await fetchData();
  };

  const openPaymentsHistoryModal = async (group: LoanGroupRow) => {
    setViewingPaymentsGroup(group);
    setViewingPaymentsLoading(true);
    setViewingPayments([]);

    try {
      const paymentSnapshots = await Promise.all(
        group.loans.map((loan) =>
          getDocs(query(collection(db, `companies/${COMPANY_ID}/payments`), where('loanId', '==', loan.id)))
        )
      );

      const payments = paymentSnapshots
        .flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Payment) })))
        .sort((left, right) => (right.paidAt || right.createdAt || 0) - (left.paidAt || left.createdAt || 0));

      setViewingPayments(payments);
    } catch (error) {
      console.error('Error cargando historial de abonos:', error);
      alert('No se pudo cargar el historial de abonos.');
      setViewingPaymentsGroup(null);
    } finally {
      setViewingPaymentsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando cartera de creditos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {userData?.role === 'ADMIN' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <button
            onClick={() => setSelectedCollector('ALL')}
            className={`px-4 py-2 rounded-md transition-colors ${
              selectedCollector === 'ALL'
                ? 'bg-blue-600 text-white font-semibold'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Todos ({loans.length})
          </button>
          {collectors.map((collector) => (
            <button
              key={collector.uid}
              onClick={() => setSelectedCollector(collector.uid)}
              className={`px-4 py-2 rounded-md transition-colors text-sm ${
                selectedCollector === collector.uid
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {collector.name} ({loans.filter((loan) => loan.collectorId === collector.uid).length})
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <div className="p-4 border-b bg-gray-50 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{sectionTitle} ({groupedLoans.length})</h2>
            <p className="text-sm text-gray-500">
              Solo creditos aprobados y listos para control de cartera.
            </p>
          </div>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por cliente, C.I., telefono, cobrador o ID..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[280px]"
            />
            <select
              value={selectedCompany}
              onChange={(event) => setSelectedCompany(event.target.value as string | 'ALL')}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[220px]"
            >
              <option value="ALL">Empresas (todas)</option>
              {availableCompanies.map((company) => (
                <option key={company.value} value={company.value}>
                  {company.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => navigate('/creditos/nuevo')}
              className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700"
            >
              {userData?.role === 'ADMIN' ? 'Nuevo Credito' : 'Cargar Credito'}
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b bg-white flex flex-wrap gap-2">
          {location.pathname === '/creditos' &&
            ([
              { key: 'ALL', label: 'Todos' },
              { key: 'GOOD', label: 'Clientes buenos' },
              { key: 'BAD', label: 'Clientes malos' },
            ] as const).map((health) => (
              <button
                key={health.key}
                onClick={() => setSelectedClientHealth(health.key)}
                className={`px-3 py-2 rounded-full text-xs font-semibold transition ${
                  selectedClientHealth === health.key
                      ? 'bg-emerald-700 text-white'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {health.label}
              </button>
            ))}
          {(['ALL', 'BUENO', 'INFORCONF', 'PREJUDICIAL', 'JUDICIAL'] as const).map((category) => (
            <button
              key={category}
              onClick={() => {
                setSelectedCategory(category);
                if (category === 'ALL') setSearchParams({});
                else setSearchParams({ categoria: category });
              }}
              className={`px-3 py-2 rounded-full text-xs font-semibold transition ${
                selectedCategory === category
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {category === 'ALL' ? 'Todas las categorias' : category}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
              <tr>
                <th className="px-6 py-3 font-semibold">Cliente</th>
                <th className="px-6 py-3 font-semibold">Otorgado</th>
                                <th className="px-6 py-3 font-semibold">Tipo</th>
                <th className="px-6 py-3 font-semibold">Capital</th>
                <th className="px-6 py-3 font-semibold">Vencimiento</th>
                <th className="px-6 py-3 font-semibold">Interes total</th>
                <th className="px-6 py-3 font-semibold">Mora / Dias</th>
                <th className="px-6 py-3 font-semibold">Total adeudado</th>
                <th className="px-6 py-3 font-semibold">Total abonado</th>
                <th className="px-6 py-3 font-semibold">Estado</th>
                <th className="px-6 py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {/* Render each loan group */}
{paginatedGroups.map((group) => {
  const { client, primaryLoan } = group;
  const rowClassName =
    group.managementStatus === 'MANAGED'
      ? 'bg-sky-50 border-b border-sky-200 hover:bg-sky-100 transition-colors'
      : 'bg-orange-50 border-b border-orange-200 hover:bg-orange-100 transition-colors';
  const isExpanded = expandedClientId === group.groupKey;
  return (
    <>
      <tr className={rowClassName}>
        <td className="px-6 py-4">
          <div
            onClick={() => {
              if (client) setPreviewClient(client);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (client) setPreviewClient(client);
            }}
            className="font-bold text-blue-700 cursor-context-menu"
            title="Clic derecho para ver los datos completos"
          >
            {client?.fullName || 'Desconocido'}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            C.I.: {client?.documentId || primaryLoan.clientDocumentId || 'Sin documento'}
          </p>
          {[...new Set(group.loans.map((item) => item.description || item.pawnDescription).filter(Boolean))].map(
            (description) => (
              <p key={description} className="mt-1 max-w-xs text-xs font-normal text-slate-500">
                {description}
              </p>
            )
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton
              onClick={() => setOpenAdminLoanId((current) => (current === group.groupKey ? null : group.groupKey))}
              className="bg-slate-700 text-white hover:bg-slate-800"
            >
              Administrar
            </ActionButton>
            {openAdminLoanId === group.groupKey && (
              <div className="basis-full mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                {group.loans.map((item) => (
                  <div key={`admin-${item.id}`} className="rounded-lg border border-slate-200 p-2 mb-2 last:mb-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Credito {item.id?.slice(0, 8).toUpperCase()}
                    </p>
                    {item.creditStatus.status === 'INFORCONF' && !item.inforconfConfirmedAt && (
                      <div className="mt-2">
                        <ActionButton onClick={() => void handleConfirmInforconf(item.id!)} className="w-full bg-amber-500 text-white hover:bg-amber-600">
                          Confirmar Inforconf
                        </ActionButton>
                      </div>
                    )}
                    <div className="mt-2">
                      <ActionButton onClick={() => openPaymentsModal(item)} className="w-full bg-cyan-600 text-white hover:bg-cyan-700">
                        Editar abonos
                      </ActionButton>
                    </div>
                    <div className="mt-2">
                      <ActionButton onClick={() => openCreditEditor(item)} className="w-full bg-indigo-600 text-white hover:bg-indigo-700">
                        Editar credito
                      </ActionButton>
                    </div>
                    <div className="mt-2">
                      <ActionButton
                        onClick={() => {
                          setEditingLoan(item);
                          setMetaForm({ hasPagare: item.hasPagare || false, isLocatable: item.isLocatable || false });
                        }}
                        className="w-full bg-slate-700 text-white hover:bg-slate-800"
                      >
                        Editar requisitos
                      </ActionButton>
                    </div>
                    {item.status === 'ACTIVE' && (
                      <div className="mt-2">
                        <ActionButton onClick={() => void handleFreeze(item.id!)} className="w-full bg-orange-500 text-white hover:bg-orange-600">
                          Congelar credito
                        </ActionButton>
                      </div>
                    )}
                    {item.status === 'ACTIVE' && (
                      <div className="mt-2">
                        <ActionButton onClick={() => { setRedirectingLoan(item); setNewCollectorId(''); }} className="w-full bg-blue-600 text-white hover:bg-blue-700">
                          Redirigir
                        </ActionButton>
                      </div>
                    )}
                    <ActionButton onClick={() => void handleDeleteLoan(item.id!)} className="w-full bg-rose-600 text-white hover:bg-rose-700">
                      Anular credito
                    </ActionButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        </td>
        <td className="px-6 py-4">
          {formatDisplayDate(
            group.loans.reduce(
              (earliest, item) => Math.min(earliest, item.grantedAt),
              group.loans[0].grantedAt
            )
          )}
        </td>
        <td className="px-6 py-4">
          <div className="flex flex-wrap gap-1">
            {[...new Set(group.loans.map((item) => getLoanOriginLabel(item)))].map((origin) => (
              <span key={origin} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                {origin}
              </span>
            ))}
          </div>
        </td>
        <td className="px-6 py-4 font-semibold text-gray-800">
          {formatCurrencyAmount(group.totalPrincipalDue, group.currency)}
        </td>
        <td className="px-6 py-4 font-semibold text-gray-700">
          {formatDisplayDate(primaryLoan.snapshot.currentDueDate || primaryLoan.expiresAt)}
        </td>
        <td className="px-6 py-4">
          {formatCurrencyAmount(group.totalInterestDue, group.currency)}
        </td>
        <td className="px-6 py-4">
          <div className={`font-bold ${primaryLoan.collectionDay.mode === 'late' ? 'text-red-600' : 'text-gray-500'}`}>
            {formatCurrencyAmount(group.totalMoraAmount, group.currency)}
          </div>
          <div className={`text-xs font-semibold ${
            primaryLoan.collectionDay.mode === 'upcoming'
              ? 'text-emerald-600'
              : primaryLoan.collectionDay.mode === 'due_today'
                ? 'text-slate-900'
                : primaryLoan.collectionDay.mode === 'late'
                  ? 'text-red-600'
                  : 'text-gray-500'
          }`}>
            {primaryLoan.collectionDay.label}
          </div>
        </td>
        <td className="px-6 py-4 font-bold text-blue-700">
          {formatCurrencyAmount(group.totalDue, group.currency)}
        </td>
        <td className="px-6 py-4 font-bold text-purple-700">
          <button
            type="button"
            onClick={() => void openPaymentsHistoryModal(group)}
            className="hover:underline"
          >
            {formatCurrencyAmount(group.totalPaidAmount, group.currency)}
          </button>
        </td>
        <td className="px-6 py-4">
          <span className="bg-slate-100 text-slate-800 px-3 py-1 rounded-full text-xs font-semibold">
            {group.creditStatusLabel}
          </span>
          <div className="mt-2">
            <span className={`px-3 py-1 rounded-full text-[11px] font-semibold ${
              group.managementStatus === 'MANAGED'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-orange-100 text-orange-800'
            }`}>
              {group.managementStatus === 'MANAGED' ? 'Gestionado' : 'Pendiente'}
            </span>
          </div>
          {group.loans.some((item) => item.inforconfConfirmedAt) ? (
            <div className="mt-2 text-[11px] text-emerald-700 font-semibold">Inforconf confirmado</div>
          ) : group.creditStatusLabel === 'INFORCONF' ? (
            <div className="mt-2 text-[11px] text-amber-700 font-semibold">Pendiente de confirmar</div>
          ) : null}
        </td>
        <td className="px-6 py-4">
          <ActionButton
            onClick={() => setOpenCollectionGroupId((current) => (current === group.groupKey ? null : group.groupKey))}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Cobrar
          </ActionButton>
          {openCollectionGroupId === group.groupKey && (
            <div className="mt-2 w-52 rounded-lg border border-emerald-200 bg-white p-2 shadow-lg">
              {group.loans.map((item) => (
                <div key={`collect-${item.id}`} className="border-b border-slate-100 pb-2 mb-2 last:border-0 last:mb-0 last:pb-0">
                  <p className="px-2 text-[11px] font-semibold text-slate-500">Credito {item.id?.slice(0, 8).toUpperCase()}</p>
                  {(['CAPITAL', 'INTEREST', 'MIXED'] as const).map((paymentType) => (
                    <button
                      key={paymentType}
                      type="button"
                      onClick={() => navigate(`/cobro/${item.id}?tipo=${paymentType}`)}
                      className="mt-1 block w-full rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-emerald-50"
                    >
                      {paymentType === 'CAPITAL' ? 'Cobro capital' : paymentType === 'INTEREST' ? 'Cobro interes' : 'Cobro ambos'}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className={rowClassName}>
          <td colSpan={11} className="px-6 py-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Creditos activos de {client?.fullName || 'Cliente'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Desglose individual de los creditos agrupados en esta cartera.
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
                  {group.totalCredits} credito{group.totalCredits !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid gap-3">
                {group.loans.map((item) => (
                  <div key={`expanded-${item.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Credito</p>
                        <p className="mt-1 font-semibold text-slate-900">{item.id?.slice(0, 8).toUpperCase()}</p>
                        <p className="mt-1 text-xs text-slate-500">{getLoanTypeLabel(item.loanType)} | {getCurrencySymbol(item.currency)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Otorgado</p>
                        <p className="mt-1 text-slate-800">{formatDisplayDate(item.grantedAt)}</p>
                      </div>
                      {/* Additional columns can be added here as needed */}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
})}

              {groupedLoans.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-8 text-center text-gray-500">
                    No se encontraron creditos para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {groupedLoans.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-gray-600">
              Mostrando {(currentPage - 1) * PAGE_SIZE + 1}-
              {Math.min(currentPage * PAGE_SIZE, groupedLoans.length)} de {groupedLoans.length} filas
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                disabled={currentPage === 1}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    currentPage === page
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                disabled={currentPage === totalPages}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {redirectingLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6">
            <h2 className="text-lg font-bold mb-4 text-gray-900">Redirigir Credito</h2>
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Cliente:</span> {clients[redirectingLoan.clientId]?.fullName}
              </p>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Cobrador actual:</span> {redirectingLoan.collectorName}
              </p>
            </div>
            <select
              value={newCollectorId}
              onChange={(event) => setNewCollectorId(event.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">-- Selecciona un cobrador --</option>
              {collectors
                .filter((collector) => collector.uid !== redirectingLoan.collectorId)
                .map((collector) => (
                  <option key={collector.uid} value={collector.uid}>
                    {collector.name}
                  </option>
                ))}
            </select>
            <div className="flex gap-2 mt-4">
              <button onClick={() => void handleRedirectLoan()} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg">
                Redirigir
              </button>
              <button onClick={() => setRedirectingLoan(null)} className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {editingLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6">
            <h2 className="text-lg font-bold mb-4 text-gray-900">Editar requisitos del credito</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={metaForm.hasPagare}
                  onChange={(event) => setMetaForm((previous) => ({ ...previous, hasPagare: event.target.checked }))}
                />
                Tiene pagare
              </label>
              <label className="flex items-center gap-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={metaForm.isLocatable}
                  onChange={(event) => setMetaForm((previous) => ({ ...previous, isLocatable: event.target.checked }))}
                />
                Cliente ubicable
              </label>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => void handleSaveMeta()} className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg">
                Guardar
              </button>
              <button onClick={() => setEditingLoan(null)} className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCreditLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6">
            <h2 className="text-lg font-bold mb-4 text-gray-900">Editar credito</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Monto principal</label>
                <input
                  type="number"
                  value={creditForm.principal}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, principal: Number(event.target.value) }))}
                  min={creditPrincipalMin}
                  step={creditPrincipalStep}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {creditForm.currency === 'USD'
                    ? 'En USD puedes cargar desde 1.'
                    : 'En Gs se mantiene la carga desde 1.000.'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Interes (%)</label>
                <input
                  type="number"
                  value={creditForm.interestRate}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, interestRate: Number(event.target.value) }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Moneda</label>
                <select
                  value={creditForm.currency}
                  onChange={(event) =>
                    setCreditForm((previous) => ({
                      ...previous,
                      currency: event.target.value as CurrencyCode,
                    }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="PYG">Gs</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Dias para vencer</label>
                <input
                  type="number"
                  value={creditForm.daysToExpire}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, daysToExpire: Number(event.target.value) }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha del credito</label>
                <input
                  type="date"
                  value={creditForm.creditDate}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, creditDate: event.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Cobrador</label>
                <select
                  value={creditForm.collectorId}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, collectorId: event.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">-- Selecciona un cobrador --</option>
                  {collectors.map((collector) => (
                    <option key={collector.uid} value={collector.uid}>
                      {collector.name} {collector.role === 'ADMIN' ? '(Admin)' : '(Cobrador)'}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={creditForm.hasPagare}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, hasPagare: event.target.checked }))}
                />
                Tiene pagare
              </label>
              <label className="flex items-center gap-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={creditForm.isLocatable}
                  onChange={(event) => setCreditForm((previous) => ({ ...previous, isLocatable: event.target.checked }))}
                />
                Cliente ubicable
              </label>
            </div>
            <div className="mt-6 flex gap-2">
              <button onClick={() => void handleSaveCredit()} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg">
                Guardar cambios
              </button>
              <button onClick={() => setEditingCreditLoan(null)} className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {managingPaymentsLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Editar abonos del cliente</h2>
                <p className="text-sm text-gray-500">
                  {clients[managingPaymentsLoan.clientId]?.fullName || 'Cliente'} | {managingPaymentsLoan.id?.slice(0, 8).toUpperCase()}
                </p>
                <p className="text-xs text-cyan-700 mt-1">
                  Panel exclusivo de administracion para revisar, editar o anular abonos.
                </p>
              </div>
              <button onClick={() => setManagingPaymentsLoan(null)} className="text-sm font-semibold text-gray-500 hover:text-gray-700">
                Cerrar
              </button>
            </div>

            {paymentsLoading ? (
              <div className="py-10 text-center text-gray-500">Cargando abonos...</div>
            ) : loanPayments.length === 0 ? (
              <div className="py-10 text-center text-gray-500">Este credito aun no tiene abonos.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {loanPayments.map((payment, index) => {
                  const isLatestApproved =
                    (payment.approvalStatus || 'APPROVED') === 'APPROVED' &&
                    loanPayments.filter((item) => (item.approvalStatus || 'APPROVED') === 'APPROVED')[0]?.id === payment.id;

                  return (
                    <div key={payment.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">
                            Abono #{index + 1} | {formatCurrencyAmount(payment.amount, payment.currency || managingPaymentsLoan.currency)}
                          </p>
                          <p className="text-sm text-slate-600">
                            {new Date(payment.paidAt || payment.createdAt).toLocaleString('es-PY')} | {payment.collectorName}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Saldo anterior: {formatCurrencyAmount(payment.previousBalance || 0, payment.currency || managingPaymentsLoan.currency)} | Saldo nuevo: {formatCurrencyAmount(payment.newBalance || 0, payment.currency || managingPaymentsLoan.currency)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className={`px-3 py-2 rounded-lg text-xs font-semibold ${(payment.approvalStatus || 'APPROVED') === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {(payment.approvalStatus || 'APPROVED') === 'APPROVED' ? 'Aprobado' : 'Pendiente'}
                          </span>
                          <ActionButton
                            onClick={() => navigate(`/imprimir/ticket/${payment.id}`)}
                            className="bg-slate-900 text-white hover:bg-slate-800"
                          >
                            Reimprimir
                          </ActionButton>
                          {isLatestApproved && (
                            <>
                              <ActionButton onClick={() => handleEditPayment(payment)} className="bg-indigo-600 text-white hover:bg-indigo-700">
                                Editar abono
                              </ActionButton>
                              <ActionButton onClick={() => void handleDeletePayment(payment.id!)} className="bg-rose-600 text-white hover:bg-rose-700">
                                Anular abono
                              </ActionButton>
                            </>
                          )}
                        </div>
                      </div>
                      {!isLatestApproved && (payment.approvalStatus || 'APPROVED') === 'APPROVED' && (
                        <p className="mt-3 text-xs text-amber-700">
                          Solo el ultimo abono aprobado puede modificarse o anularse para no romper el saldo historico.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {editingPayment && (
              <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <h3 className="font-semibold text-indigo-900">Editar abono seleccionado</h3>
                <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-indigo-900 mb-2">Nuevo monto</label>
                    <input
                      type="number"
                      value={paymentEditAmount}
                      onChange={(event) => setPaymentEditAmount(event.target.value ? Number(event.target.value) : '')}
                      className="w-full px-4 py-2 border border-indigo-300 rounded-lg"
                    />
                  </div>
                  <ActionButton onClick={() => void handleSavePayment()} className="bg-indigo-600 text-white hover:bg-indigo-700">
                    Guardar abono
                  </ActionButton>
                  <ActionButton onClick={() => { setEditingPayment(null); setPaymentEditAmount(''); }} className="bg-gray-300 text-gray-700 hover:bg-gray-400">
                    Cancelar
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {viewingPaymentsGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-3xl w-full p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Historial de abonos</h2>
                <p className="text-sm text-gray-500">
                  {viewingPaymentsGroup.client?.fullName || 'Cliente'} | {viewingPaymentsGroup.totalCredits} credito{viewingPaymentsGroup.totalCredits !== 1 ? 's' : ''} | {getCurrencySymbol(viewingPaymentsGroup.currency)}
                </p>
              </div>
              <button onClick={() => setViewingPaymentsGroup(null)} className="text-sm font-semibold text-gray-500 hover:text-gray-700">
                Cerrar
              </button>
            </div>

            {viewingPaymentsLoading ? (
              <div className="py-10 text-center text-gray-500">Cargando abonos...</div>
            ) : viewingPayments.length === 0 ? (
              <div className="py-10 text-center text-gray-500">No hay abonos registrados.</div>
            ) : (
              <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto">
                {viewingPayments.map((payment, index) => (
                  <div key={payment.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">
                          Abono #{index + 1} | {formatCurrencyAmount(payment.amount, payment.currency || viewingPaymentsGroup.currency)}
                        </p>
                        <p className="text-sm text-slate-600">
                          {new Date(payment.paidAt || payment.createdAt).toLocaleString('es-PY')} | {payment.collectorName}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Credito {payment.loanId?.slice(0, 8).toUpperCase()} | Saldo anterior: {formatCurrencyAmount(payment.previousBalance || 0, payment.currency || viewingPaymentsGroup.currency)} | Saldo nuevo: {formatCurrencyAmount(payment.newBalance || 0, payment.currency || viewingPaymentsGroup.currency)}
                        </p>
                      </div>
                      <ActionButton
                        onClick={() => navigate(`/imprimir/ticket/${payment.id}`)}
                        className="bg-slate-900 text-white hover:bg-slate-800"
                      >
                        Reimprimir
                      </ActionButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {previewClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Datos rapidos del cliente</h2>
                <p className="text-sm text-slate-500">
                  Consulta rapida desde cartera para ubicar y contactar al cliente.
                </p>
              </div>
              <button
                onClick={() => setPreviewClient(null)}
                className="text-sm font-semibold text-slate-500 hover:text-slate-700"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <InfoCard label="Cliente" value={previewClient.fullName} />
              <InfoCard label="C.I." value={previewClient.documentId} />
              <InfoCard label="Telefono principal" value={previewClient.phone} />
              <InfoCard label="Telefono laboral" value={previewClient.workPhone || 'Sin registro'} />
              <InfoCard label="Lugar de trabajo" value={previewClient.workplaceName || 'Sin registro'} />
              <InfoCard label="Cargo / Area" value={[previewClient.position, previewClient.department].filter(Boolean).join(' | ') || 'Sin registro'} />
              <InfoCard label="Direccion laboral" value={previewClient.workplaceAddress || 'Sin registro'} />
              <InfoCard
                label="Ciudad / Barrio laboral"
                value={[previewClient.workplaceCity, previewClient.workplaceNeighborhood].filter(Boolean).join(' | ') || 'Sin registro'}
              />
              <InfoCard label="Direccion particular" value={previewClient.address} />
              <InfoCard
                label="Ciudad / Barrio"
                value={[previewClient.city, previewClient.neighborhood].filter(Boolean).join(' | ') || 'Sin registro'}
              />
              <InfoCard label="Cobrador asignado" value={previewClient.collectorName || 'Sin asignar'} />
              <InfoCard label="Estado laboral" value={previewClient.employmentStatus} />
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Referencias personales
              </h3>
              {!previewClient.references || previewClient.references.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  Este cliente no tiene referencias personales registradas.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {previewClient.references.map((reference, index) => (
                    <div
                      key={`preview-reference-${index}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Referencia {index + 1}
                      </p>
                      <div className="mt-3 space-y-2">
                        <p className="text-sm font-medium text-slate-900">
                          {reference.name || 'No registrado'}
                        </p>
                        <p className="text-sm text-slate-600">
                          {reference.relationship || 'Relacion no registrada'}
                        </p>
                        <p className="text-sm text-slate-600">
                          {reference.workplace || 'Trabajo no registrado'}
                        </p>
                        <p className="text-sm text-slate-700">
                          {reference.phone || 'Telefono no registrado'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.open(`tel:${previewClient.phone}`, '_self')}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Llamar al cliente
              </button>
              {previewClient.workPhone && (
                <button
                  type="button"
                  onClick={() => window.open(`tel:${previewClient.workPhone}`, '_self')}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                >
                  Llamar al trabajo
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate(`/clientes/${previewClient.id}`)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
              >
                Ver ficha completa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${className}`}
    >
      {children}
    </button>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
