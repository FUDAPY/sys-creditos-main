import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import type { Client, Loan } from '../types';
import { getLoanFinancialSnapshot } from '../services/loanService';
import { registerPayment } from '../services/paymentService';
import { syncFinancialPayment } from '../services/userService';

interface PagoRapidoProps {
  onClose: () => void;
}

interface SearchClient extends Client {
  uid: string;
  loans: Array<Loan & { id: string }>;
}

export default function PagoRapido({ onClose }: PagoRapidoProps) {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [clientOptions, setClientOptions] = useState<SearchClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<SearchClient | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<(Loan & { id: string }) | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!userData) return;
    void loadPortfolio();
  }, [userData]);

  const loadPortfolio = async () => {
    if (!userData) return;

    try {
      setInitializing(true);
      const loansRef = collection(db, `companies/${COMPANY_ID}/loans`);
      const loansQuery = query(loansRef, where('status', '==', 'ACTIVE'));

      const loansSnap = await getDocs(loansQuery);
      const loans = loansSnap.docs
        .map((item) => ({ id: item.id, ...item.data() }) as Loan & { id: string })
        .filter((loan) => (loan.approvalStatus || 'APPROVED') === 'APPROVED')
        .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      const clientIds = [...new Set(loans.map((loan) => loan.clientId))];
      const clientsMap = new Map<string, SearchClient>();

      for (let index = 0; index < clientIds.length; index += 10) {
        const batch = clientIds.slice(index, index + 10);
        const clientsSnap = await getDocs(
          query(collection(db, `companies/${COMPANY_ID}/clients`), where('__name__', 'in', batch))
        );

        clientsSnap.docs.forEach((clientDoc) => {
          clientsMap.set(clientDoc.id, {
            uid: clientDoc.id,
            ...(clientDoc.data() as Client),
            loans: [],
          });
        });
      }

      loans.forEach((loan) => {
        const client = clientsMap.get(loan.clientId);
        if (client) {
          client.loans.push(loan);
        }
      });

      setClientOptions(
        Array.from(clientsMap.values()).sort((left, right) =>
          left.fullName.localeCompare(right.fullName, 'es')
        )
      );
    } catch (err) {
      console.error('Error cargando pago rapido:', err);
      setError('No se pudo cargar la cartera para pago rapido.');
    } finally {
      setInitializing(false);
    }
  };

  const filteredOptions = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (term.length < 2) return [];

    return clientOptions.filter((client) => {
      return (
        client.fullName.toLowerCase().includes(term) ||
        client.documentId.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term)
      );
    });
  }, [clientOptions, searchQuery]);

  const selectedSnapshot = useMemo(
    () => (selectedLoan ? getLoanFinancialSnapshot(selectedLoan) : null),
    [selectedLoan]
  );
  const selectedPendingAmount = selectedLoan?.totalPendienteAprobacion || 0;
  const selectedAvailableToCollect = selectedSnapshot
    ? Math.max(0, selectedSnapshot.totalDue - selectedPendingAmount)
    : 0;

  const handleSelectClient = (client: SearchClient) => {
    setSelectedClient(client);
    setSelectedLoan(null);
    setPaymentAmount('');
    setSearchQuery(client.fullName);
    setError(null);
  };

  const handlePayment = async () => {
    if (!selectedLoan || !paymentAmount) {
      setError('Selecciona un credito y un monto.');
      return;
    }

    const amount = Number(paymentAmount);
    if (!selectedSnapshot || amount <= 0 || amount > selectedAvailableToCollect) {
      setError('Monto invalido para este credito.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payment = await registerPayment(
        selectedLoan.id,
        amount,
        userData!.uid,
        userData!.name,
        userData!.role
      );
      if (userData?.role === 'ADMIN') {
        await syncFinancialPayment(payment.id!);
      }
      setSuccess(true);
      setPaymentAmount('');
      await loadPortfolio();
      setTimeout(() => {
        onClose();
        navigate(`/imprimir/ticket/${payment.id}`);
      }, 400);
    } catch (err) {
      console.error('Error registrando pago rapido:', err);
      setError('Error al registrar el pago.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-500 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Pago Rapido</h2>
          <button onClick={onClose} className="text-white hover:bg-white/20 rounded-lg p-1 transition">
            x
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
              Pago registrado exitosamente.
            </div>
          )}

          {initializing ? (
            <div className="text-center py-10">
              <div className="inline-block animate-spin w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full"></div>
              <p className="text-sm text-gray-500 mt-3">Cargando cartera de pago rapido...</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Buscar cliente
                </label>
                <input
                  type="text"
                  placeholder="Escribe nombre, C.I. o telefono..."
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSelectedClient(null);
                    setSelectedLoan(null);
                    setPaymentAmount('');
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {!selectedClient && searchQuery.trim().length >= 2 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {filteredOptions.length > 0 ? (
                    filteredOptions.map((client) => (
                      <button
                        key={client.uid}
                        onClick={() => handleSelectClient(client)}
                        className="w-full px-4 py-3 text-left border-b last:border-b-0 hover:bg-blue-50 transition"
                      >
                        <div className="font-medium text-gray-900">{client.fullName}</div>
                        <div className="text-xs text-gray-500">
                          CI: {client.documentId} | {client.loans.length} credito(s) activo(s)
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-6 text-sm text-gray-500 text-center">
                      No se encontraron clientes con creditos activos.
                    </div>
                  )}
                </div>
              )}

              {selectedClient && !selectedLoan && (
                <>
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <p className="text-sm font-semibold text-gray-900">{selectedClient.fullName}</p>
                    <p className="text-xs text-gray-600 mt-1">CI: {selectedClient.documentId}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Selecciona un credito para abonar
                    </label>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {selectedClient.loans.map((loan) => {
                        const snapshot = getLoanFinancialSnapshot(loan);
                        const pendingAmount = loan.totalPendienteAprobacion || 0;
                        const provisionalTotal = Math.max(0, snapshot.totalDue - pendingAmount);
                        return (
                          <button
                            key={loan.id}
                            onClick={() => setSelectedLoan(loan)}
                            className="w-full p-3 text-left border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition"
                          >
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-900">{loan.loanType || 'PRESTAMO'}</span>
                              <span className="text-sm font-semibold text-green-600">{loan.status}</span>
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              Total adeudado: Gs. {snapshot.totalDue.toLocaleString('es-PY')}
                            </div>
                            {pendingAmount > 0 && (
                              <div className="text-xs text-amber-700 mt-1">
                                Pendiente de aprobacion: Gs. {pendingAmount.toLocaleString('es-PY')} | Provisorio: Gs. {provisionalTotal.toLocaleString('es-PY')}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedClient(null);
                      setSearchQuery('');
                    }}
                    className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
                  >
                    Cambiar cliente
                  </button>
                </>
              )}

              {selectedClient && selectedLoan && selectedSnapshot && (
                <>
                  <div className="bg-blue-50 p-3 rounded-lg text-sm space-y-1">
                    <p>
                      <span className="font-semibold">Cliente:</span> {selectedClient.fullName}
                    </p>
                    <p>
                      <span className="font-semibold">Cobrador:</span> {selectedLoan.collectorName}
                    </p>
                    <p>
                      <span className="font-semibold">Total adeudado:</span> Gs. {selectedSnapshot.totalDue.toLocaleString('es-PY')}
                    </p>
                    {selectedPendingAmount > 0 && (
                      <>
                        <p className="text-amber-700">
                          <span className="font-semibold">Pendiente de aprobacion:</span> Gs. {selectedPendingAmount.toLocaleString('es-PY')}
                        </p>
                        {selectedAvailableToCollect <= 0 && (
                          <p className="text-amber-700">
                            Credito cubierto, pendiente de aprobacion administrativa.
                          </p>
                        )}
                      </>
                    )}
                    {selectedSnapshot.refinancingAmount > 0 && (
                      <p className="text-orange-700">
                        Refinanciamiento pendiente: Gs. {selectedSnapshot.refinancingAmount.toLocaleString('es-PY')}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Monto a abonar
                    </label>
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      max={selectedAvailableToCollect}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        setSelectedLoan(null);
                        setPaymentAmount('');
                      }}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
                    >
                      Atras
                    </button>
                    <button
                      onClick={handlePayment}
                      disabled={loading || selectedAvailableToCollect <= 0}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition font-medium"
                    >
                      {loading ? 'Procesando...' : 'Abonar'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
