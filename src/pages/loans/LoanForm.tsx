import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { COMPANY_ID, db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Client, CurrencyCode, LoanType, PlanFrecuencia, User } from '../../types';
import {
  calculateInterestAmount,
  createLoan,
  DEFAULT_INTEREST_RATE,
  loanTypeUsesInitialInterest,
} from '../../services/loanService';
import { syncFinancialLoan } from '../../services/userService';
import { formatCurrencyAmount } from '../../utils/currencyUtils';
import {
  addUtcMonthsPreservingDay,
  formatDateInputValue,
  getCalendarMonthSpanFromDays,
  parseDateInputValue,
} from '../../utils/dateUtils';

export default function LoanForm() {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [collectors, setCollectors] = useState<User[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCollector, setSelectedCollector] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    clientId: '',
    collectorId: '',
    principal: 0,
    currency: 'PYG' as CurrencyCode,
    interestRate: DEFAULT_INTEREST_RATE,
    loanType: 'PRESTAMO' as LoanType,
    description: '',
    daysToExpire: 365,
    planFrecuencia: 'MENSUAL' as PlanFrecuencia,
    cantidadCuotas: 12,
    hasPagare: false,
    isLocatable: false,
    creditDate: formatDateInputValue(Date.now()),
  });

  const [showPagareModal, setShowPagareModal] = useState(false);
  const [selectedTomoInput, setSelectedTomoInput] = useState('1');
  const [savingPagareModal, setSavingPagareModal] = useState(false);

  useEffect(() => {
    void loadData();
  }, [userData?.uid, userData?.role]);

  useEffect(() => {
    if (!clientSearch.trim()) {
      setFilteredClients(clients);
      return;
    }

    const search = clientSearch.toLowerCase();
    setFilteredClients(
      clients.filter(
        (client) =>
          client.fullName.toLowerCase().includes(search) ||
          client.documentId.includes(search) ||
          client.phone.includes(search)
      )
    );
  }, [clientSearch, clients]);

  const loadData = async () => {
    try {
      setFetching(true);
      const clientsSnap = await getDocs(
        query(collection(db, `companies/${COMPANY_ID}/clients`))
      );

      const allClients = clientsSnap.docs.map(
        (item) => ({ ...item.data(), id: item.id } as Client)
      );
      setClients(allClients);
      setFilteredClients(allClients);
      if (userData?.role === 'ADMIN') {
        const collectorsSnap = await getDocs(
          query(collection(db, `companies/${COMPANY_ID}/users`), where('isActive', '==', true))
        );
        const activeCollectors = collectorsSnap.docs
          .map((item) => item.data() as User)
          .filter((user) => user.role === 'COLLECTOR' || user.role === 'ADMIN');
        setCollectors(activeCollectors);
      } else if (userData?.role === 'COLLECTOR') {
        const ownCollector: User = {
          ...userData,
          uid: userData.uid,
        };
        setCollectors([ownCollector]);
        setSelectedCollector(ownCollector);
        setFormData((previous) => ({ ...previous, collectorId: ownCollector.uid }));
      }
    } catch (error) {
      console.error('Error cargando datos:', error);
      setErrors({ general: 'Error al cargar los datos' });
    } finally {
      setFetching(false);
    }
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!selectedClient) nextErrors.client = 'Selecciona un cliente';
    if (!selectedCollector) nextErrors.collector = 'Selecciona un cobrador';
    if (!formData.principal || formData.principal <= 0) nextErrors.principal = 'Monto invalido';
    if (formData.interestRate < 0) nextErrors.interest = 'Interes invalido';
    if (!formData.daysToExpire || formData.daysToExpire <= 0) nextErrors.days = 'Dias invalidos';
    if (
      ['EMPENO', 'PRESTACION_SERVICIOS', 'ALQUILER_INMUEBLE'].includes(formData.loanType) &&
      !formData.description.trim()
    ) {
      nextErrors.description = 'Agrega una descripcion para esta operacion';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleLoanTypeChange = (loanType: LoanType) => {
    const isFrozenWithoutInterest =
      loanType === 'ALQUILER_INMUEBLE' || loanType === 'PRESTACION_SERVICIOS';
    setFormData((previous) => ({
      ...previous,
      loanType,
      interestRate: isFrozenWithoutInterest ? 0 : previous.interestRate || DEFAULT_INTEREST_RATE,
      daysToExpire: loanType === 'ALQUILER_INMUEBLE' ? 30 : previous.daysToExpire,
      description: loanType === 'PRESTAMO' ? '' : previous.description,
    }));
  };

  const handleSelectClient = (client: Client) => {
    const assignedCollector =
      collectors.find((collector) => collector.uid === client.collectorId) || selectedCollector;

    setSelectedClient(client);
    setSelectedCollector(assignedCollector || null);
    setFormData((previous) => ({
      ...previous,
      clientId: client.id!,
      collectorId: assignedCollector?.uid || client.collectorId || previous.collectorId,
    }));
    setClientSearch(client.fullName);
    setShowDropdown(false);
    setErrors((previous) => ({ ...previous, client: '' }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateForm() || !userData || !selectedClient || !selectedCollector) return;
    setShowPagareModal(true);
  };

  const handleConfirmPagareModal = async () => {
    if (!selectedClient || !userData || !selectedCollector || !selectedTomoInput.trim()) return;
    setSavingPagareModal(true);
    setLoading(true);
    try {
      const creditDateTs = parseDateInputValue(formData.creditDate);
      const grantedAt = creditDateTs || Date.now();
      const cycleMonths = getCalendarMonthSpanFromDays(formData.daysToExpire);
      const expiresAt = addUtcMonthsPreservingDay(grantedAt, cycleMonths);
      const cycleDays = Math.round((expiresAt - grantedAt) / (24 * 60 * 60 * 1000));

      const months = formData.cantidadCuotas || 12;
      const effectiveInterestRate = loanTypeUsesInitialInterest(formData.loanType)
        ? formData.interestRate * (months / 12)
        : 0;
      const totalInterest = Math.round(formData.principal * (effectiveInterestRate / 100));
      const totalAmount = formData.principal + totalInterest;
      const montoCuota = Math.round(totalAmount / months);

      const createdLoan = await createLoan(
        {
          clientId: selectedClient.id!,
          collectorId: selectedCollector.uid,
          collectorName: selectedCollector.name,
          principal: formData.principal,
          currency: formData.currency,
          interestRate: effectiveInterestRate,
          loanType: formData.loanType,
          description: formData.description.trim(),
          pawnDescription:
            formData.loanType === 'EMPENO' ? formData.description.trim() : '',
          commissionRate: 7,
          cycleDays,
          planFrecuencia: formData.planFrecuencia,
          cantidadCuotas: months,
          montoCuota,
          hasPagare: true,
          tomo: selectedTomoInput.trim(),
          isLocatable: formData.isLocatable,
          creditDate: creditDateTs,
          grantedAt,
          expiresAt,
        },
        userData.uid,
        userData.role
      );

      if (userData.role === 'ADMIN') {
        await syncFinancialLoan(createdLoan.id!);
      }

      alert(
        userData.role === 'ADMIN'
          ? `Credito otorgado y Pagare asignado exitosamente al Tomo ${selectedTomoInput}.`
          : `Credito enviado a aprobacion y Pagare asignado al Tomo ${selectedTomoInput}.`
      );
      navigate('/creditos');
    } catch (error: unknown) {
      console.error('Error al crear credito y pagare:', error);
      setErrors({
        general: error instanceof Error ? error.message : 'Error al crear el credito y pagare',
      });
    } finally {
      setSavingPagareModal(false);
      setLoading(false);
      setShowPagareModal(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando datos...</p>
        </div>
      </div>
    );
  }

  const totalInterest = calculateInterestAmount({
    principal: formData.principal,
    interestRate: formData.interestRate,
    loanType: formData.loanType,
  });
  const totalAmount = formData.principal + totalInterest;
  const principalMin = formData.currency === 'USD' ? 1 : 1000;
  const principalStep = formData.currency === 'USD' ? 1 : 1000;

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 shadow rounded-lg relative">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">
        {userData?.role === 'ADMIN' ? 'Otorgar Nuevo Credito' : 'Cargar Credito para Aprobacion'}
      </h2>

      {errors.general && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-4 rounded">
          {errors.general}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Cliente <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="Busca por nombre, C.I. o telefono..."
              value={clientSearch}
              onChange={(event) => {
                setClientSearch(event.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              className={`w-full border rounded-md p-3 focus:ring-blue-500 focus:border-blue-500 ${
                errors.client ? 'border-red-500' : 'border-gray-300'
              }`}
            />

            {showDropdown && filteredClients.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-64 overflow-y-auto">
                {filteredClients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => handleSelectClient(client)}
                    className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                  >
                    <div className="font-medium text-gray-900">{client.fullName}</div>
                    <div className="text-xs text-gray-500">
                      C.I: {client.documentId} | Tel: {client.phone}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {errors.client && <p className="text-red-500 text-xs mt-1">{errors.client}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Cobrador <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedCollector?.uid || ''}
            onChange={(event) => {
              const collector = collectors.find((item) => item.uid === event.target.value);
              if (collector) {
                setSelectedCollector(collector);
                setFormData((previous) => ({ ...previous, collectorId: collector.uid }));
              }
            }}
            disabled={userData?.role === 'COLLECTOR'}
            className={`w-full border rounded-md p-3 focus:ring-blue-500 focus:border-blue-500 ${
              errors.collector ? 'border-red-500' : 'border-gray-300'
            }`}
          >
            <option value="">-- Selecciona un cobrador --</option>
            {collectors.map((collector) => (
              <option key={collector.uid} value={collector.uid}>
                {collector.name}
              </option>
            ))}
          </select>
          {userData?.role === 'COLLECTOR' && (
            <p className="text-xs text-gray-500 mt-1">
              El credito quedara asignado a tu cartera y esperara aprobacion del admin.
            </p>
          )}
          {errors.collector && <p className="text-red-500 text-xs mt-1">{errors.collector}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
            <select
              value={formData.loanType}
              onChange={(event) => handleLoanTypeChange(event.target.value as LoanType)}
              className="w-full border border-gray-300 rounded-md p-3"
            >
              <option value="PRESTAMO">Credito</option>
              <option value="EMPENO">Empeno</option>
              <option value="PRESTACION_SERVICIOS">Prestacion de Servicios</option>
              <option value="ALQUILER_INMUEBLE">Alquiler / Inmuebles</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {formData.loanType === 'ALQUILER_INMUEBLE' ? 'Monto mensual' : 'Monto Principal'}
            </label>
            <input
              type="number"
              value={formData.principal}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, principal: Number(event.target.value) }))
              }
              min={principalMin}
              step={principalStep}
              className="w-full border border-gray-300 rounded-md p-3"
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.currency === 'USD'
                ? 'En USD puedes cargar desde 1.'
                : 'En Gs se mantiene la carga desde 1.000.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Moneda</label>
            <select
              value={formData.currency}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  currency: event.target.value as CurrencyCode,
                }))
              }
              className="w-full border border-gray-300 rounded-md p-3"
            >
              <option value="PYG">Gs</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Interes (%)</label>
            <input
              type="number"
              value={formData.interestRate}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, interestRate: Number(event.target.value) }))
              }
              min="0"
              max="50"
              step="0.5"
              disabled={!loanTypeUsesInitialInterest(formData.loanType)}
              className="w-full border border-gray-300 rounded-md p-3"
            />
            <p className="text-xs text-gray-500 mt-1">
              {loanTypeUsesInitialInterest(formData.loanType)
                ? 'Base 20%, editable si hace falta.'
                : 'Este tipo no usa interes.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dias para vencer</label>
            <input
              type="number"
              value={formData.daysToExpire}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, daysToExpire: Number(event.target.value) }))
              }
              min="1"
              max="365"
              className="w-full border border-gray-300 rounded-md p-3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Fecha del credito</label>
            <input
              type="date"
              value={formData.creditDate}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, creditDate: event.target.value }))
              }
              className="w-full border border-gray-300 rounded-md p-3"
            />
            <p className="text-xs text-gray-500 mt-1">Permite migrar datos del sistema viejo.</p>
          </div>
        </div>

        <div className="p-4 bg-slate-100/90 border border-slate-300 rounded-xl space-y-3">
          <label className="block text-sm font-bold text-slate-800">
            📅 Frecuencia y Plazo de Pago (Selección Rápida)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  planFrecuencia: 'MENSUAL',
                  cantidadCuotas: 6,
                  daysToExpire: 180,
                }))
              }
              className={`py-2.5 px-3 rounded-lg border text-xs font-bold transition ${
                formData.planFrecuencia === 'MENSUAL' && formData.cantidadCuotas === 6
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Mensual (6 cuotas)
            </button>
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  planFrecuencia: 'MENSUAL',
                  cantidadCuotas: 12,
                  daysToExpire: 365,
                }))
              }
              className={`py-2.5 px-3 rounded-lg border text-xs font-bold transition ${
                formData.planFrecuencia === 'MENSUAL' && formData.cantidadCuotas === 12
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Mensual (12 cuotas)
            </button>
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  planFrecuencia: 'MENSUAL',
                  cantidadCuotas: 18,
                  daysToExpire: 540,
                }))
              }
              className={`py-2.5 px-3 rounded-lg border text-xs font-bold transition ${
                formData.planFrecuencia === 'MENSUAL' && formData.cantidadCuotas === 18
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Mensual (18 cuotas)
            </button>
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  planFrecuencia: 'ANUAL',
                  cantidadCuotas: 12,
                  daysToExpire: 365,
                }))
              }
              className={`py-2.5 px-3 rounded-lg border text-xs font-bold transition ${
                formData.planFrecuencia === 'ANUAL'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Anual (12 meses)
            </button>
          </div>

          {formData.principal > 0 && (() => {
            const months = formData.cantidadCuotas || 12;
            const effectiveRate = loanTypeUsesInitialInterest(formData.loanType)
              ? formData.interestRate * (months / 12)
              : 0;
            const totalInt = Math.round(formData.principal * (effectiveRate / 100));
            const totalTot = formData.principal + totalInt;
            const monthlyQuota = Math.round(totalTot / months);

            return (
              <div className="bg-white p-3.5 rounded-lg border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Cuota Mensual Estimada:</span>
                  <strong className="text-sm font-bold text-blue-700">
                    {formatCurrencyAmount(monthlyQuota, formData.currency)} / mes
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Plazo Seleccionado:</span>
                  <strong className="text-sm font-bold text-slate-800">
                    {months} cuotas ({formData.planFrecuencia}) — Int. proporcional {effectiveRate.toFixed(1)}%
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Monto Total a Cobrar:</span>
                  <strong className="text-sm font-bold text-emerald-700">
                    {formatCurrencyAmount(totalTot, formData.currency)}
                  </strong>
                </div>
              </div>
            );
          })()}
        </div>

        {['EMPENO', 'PRESTACION_SERVICIOS', 'ALQUILER_INMUEBLE'].includes(formData.loanType) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Descripcion <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.description}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, description: event.target.value }))
              }
              rows={3}
              placeholder={
                formData.loanType === 'EMPENO'
                  ? 'Ej. celular Samsung, notebook HP, cadena de plata...'
                  : formData.loanType === 'PRESTACION_SERVICIOS'
                    ? 'Describe el servicio o trabajo realizado'
                    : 'Describe el alquiler o inmueble'
              }
              className={`w-full border rounded-md p-3 focus:ring-blue-500 focus:border-blue-500 ${
                errors.description ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.description && (
              <p className="text-red-500 text-xs mt-1">{errors.description}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded border border-slate-200">
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={formData.hasPagare}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, hasPagare: event.target.checked }))
              }
              className="h-4 w-4"
            />
            Tiene pagare
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={formData.isLocatable}
              onChange={(event) =>
                setFormData((previous) => ({ ...previous, isLocatable: event.target.checked }))
              }
              className="h-4 w-4"
            />
            Cliente ubicable
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded border border-gray-200">
          <div>
            <p className="text-xs text-gray-600">Monto Principal</p>
            <p className="font-bold text-lg text-gray-900">{formatCurrencyAmount(formData.principal, formData.currency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Interes ({formData.interestRate}%)</p>
            <p className="font-bold text-lg text-blue-600">{formatCurrencyAmount(totalInterest, formData.currency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Total a pagar</p>
            <p className="font-bold text-lg text-green-600">{formatCurrencyAmount(totalAmount, formData.currency)}</p>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => navigate('/creditos')}
            className="bg-gray-300 text-gray-800 px-6 py-2 rounded-md hover:bg-gray-400 font-medium"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            {loading
              ? 'Procesando...'
              : userData?.role === 'ADMIN'
                ? 'Otorgar Credito'
                : 'Enviar a Aprobacion'}
          </button>
        </div>
      </form>

      {showPagareModal && selectedClient && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 border border-slate-200">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-xl mb-3">
                📋
              </div>
              <h3 className="text-xl font-bold text-slate-900">Asignar Pagare a Tomo</h3>
              <p className="text-xs text-slate-500 mt-1">
                El credito fue registrado. Selecciona en que tomo de pagares se archivara este documento.
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-200 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Cliente:</span>
                <span className="font-semibold text-slate-900">{selectedClient.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Cedula:</span>
                <span className="font-semibold text-slate-900">{selectedClient.documentId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Monto:</span>
                <span className="font-bold text-blue-700">{formatCurrencyAmount(formData.principal, formData.currency)}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                ¿En que Tomo ira este Pagare? <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2.5 mb-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((tomoNum) => (
                  <button
                    key={tomoNum}
                    type="button"
                    onClick={() => setSelectedTomoInput(tomoNum)}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                      selectedTomoInput === tomoNum
                        ? 'bg-blue-600 text-white border-blue-600 shadow'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Tomo {tomoNum}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Otro tomo:</span>
                <input
                  type="text"
                  value={selectedTomoInput}
                  onChange={(e) => setSelectedTomoInput(e.target.value)}
                  placeholder="Ej. 11"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                disabled={savingPagareModal}
                onClick={handleConfirmPagareModal}
                className="w-full bg-emerald-600 text-white py-3 rounded-xl hover:bg-emerald-700 font-bold transition text-sm shadow-lg disabled:opacity-50"
              >
                {savingPagareModal ? 'Guardando Pagare...' : 'Guardar Pagare y Finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
