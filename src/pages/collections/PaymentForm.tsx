import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { COMPANY_ID, db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Client, Loan, PaymentType } from '../../types';
import {
  calculateInterestAmount,
  getLoanFinancialSnapshot,
  loanTypeUsesInitialInterest,
} from '../../services/loanService';
import { registerPayment } from '../../services/paymentService';
import { syncFinancialPayment } from '../../services/userService';
import { formatCurrencyAmount, getCurrencySymbol } from '../../utils/currencyUtils';
import { formatDisplayDate, parseDateInputValue } from '../../utils/dateUtils';

export default function PaymentForm() {
  const { loanId } = useParams<{ loanId: string }>();
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loan, setLoan] = useState<Loan | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [amountPaid, setAmountPaid] = useState<number | ''>('');
  const [paymentType, setPaymentType] = useState<PaymentType>('MIXED');
  const [paymentDate, setPaymentDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loanId) {
      setLoading(false);
      return;
    }

    void loadData();
  }, [loanId]);

  const loadData = async () => {
    try {
      if (!loanId) throw new Error('Falta el ID del credito');

      const loanDoc = await getDoc(doc(db, `companies/${COMPANY_ID}/loans`, loanId));
      if (!loanDoc.exists()) {
        throw new Error('Credito no encontrado');
      }

      const loanData = { ...loanDoc.data(), id: loanDoc.id } as Loan;
      setLoan(loanData);

      const clientDoc = await getDoc(doc(db, `companies/${COMPANY_ID}/clients`, loanData.clientId));
      if (clientDoc.exists()) {
        setClient(clientDoc.data() as Client);
      }
    } catch (error: any) {
      console.error('Error al cargar datos del credito:', error);
      setErrors({ general: error.message || 'Error al cargar los datos' });
    } finally {
      setLoading(false);
    }
  };

  const selectedPaidAt = useMemo(() => {
    const parsed = parseDateInputValue(paymentDate);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }, [paymentDate]);

  const financialSnapshot = useMemo(
    () => (loan ? getLoanFinancialSnapshot(loan, selectedPaidAt) : null),
    [loan, selectedPaidAt]
  );

  const paymentLimits = useMemo(() => {
    if (!loan || !financialSnapshot) {
      return {
        principalToPay: 0,
        interestBucketTotal: 0,
        paymentMax: 0,
        pendingApprovalAmount: 0,
        provisionalTotalDue: 0,
      };
    }

    const principalToPay = financialSnapshot.effectiveBalance || loan.currentBalance;
    const interestBucketTotal = (financialSnapshot.mora || 0) + (financialSnapshot.accruedInterest || 0);
    const rawPaymentMax =
      paymentType === 'CAPITAL'
        ? principalToPay
        : paymentType === 'INTEREST'
          ? interestBucketTotal
          : principalToPay + interestBucketTotal;
    const pendingApprovalAmount = loan.totalPendienteAprobacion || 0;
    const paymentMax = Math.max(0, rawPaymentMax - pendingApprovalAmount);

    return {
      principalToPay,
      interestBucketTotal,
      paymentMax,
      pendingApprovalAmount,
      provisionalTotalDue: Math.max(0, financialSnapshot.totalDue - pendingApprovalAmount),
    };
  }, [financialSnapshot, loan, paymentType]);

  useEffect(() => {
    const requestedType = searchParams.get('tipo');
    if (requestedType === 'CAPITAL' || requestedType === 'INTEREST' || requestedType === 'MIXED') {
      setPaymentType(requestedType);
    }

    const requestedAmount = Number(searchParams.get('monto') || '');
    if (!Number.isNaN(requestedAmount) && requestedAmount > 0) {
      setAmountPaid(requestedAmount);
    }
  }, [searchParams]);

  const validatePayment = (): boolean => {
    const newErrors: Record<string, string> = {};
    const currentCurrency = loan?.currency || 'PYG';

    if (!loan || !financialSnapshot) {
      newErrors.general = 'Credito no cargado';
    }

    if (!paymentDate || Number.isNaN(selectedPaidAt)) {
      newErrors.paymentDate = 'Selecciona una fecha valida';
    }

    if (!amountPaid || typeof amountPaid !== 'number') {
      newErrors.amount = 'Ingresa un monto valido';
    } else if (amountPaid <= 0) {
      newErrors.amount = 'El monto debe ser mayor a 0';
    } else if (amountPaid > paymentLimits.paymentMax) {
      newErrors.amount =
        paymentType === 'CAPITAL'
          ? `El monto no puede ser mayor a ${formatCurrencyAmount(paymentLimits.paymentMax, currentCurrency)} de capital pendiente`
          : paymentType === 'INTEREST'
            ? `El monto no puede ser mayor a ${formatCurrencyAmount(paymentLimits.paymentMax, currentCurrency)} de interes y mora`
            : `El monto no puede ser mayor a ${formatCurrencyAmount(paymentLimits.paymentMax, currentCurrency)} de deuda total`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!validatePayment()) return;
    if (!userData || !loanId || !loan) return;

    if (!window.confirm(`Confirmas el cobro de ${formatCurrencyAmount(amountPaid as number, loan.currency)}?`)) {
      return;
    }

    setProcessing(true);
    try {
      const paymentReceipt = await registerPayment(
        loanId,
        amountPaid as number,
        userData.uid,
        userData.name,
        userData.role,
        selectedPaidAt,
        paymentType
      );
      if (userData.role === 'ADMIN') {
        await syncFinancialPayment(paymentReceipt.id!);
      }
      if (paymentReceipt.approvalStatus === 'APPROVED') {
        alert('Pago registrado y aprobado con exito.');
      } else {
        alert('Recibo registrado. Puedes imprimir el ticket ahora. Queda pendiente de aprobacion del administrador.');
      }
      navigate(`/imprimir/ticket/${paymentReceipt.id}`);
    } catch (error: any) {
      console.error('Error al procesar pago:', error);
      setErrors({ general: error.message || 'Error al registrar el pago' });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando datos del credito...</p>
        </div>
      </div>
    );
  }

  if (errors.general || !loan || !client || !financialSnapshot) {
    return (
      <div className="max-w-lg mx-auto bg-red-50 p-6 rounded-lg border border-red-200">
        <h2 className="text-xl font-bold text-red-800 mb-4">Error</h2>
        <p className="text-red-700 mb-4">{errors.general || 'Credito o cliente no encontrado'}</p>
        <button
          onClick={() => navigate('/creditos')}
          className="bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700"
        >
          Volver a Creditos
        </button>
      </div>
    );
  }

  if (loan.status === 'PAID') {
    return (
      <div className="max-w-lg mx-auto bg-green-50 p-6 rounded-lg border border-green-200">
        <h2 className="text-xl font-bold text-green-800 mb-4">Credito Cancelado</h2>
        <p className="text-green-700 mb-4">Este credito ya esta completamente pagado.</p>
        <button
          onClick={() => navigate('/creditos')}
          className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
        >
          Volver a Creditos
        </button>
      </div>
    );
  }

  const cycleInterest = calculateInterestAmount(loan);
  const usesInterest = loanTypeUsesInitialInterest(loan.loanType);
  const moraToPay = financialSnapshot.mora || 0;
  const interestToPay = financialSnapshot.accruedInterest || 0;
  const principalToPay = paymentLimits.principalToPay;
  const interestBucketTotal = paymentLimits.interestBucketTotal;
  const previewAmount = typeof amountPaid === 'number' && amountPaid > 0 ? amountPaid : 0;
  const previewMoraApplied =
    paymentType === 'CAPITAL' ? 0 : Math.min(previewAmount, moraToPay);
  const previewAfterMora =
    paymentType === 'CAPITAL' ? previewAmount : Math.max(0, previewAmount - previewMoraApplied);
  const previewInterestApplied =
    paymentType === 'CAPITAL' ? 0 : Math.min(previewAfterMora, interestToPay);
  const previewAfterInterest =
    paymentType === 'INTEREST' ? 0 : Math.max(0, previewAfterMora - previewInterestApplied);
  const previewPrincipalApplied =
    paymentType === 'INTEREST'
      ? 0
      : Math.min(paymentType === 'CAPITAL' ? previewAmount : previewAfterInterest, principalToPay);

  return (
    <div className="max-w-lg mx-auto bg-white p-6 shadow rounded-lg border border-gray-200">
      <h2 className="text-2xl font-bold mb-6 border-b pb-2">Registrar Pago</h2>

      <div className="mb-6 bg-gray-50 p-4 rounded-md border border-gray-200 text-sm space-y-3">
        <div>
          <p className="text-gray-600">Cliente:</p>
          <p className="font-semibold text-gray-900">{client.fullName}</p>
          <p className="text-xs text-gray-500">C.I: {client.documentId}</p>
        </div>

        <div className="border-t border-gray-300 pt-3">
          <p className="text-gray-600">Saldo de capital vigente:</p>
          <p className="font-bold text-gray-900">{formatCurrencyAmount(principalToPay, loan.currency)}</p>
        </div>

        <div className="bg-amber-50 border border-amber-200 p-3 rounded">
          <p className="text-amber-700">
            {usesInterest ? `Interes por vencimiento (${loan.interestRate}%):` : 'Interes por vencimiento:'}
          </p>
          <p className="font-bold text-amber-800">{formatCurrencyAmount(cycleInterest, loan.currency)}</p>
          <p className="text-xs text-amber-700 mt-1">
            {usesInterest
              ? 'Cada nuevo vencimiento vuelve a cargar este interes si el capital sigue pendiente.'
              : 'Este tipo de credito no genera interes.'}
          </p>
        </div>

        <div className="bg-orange-50 border border-orange-200 p-3 rounded">
          <p className="text-orange-700">Interes pendiente acumulado:</p>
          <p className="font-bold text-orange-800">
            {formatCurrencyAmount(interestToPay, loan.currency)}
          </p>
          <p className="text-xs text-orange-700 mt-1">
            Vencimientos pendientes cargados: {financialSnapshot.cyclesToApply}
          </p>
        </div>

        <div className="bg-red-50 border border-red-200 p-3 rounded">
          <p className="text-red-600">Mora acumulada:</p>
          <p className="font-bold text-red-700">{formatCurrencyAmount(moraToPay, loan.currency)}</p>
          <p className="text-xs text-red-600 mt-1">
            Dias de atraso: {financialSnapshot.daysLate}. La mora crece por dia del mes hasta completar {formatCurrencyAmount(200000, loan.currency)}.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 p-3 rounded">
          <p className="text-blue-600">Total adeudado:</p>
          <p className="font-bold text-blue-900 text-lg">
            {formatCurrencyAmount(financialSnapshot.totalDue, loan.currency)}
          </p>
        </div>
        {paymentLimits.pendingApprovalAmount > 0 && (
          <div className="bg-amber-50 border border-amber-200 p-3 rounded">
            <p className="text-amber-700">Pendiente de aprobacion administrativa:</p>
            <p className="font-bold text-amber-800">
              {formatCurrencyAmount(paymentLimits.pendingApprovalAmount, loan.currency)}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Saldo provisorio: {formatCurrencyAmount(paymentLimits.provisionalTotalDue, loan.currency)}
            </p>
            {paymentLimits.provisionalTotalDue <= 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Credito cubierto, pendiente de aprobacion administrativa.
              </p>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tipo de cobro <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => {
                setPaymentType('CAPITAL');
                setAmountPaid('');
                if (errors.amount) setErrors({ ...errors, amount: '' });
              }}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                paymentType === 'CAPITAL'
                  ? 'border-blue-600 bg-blue-50 text-blue-900'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300'
              }`}
            >
              <p className="font-semibold">Capital</p>
              <p className="text-xs mt-1">Descuenta solo del capital pendiente.</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setPaymentType('INTEREST');
                setAmountPaid('');
                if (errors.amount) setErrors({ ...errors, amount: '' });
              }}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                paymentType === 'INTEREST'
                  ? 'border-orange-600 bg-orange-50 text-orange-900'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
              }`}
            >
              <p className="font-semibold">Interes</p>
              <p className="text-xs mt-1">Cobra mora e interes sin tocar el capital.</p>
            </button>
            <button
              type="button"
              onClick={() => {
                setPaymentType('MIXED');
                setAmountPaid('');
                if (errors.amount) setErrors({ ...errors, amount: '' });
              }}
              className={`rounded-lg border px-4 py-3 text-left transition ${
                paymentType === 'MIXED'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-300'
              }`}
            >
              <p className="font-semibold">Ambos</p>
              <p className="text-xs mt-1">Aplica a mora, interes y luego capital.</p>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha del cobro <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={paymentDate}
            onChange={(event) => {
              setPaymentDate(event.target.value);
              if (errors.paymentDate) setErrors({ ...errors, paymentDate: '' });
            }}
            className={`w-full border rounded-md p-3 focus:ring-blue-500 focus:border-blue-500 ${
              errors.paymentDate ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.paymentDate && <p className="text-red-500 text-xs mt-1">{errors.paymentDate}</p>}
          <p className="text-xs text-gray-500 mt-2">
            Puedes cargar cobros con fecha atrasada para migracion. La mora se calcula usando esta fecha.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Monto a pagar ({getCurrencySymbol(loan.currency)}) <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            required
            min="1"
            max={paymentLimits.paymentMax}
            value={amountPaid}
            onChange={(event) => {
              setAmountPaid(event.target.value ? Number(event.target.value) : '');
              if (errors.amount) setErrors({ ...errors, amount: '' });
            }}
            className={`w-full text-lg border rounded-md p-3 focus:ring-blue-500 focus:border-blue-500 ${
              errors.amount ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Ej. 50000"
          />
          {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
          <p className="text-xs text-gray-500 mt-2">
            {paymentType === 'CAPITAL'
              ? `Disponible para cobrar en capital: ${formatCurrencyAmount(principalToPay, loan.currency)}`
              : paymentType === 'INTEREST'
                ? `Disponible para cobrar en interes: ${formatCurrencyAmount(interestBucketTotal, loan.currency)}`
                : `Disponible para cobrar en total: ${formatCurrencyAmount(financialSnapshot.totalDue, loan.currency)}`}
          </p>

          {amountPaid && typeof amountPaid === 'number' && amountPaid > 0 && (
            <p className="text-xs text-blue-600 mt-2">
              Detalles del pago:
              <br />
              {paymentType === 'CAPITAL'
                ? `${formatCurrencyAmount(previewPrincipalApplied, loan.currency)} a capital`
                : paymentType === 'INTEREST'
                  ? `${formatCurrencyAmount(previewMoraApplied, loan.currency)} a mora + ${formatCurrencyAmount(previewInterestApplied, loan.currency)} a interes`
                  : `${formatCurrencyAmount(previewMoraApplied, loan.currency)} a mora + ${formatCurrencyAmount(previewInterestApplied, loan.currency)} a interes + ${formatCurrencyAmount(previewPrincipalApplied, loan.currency)} a capital`}
              <br />
              Fecha aplicada: {formatDisplayDate(selectedPaidAt)}
              <br />
              Nuevo saldo estimado: {formatCurrencyAmount(Math.max(0, financialSnapshot.totalDue - amountPaid), loan.currency)}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={processing || !amountPaid}
          className="w-full bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {processing ? 'Procesando transaccion...' : 'Registrar Pago e Imprimir'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          onClick={() => navigate('/creditos')}
          className="text-gray-600 hover:text-gray-800 text-sm"
        >
          Volver a Creditos
        </button>
      </div>
    </div>
  );
}
