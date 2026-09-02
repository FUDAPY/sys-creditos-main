import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { useAuth } from '../../context/AuthContext';
import { COMPANY_ID, db } from '../../lib/firebase';
import { getLoanFinancialSnapshot } from '../../services/loanService';
import type { Client, Loan, Payment } from '../../types';

interface MovementItem {
  id: string;
  type: 'LOAN' | 'PAYMENT';
  date: number;
  title: string;
  detail: string;
  amount: number;
}

export default function ClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const { userData } = useAuth();
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userData && userData.role !== 'ADMIN') {
      navigate('/clientes', { replace: true });
    }
  }, [navigate, userData]);

  useEffect(() => {
    if (!clientId || !userData || userData.role !== 'ADMIN') {
      return;
    }

    let mounted = true;

    async function loadClientDetail() {
      setLoading(true);
      setError(null);

      try {
        const clientRef = doc(db, `companies/${COMPANY_ID}/clients/${clientId}`);
        const clientSnap = await getDoc(clientRef);

        if (!clientSnap.exists()) {
          throw new Error('El cliente no existe o fue eliminado.');
        }

        const [loansSnap, paymentsSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, `companies/${COMPANY_ID}/loans`),
              where('clientId', '==', clientId),
              orderBy('createdAt', 'desc')
            )
          ),
          getDocs(
            query(
              collection(db, `companies/${COMPANY_ID}/payments`),
              where('clientId', '==', clientId),
              orderBy('createdAt', 'desc')
            )
          ),
        ]);

        if (!mounted) {
          return;
        }

        setClient({ id: clientSnap.id, ...clientSnap.data() } as Client);
        setLoans(loansSnap.docs.map((item) => ({ id: item.id, ...item.data() }) as Loan));
        setPayments(
          paymentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }) as Payment)
        );
      } catch (loadError) {
        console.error(loadError);
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'No se pudo cargar la ficha del cliente.'
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadClientDetail();

    return () => {
      mounted = false;
    };
  }, [clientId, userData]);

  const movementTimeline = useMemo<MovementItem[]>(() => {
    const loanEvents = loans.map((loan) => {
      const movementDate = loan.grantedAt || loan.createdAt || Date.now();
      const loanCode = (loan.id ?? 'sin-id').slice(0, 8).toUpperCase();
      return {
        id: `loan-${loan.id ?? movementDate}`,
        type: 'LOAN' as const,
        date: movementDate,
        title: `Credito ${loanCode}`,
        detail: `${loan.collectorName} | ${loan.status}`,
        amount: loan.totalAmount,
      };
    });

    const paymentEvents = payments.map((payment) => {
      const paymentCode = (payment.id ?? 'sin-id').slice(0, 8).toUpperCase();
      return {
        id: `payment-${payment.id ?? payment.createdAt}`,
        type: 'PAYMENT' as const,
        date: payment.paidAt || payment.createdAt || Date.now(),
        title: `Abono ${paymentCode}`,
        detail: `${payment.collectorName} | Credito ${payment.loanId.slice(0, 8).toUpperCase()}`,
        amount: payment.amount,
      };
    });

    return [...loanEvents, ...paymentEvents].sort((a, b) => b.date - a.date);
  }, [loans, payments]);

  const summary = useMemo(() => {
    const totalPrincipalOutstanding = loans.reduce((accumulator, loan) => {
      if (loan.status === 'PAID') {
        return accumulator;
      }

      return accumulator + (getLoanFinancialSnapshot(loan).effectiveBalance || 0);
    }, 0);

    const totalInterestOutstanding = loans.reduce((accumulator, loan) => {
      if (loan.status === 'PAID') {
        return accumulator;
      }

      const snapshot = getLoanFinancialSnapshot(loan);
      return accumulator + (snapshot.accruedInterest || 0) + (snapshot.mora || 0);
    }, 0);

    const totalOutstanding = loans.reduce((accumulator, loan) => {
      if (loan.status === 'PAID') {
        return accumulator;
      }

      return accumulator + getLoanFinancialSnapshot(loan).totalDue;
    }, 0);

    const totalPaid = payments.reduce((accumulator, payment) => accumulator + payment.amount, 0);

    return {
      loansCount: loans.length,
      paymentsCount: payments.length,
      totalPrincipalOutstanding,
      totalInterestOutstanding,
      totalOutstanding,
      totalPaid,
    };
  }, [loans, payments]);

  const hasLocation =
    typeof client?.location?.latitude === 'number' &&
    typeof client?.location?.longitude === 'number';

  const mapUrl = hasLocation
    ? buildOpenStreetMapEmbedUrl(client.location.latitude, client.location.longitude)
    : null;

  const googleMapsUrl =
    client?.location?.googleMapsUrl ||
    (hasLocation
      ? `https://www.google.com/maps?q=${client.location.latitude},${client.location.longitude}`
      : null);

  if (!userData || userData.role !== 'ADMIN') {
    return null;
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Cargando ficha del cliente...</p>
        </div>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
        <h2 className="text-lg font-semibold">No se pudo abrir la ficha</h2>
        <p className="mt-2 text-sm">{error ?? 'El cliente no fue encontrado.'}</p>
        <div className="mt-4">
          <Link className="text-sm font-semibold text-rose-700 underline" to="/clientes">
            Volver a Gestion de Clientes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
            Ficha Administrativa
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">{client.fullName}</h1>
          <p className="mt-2 text-sm text-slate-600">
            C.I.: {client.documentId} | Cobrador asignado:{' '}
            <span className="font-semibold text-slate-800">
              {client.collectorName || 'Sin asignar'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            to="/clientes"
          >
            Volver al listado
          </Link>
          <Link
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            to="/creditos/nuevo"
            state={{ clientId: client.id }}
          >
            Otorgar credito
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <PanelCard>
          <p className="text-sm text-slate-500">Creditos registrados</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{summary.loansCount}</p>
        </PanelCard>
        <PanelCard>
          <p className="text-sm text-slate-500">Abonos registrados</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{summary.paymentsCount}</p>
        </PanelCard>
        <PanelCard>
          <p className="text-sm text-slate-500">Total ya abonado</p>
          <p className="mt-3 text-3xl font-semibold text-emerald-700">
            {formatCurrency(summary.totalPaid)}
          </p>
        </PanelCard>
        <PanelCard>
          <p className="text-sm text-slate-500">Capital total vigente</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">
            {formatCurrency(summary.totalPrincipalOutstanding)}
          </p>
        </PanelCard>
        <PanelCard>
          <p className="text-sm text-slate-500">Interes total vigente</p>
          <p className="mt-3 text-3xl font-semibold text-amber-700">
            {formatCurrency(summary.totalInterestOutstanding)}
          </p>
        </PanelCard>
        <PanelCard>
          <p className="text-sm text-slate-500">Saldo total vigente</p>
          <p className="mt-3 text-3xl font-semibold text-amber-700">
            {formatCurrency(summary.totalOutstanding)}
          </p>
        </PanelCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr,0.75fr]">
        <div className="space-y-6">
          <PanelCard>
            <h2 className="text-lg font-semibold text-slate-900">Datos del cliente</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <InfoRow label="Nombre completo" value={client.fullName} />
              <InfoRow label="C.I." value={client.documentId} />
              <InfoRow
                label="Fecha de nacimiento"
                value={client.birthDate || 'No registrada'}
              />
              <InfoRow label="Nacionalidad" value={client.nationality || 'No registrada'} />
              <InfoRow label="Telefono" value={client.phone || 'No registrado'} />
              <InfoRow label="Correo" value={client.email || 'No registrado'} />
              <InfoRow label="Direccion" value={client.address || 'No registrada'} />
              <InfoRow label="Ciudad" value={client.city || 'No registrada'} />
              <InfoRow label="Barrio" value={client.neighborhood || 'No registrado'} />
              <InfoRow label="Tipo de vivienda" value={client.housingType || 'No registrado'} />
            </div>
          </PanelCard>

          <PanelCard>
            <h2 className="text-lg font-semibold text-slate-900">Datos laborales</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <InfoRow label="Empresa" value={client.workplaceName || 'No registrada'} />
              <InfoRow
                label="Direccion laboral"
                value={client.workplaceAddress || 'No registrada'}
              />
              <InfoRow label="Ciudad laboral" value={client.workplaceCity || 'No registrada'} />
              <InfoRow
                label="Barrio laboral"
                value={client.workplaceNeighborhood || 'No registrado'}
              />
              <InfoRow
                label="Situacion laboral"
                value={client.employmentStatus || 'No registrada'}
              />
              <InfoRow label="Cargo" value={client.position || 'No registrado'} />
              <InfoRow label="Area" value={client.department || 'No registrada'} />
              <InfoRow label="Celular laboral" value={client.workPhone || 'No registrado'} />
            </div>
          </PanelCard>

          <PanelCard>
            <h2 className="text-lg font-semibold text-slate-900">Referencias personales</h2>
            {!client.references || client.references.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Este cliente no tiene referencias personales registradas.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {client.references.map((reference, index) => (
                  <div
                    key={`reference-${index}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Referencia {index + 1}
                    </p>
                    <div className="mt-3 space-y-3">
                      <InfoRow label="Nombre" value={reference.name || 'No registrado'} />
                      <InfoRow label="Relacion" value={reference.relationship || 'No registrada'} />
                      <InfoRow
                        label="Lugar de trabajo"
                        value={reference.workplace || 'No registrado'}
                      />
                      <InfoRow label="Telefono" value={reference.phone || 'No registrado'} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PanelCard>

          <PanelCard>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Ubicacion registrada</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Referencia geografica guardada en la ficha del cliente.
                </p>
              </div>
              {googleMapsUrl && (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 transition hover:bg-emerald-100"
                >
                  Abrir mapa
                </a>
              )}
            </div>

            {hasLocation && mapUrl ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <InfoRow
                    label="Latitud"
                    value={String(client.location.latitude)}
                  />
                  <InfoRow
                    label="Longitud"
                    value={String(client.location.longitude)}
                  />
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <iframe
                    title={`Mapa de ${client.fullName}`}
                    src={mapUrl}
                    className="h-[360px] w-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Este cliente no tiene una ubicacion registrada todavia.
              </p>
            )}
          </PanelCard>

          <PanelCard>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Movimientos del cliente
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Historial consolidado de creditos otorgados y abonos aplicados.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                {movementTimeline.length} registros
              </span>
            </div>

            {movementTimeline.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">
                Este cliente aun no registra movimientos financieros.
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {movementTimeline.map((movement) => (
                  <div
                    key={movement.id}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{movement.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{movement.detail}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                        {new Date(movement.date).toLocaleString('es-PY')}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        movement.type === 'PAYMENT' ? 'text-emerald-700' : 'text-slate-700'
                      }`}
                    >
                      {movement.type === 'PAYMENT' ? '+' : ''}
                      {formatCurrency(movement.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </PanelCard>

          <PanelCard>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Movimientos de credito
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Vista administrativa de cada credito registrado para este cliente.
                </p>
              </div>
            </div>

            {loans.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">
                Este cliente todavia no tiene creditos otorgados.
              </p>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                      <th className="px-3 py-3">Fecha</th>
                      <th className="px-3 py-3">Credito</th>
                      <th className="px-3 py-3">Cobrador</th>
                      <th className="px-3 py-3">Capital</th>
                      <th className="px-3 py-3">Interes</th>
                      <th className="px-3 py-3">Mora</th>
                      <th className="px-3 py-3">Total adeudado</th>
                      <th className="px-3 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loans.map((loan) => {
                      const snapshot = getLoanFinancialSnapshot(loan);

                      return (
                        <tr key={loan.id} className="text-slate-700">
                          <td className="px-3 py-3">
                            {new Date(loan.grantedAt || loan.createdAt).toLocaleDateString(
                              'es-PY'
                            )}
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-900">
                            {(loan.id ?? 'sin-id').slice(0, 8).toUpperCase()}
                          </td>
                          <td className="px-3 py-3">{loan.collectorName}</td>
                          <td className="px-3 py-3">{formatCurrency(loan.principal)}</td>
                          <td className="px-3 py-3">{formatCurrency(snapshot.accruedInterest || 0)}</td>
                          <td className="px-3 py-3">{formatCurrency(snapshot.mora || 0)}</td>
                          <td className="px-3 py-3">{formatCurrency(snapshot.totalDue)}</td>
                          <td className="px-3 py-3">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700">
                              {loan.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </PanelCard>

          <PanelCard>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Abonos registrados</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Todos los pagos aplicados al cliente, con trazabilidad completa.
                </p>
              </div>
            </div>

            {payments.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">
                Este cliente todavia no tiene abonos registrados.
              </p>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500">
                      <th className="px-3 py-3">Fecha</th>
                      <th className="px-3 py-3">Credito</th>
                      <th className="px-3 py-3">Cobrador</th>
                      <th className="px-3 py-3">Abono</th>
                      <th className="px-3 py-3">Interes + mora</th>
                      <th className="px-3 py-3">Saldo anterior</th>
                      <th className="px-3 py-3">Saldo nuevo</th>
                      <th className="px-3 py-3">Ticket</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((payment) => (
                      <tr key={payment.id} className="text-slate-700">
                        <td className="px-3 py-3">
                          {new Date(payment.paidAt || payment.createdAt).toLocaleString('es-PY')}
                        </td>
                        <td className="px-3 py-3 font-semibold text-slate-900">
                          {payment.loanId.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="px-3 py-3">{payment.collectorName}</td>
                        <td className="px-3 py-3 font-semibold text-emerald-700">
                          {formatCurrency(payment.amount)}
                        </td>
                        <td className="px-3 py-3">
                          {formatCurrency((payment.interestApplied || 0) + (payment.arrearsApplied || 0))}
                        </td>
                        <td className="px-3 py-3">
                          {formatCurrency(payment.previousBalance || 0)}
                        </td>
                        <td className="px-3 py-3">{formatCurrency(payment.newBalance || 0)}</td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => navigate(`/imprimir/ticket/${payment.id}`)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                          >
                            Reimprimir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PanelCard>
        </div>

        <div className="space-y-6">
          <PanelCard>
            <h2 className="text-lg font-semibold text-slate-900">Resumen financiero</h2>
            <div className="mt-4 space-y-4">
              <SummaryRow label="Creditos otorgados" value={String(summary.loansCount)} />
              <SummaryRow label="Abonos registrados" value={String(summary.paymentsCount)} />
              <SummaryRow label="Total ya abonado" value={formatCurrency(summary.totalPaid)} />
              <SummaryRow
                label="Capital total vigente"
                value={formatCurrency(summary.totalPrincipalOutstanding)}
              />
              <SummaryRow
                label="Interes total vigente"
                value={formatCurrency(summary.totalInterestOutstanding)}
              />
              <SummaryRow
                label="Saldo total vigente"
                value={formatCurrency(summary.totalOutstanding)}
              />
            </div>
          </PanelCard>

          <PanelCard>
            <h2 className="text-lg font-semibold text-slate-900">Creditos del cliente</h2>
            {loans.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Sin creditos registrados para este cliente.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {loans.map((loan) => (
                  <div
                    key={loan.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Credito {(loan.id ?? 'sin-id').slice(0, 8).toUpperCase()}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {loan.collectorName} | {loan.status}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-slate-800">
                        {formatCurrency(getLoanFinancialSnapshot(loan).totalDue)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                      <span>
                        {new Date(loan.grantedAt || loan.createdAt).toLocaleDateString('es-PY')}
                      </span>
                      <span>Capital pendiente {formatCurrency(loan.currentBalance)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </PanelCard>
        </div>
      </div>
    </div>
  );
}

function PanelCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rounded-lg border border-gray-200 bg-white p-6 shadow-sm ${className}`}>{children}</div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function formatCurrency(value: number) {
  return `Gs. ${value.toLocaleString('es-PY')}`;
}

function buildOpenStreetMapEmbedUrl(latitude: number, longitude: number) {
  const offset = 0.01;
  const left = longitude - offset;
  const right = longitude + offset;
  const top = latitude + offset;
  const bottom = latitude - offset;

  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}
