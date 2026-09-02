import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { COMPANY_ID, db } from '../../lib/firebase';
import { type Client, type Loan, type Payment, type User } from '../../types';
import { AppFooter } from '../layout/AppFooter';

type TicketData = {
  payment: Payment;
  loan: Loan;
  client: Client;
  collectorName: string;
};

export const ThermalTicketPrint: React.FC = () => {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const printedOnceRef = useRef(false);

  const [data, setData] = useState<TicketData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!paymentId) {
      setError('Falta el ID del pago');
      return;
    }

    const loadTicketData = async () => {
      try {
        const payDoc = await getDoc(doc(db, `companies/${COMPANY_ID}/payments`, paymentId));
        if (!payDoc.exists()) throw new Error('Pago no encontrado');

        const payment = { ...payDoc.data(), id: payDoc.id } as Payment;
        const [loanDoc, clientDoc, collectorDoc] = await Promise.all([
          getDoc(doc(db, `companies/${COMPANY_ID}/loans`, payment.loanId)),
          getDoc(doc(db, `companies/${COMPANY_ID}/clients`, payment.clientId)),
          payment.collectorId
            ? getDoc(doc(db, `companies/${COMPANY_ID}/users`, payment.collectorId))
            : Promise.resolve(null),
        ]);

        if (!loanDoc.exists()) throw new Error('Credito no encontrado');
        if (!clientDoc.exists()) throw new Error('Cliente no encontrado');

        const collector = collectorDoc?.exists() ? (collectorDoc.data() as User) : null;
        setData({
          payment,
          loan: { ...loanDoc.data(), id: loanDoc.id } as Loan,
          client: { ...clientDoc.data(), id: clientDoc.id } as Client,
          collectorName: collector?.name || payment.collectorName || 'Sin cobrador',
        });
      } catch (err: unknown) {
        console.error('Error al generar ticket:', err);
        setError(err instanceof Error ? err.message : 'Error al cargar el ticket');
      }
    };

    void loadTicketData();
  }, [paymentId]);

  useEffect(() => {
    if (!data || printedOnceRef.current) return;

    printedOnceRef.current = true;
    const printTimer = window.setTimeout(() => {
      window.print();
    }, 700);

    return () => window.clearTimeout(printTimer);
  }, [data]);

  const formatDate = (timestamp?: number) =>
    new Date(timestamp || Date.now()).toLocaleString('es-PY', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

  if (error) {
    return (
      <div className="p-8 text-center">
        <h2 className="mb-4 font-bold text-red-600">{error}</h2>
        <button
          type="button"
          onClick={() => navigate('/creditos')}
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          Volver
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="text-gray-600">Generando ticket...</p>
        </div>
      </div>
    );
  }

  const { payment, loan, client, collectorName } = data;
  const ticketCurrency = payment.currency || loan.currency || 'PYG';
  const ticketCurrencyLabel = ticketCurrency === 'USD' ? 'USD' : 'GS';
  const formatTicketAmount = (amount?: number) =>
    `${ticketCurrencyLabel} ${Math.round(amount || 0).toLocaleString('es-PY')}`;

  const renderSingleTicket = (copyLabel: string) => (
    <div className="mb-4 font-mono text-[11px] leading-tight text-black">
      <div className="mb-2 text-center font-bold">
        <div className="mb-1 flex justify-center">
          <img
            src="/logo.png"
            alt="Logo"
            style={{
              width: '45px',
              height: '45px',
              borderRadius: '50%',
              objectFit: 'cover',
            }}
          />
        </div>
        <h1 className="text-[10px] font-bold leading-tight">ESTUDIO JURIDICO</h1>
        <h1 className="text-[10px] font-bold leading-tight">LIN GROUP Y ASOCIADOS</h1>
        <p className="text-[8px] leading-tight">Galeria Jebai Center</p>
        <p className="text-[8px] leading-tight">2do Piso Torre A</p>
        <p className="mb-1 border-b border-dashed border-black pb-1 text-[8px] leading-tight">
          CIUDAD DEL ESTE, PARAGUAY
        </p>
        <p className="text-[10px] font-bold uppercase tracking-wider text-black">{copyLabel}</p>
        <p className="mb-1 border-b border-dashed border-black pb-1 text-[10px] font-bold">
          TICKET DE PAGO
        </p>
      </div>

      <div className="mb-2 border-b border-dashed border-black pb-1 text-[9px]">
        <p>Fecha: {formatDate(payment.paidAt || payment.createdAt)}</p>
        <p>Ticket Nro: {payment.id?.slice(-6).toUpperCase() || 'N/A'}</p>
        <p>Credito ID: {loan.id?.slice(-6).toUpperCase() || 'N/A'}</p>
        <p>Moneda: {ticketCurrencyLabel}</p>
      </div>

      <div className="mb-2 border-b border-dashed border-black pb-1 text-[10px]">
        <p className="font-bold">Cobrador:</p>
        <p>{collectorName}</p>
      </div>

      <div className="mb-2 border-b border-dashed border-black pb-1 text-[10px]">
        <p className="font-bold">Cliente:</p>
        <p>{client.fullName}</p>
        <p>C.I.: {client.documentId}</p>
      </div>

      <div className="mb-2 border-b border-dashed border-black pb-1 text-[9px]">
        <div className="flex justify-between gap-2">
          <span>Estado:</span>
          <span>{payment.approvalStatus === 'APPROVED' ? 'APROBADO' : 'PENDIENTE'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Saldo Anterior:</span>
          <span>{formatTicketAmount(payment.previousBalance)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Tipo:</span>
          <span>
            {payment.paymentType === 'CAPITAL'
              ? 'CAPITAL'
              : payment.paymentType === 'INTEREST'
                ? 'INTERES'
                : 'MIXTO'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Mora Aplicada:</span>
          <span>{formatTicketAmount(payment.arrearsApplied)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Interes Aplicado:</span>
          <span>{formatTicketAmount(payment.interestApplied)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Capital Aplicado:</span>
          <span>{formatTicketAmount(payment.principalApplied)}</span>
        </div>
        <div className="mt-1 flex justify-between gap-2 border-t border-black pt-1 text-[11px] font-bold">
          <span>MONTO PAGADO:</span>
          <span>{formatTicketAmount(payment.amount)}</span>
        </div>
      </div>

      <div className="mb-3 text-[10px]">
        <div className="flex justify-between gap-2 border-t border-black pt-1 text-[11px] font-bold">
          <span>NUEVO SALDO:</span>
          <span>{formatTicketAmount(payment.newBalance)}</span>
        </div>
        {(payment.newBalance || 0) <= 0 && (
          <p className="mt-2 border border-black p-1 text-center text-[9px] font-bold">
            CREDITO CANCELADO
          </p>
        )}
      </div>

      <div className="mt-2 border-t border-black pt-1 text-center text-[8px]">
        <p>Conserve este ticket como comprobante</p>
        <p>Gracias por su preferencia</p>
        <div className="mt-1">
          <AppFooter textClassName="text-[8px] text-black" linkClassName="underline" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-black print:min-h-0">
      <style>{`
        @page {
          size: 58mm auto;
          margin: 2mm;
        }

        @media print {
          html,
          body,
          #root {
            width: 58mm;
            min-height: 0;
            background: white !important;
          }

          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .ticket-copy {
            break-after: page;
            page-break-after: always;
          }

          .ticket-copy:last-child {
            break-after: auto;
            page-break-after: auto;
          }
        }
      `}</style>

      <div className="mx-auto max-w-[58mm] bg-white p-2 text-black">
        <div className="print:hidden mb-3 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded bg-gray-800 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-900"
          >
            Imprimir ticket
          </button>
          <button
            type="button"
            onClick={() => navigate('/creditos')}
            className="rounded bg-gray-500 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-600"
          >
            Volver
          </button>
        </div>

        {/* COPIA CLIENTE */}
        <div className="ticket-copy">{renderSingleTicket('COPIA CLIENTE')}</div>

        {/* LINEA DE CORTE ENTRE TICKETS */}
        <div className="print:hidden my-4 border-b-2 border-dashed border-black text-center text-[8px] font-bold tracking-widest text-black">
          - - - CORTE AQUI - - -
        </div>

        {/* COPIA ADMINISTRACION */}
        <div className="ticket-copy">{renderSingleTicket('COPIA ADMINISTRACION')}</div>
      </div>
    </div>
  );
};
