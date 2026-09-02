import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, COMPANY_ID } from '../../lib/firebase';
import { type Client, type Loan } from '../../types';
import { AppFooter } from '../layout/AppFooter';

export const CreditApplicationPrint: React.FC = () => {
  const { loanId } = useParams<{ loanId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<{ client: Client; loan: Loan } | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!loanId) {
      setError("Falta el ID del crédito");
      return;
    }
    loadApplicationData();
  }, [loanId]);

  const loadApplicationData = async () => {
    try {
      if (!loanId) return;

      const loanDoc = await getDoc(doc(db, `companies/${COMPANY_ID}/loans`, loanId));
      if (!loanDoc.exists()) throw new Error("Crédito no encontrado");

      const loan = { ...loanDoc.data(), id: loanDoc.id } as Loan;

      const clientDoc = await getDoc(doc(db, `companies/${COMPANY_ID}/clients`, loan.clientId));
      if (!clientDoc.exists()) throw new Error("Cliente no encontrado");

      const client = clientDoc.data() as Client;

      setData({ client, loan });

      // Lanzar diálogo de impresión al cargar la vista
      setTimeout(() => {
        window.print();
      }, 500);
    } catch (err: any) {
      console.error("Error al cargar solicitud:", err);
      setError(err.message || "Error al cargar los datos");
    }
  };

  const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('es-PY');

  if (error) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-red-600 font-bold mb-4">❌ {error}</h2>
        <button
          onClick={() => navigate('/creditos')}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Volver
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando solicitud...</p>
        </div>
      </div>
    );
  }

  const { client, loan } = data;

  return (
    <div className="bg-white text-black p-8 max-w-[210mm] min-h-[297mm] mx-auto text-sm font-sans">
      
      {/* Botón visible solo en pantalla, se oculta al imprimir */}
      <div className="print:hidden mb-4 flex justify-between">
        <button 
          onClick={() => window.print()} 
          className="bg-gray-800 text-white px-4 py-2 rounded"
        >
          🖨️ Imprimir Solicitud
        </button>
        <button 
          onClick={() => navigate('/creditos')} 
          className="bg-gray-500 text-white px-4 py-2 rounded"
        >
          ← Volver
        </button>
      </div>

      {/* Cabecera */}
      <div className="text-center border-b-2 border-black pb-4 mb-6">
        <h1 className="text-2xl font-bold uppercase">LIN GROUP S.A.</h1>
        <h2 className="text-xl font-semibold mt-1">Solicitud de Crédito</h2>
      </div>

      {/* Datos del Crédito */}
      <div className="mb-6 grid grid-cols-2 gap-4 border border-gray-300 p-4">
        <div><span className="font-bold">Monto Solicitado:</span> Gs. {loan.principal.toLocaleString()}</div>
        <div><span className="font-bold">Interés:</span> {loan.interestRate}%</div>
        <div><span className="font-bold">Fecha Otorgamiento:</span> {formatDate(loan.grantedAt)}</div>
        <div><span className="font-bold">Fecha Vencimiento:</span> {formatDate(loan.expiresAt)}</div>
      </div>

      {/* Datos Personales */}
      <div className="mb-6">
        <h3 className="font-bold bg-gray-100 p-1 mb-2">1. DATOS PERSONALES DEL TITULAR</h3>
        <div className="grid grid-cols-2 gap-2">
          <p><span className="font-bold">Nombre Completo:</span> {client.fullName}</p>
          <p><span className="font-bold">C.I.:</span> {client.documentId}</p>
          <p><span className="font-bold">Teléfono:</span> {client.phone}</p>
          <p><span className="font-bold">Email:</span> {client.email || 'N/A'}</p>
          <p><span className="font-bold">Dirección:</span> {client.address}, {client.city}</p>
          <p><span className="font-bold">Barrio:</span> {client.neighborhood || 'N/A'}</p>
        </div>
      </div>

      {/* Datos Laborales */}
      <div className="mb-6">
        <h3 className="font-bold bg-gray-100 p-1 mb-2">2. DATOS LABORALES</h3>
        <div className="grid grid-cols-2 gap-2">
          <p><span className="font-bold">Empresa:</span> {client.workplaceName}</p>
          <p><span className="font-bold">Cargo:</span> {client.position}</p>
          <p><span className="font-bold">Antigüedad:</span> {client.seniority}</p>
          <p><span className="font-bold">Teléfono Laboral:</span> {client.workPhone}</p>
          <p><span className="font-bold">Situación:</span> {client.employmentStatus}</p>
          <p><span className="font-bold">Vivienda:</span> {client.housingType}</p>
        </div>
      </div>

      {/* Referencias */}
      <div className="mb-6">
        <h3 className="font-bold bg-gray-100 p-1 mb-2">3. REFERENCIAS PERSONALES</h3>
        {client.references?.map((ref: any, idx: number) => (
          <div key={idx} className="mb-2 p-2 border border-gray-200">
            <p><span className="font-bold">Referencia {idx + 1}:</span> {ref.name}</p>
            <p><span className="font-bold">Relación:</span> {ref.relationship} | <span className="font-bold">Teléfono:</span> {ref.phone}</p>
            <p><span className="font-bold">Lugar de Trabajo:</span> {ref.workplace}</p>
          </div>
        ))}
      </div>

      {/* Firmas (Forzamos un salto visual hacia el final de la hoja) */}
      <div className="mt-32 grid grid-cols-3 gap-8 text-center">
        <div>
          <div className="border-t border-black pt-2">Firma del Titular</div>
          <div className="text-xs mt-1">Aclaración:</div>
          <div className="text-xs">C.I.:</div>
        </div>
        <div>
          <div className="border-t border-black pt-2">Firma del Cónyuge</div>
          <div className="text-xs mt-1">Aclaración:</div>
          <div className="text-xs">C.I.:</div>
        </div>
        <div>
          <div className="border-t border-black pt-2">Firma del Garante</div>
          <div className="text-xs mt-1">Aclaración:</div>
          <div className="text-xs">C.I.:</div>
        </div>
      </div>

      {/* Pie de página legal */}
      <div className="mt-12 text-xs text-justify text-gray-600">
        <p>Declaro bajo fe de juramento que los datos consignados en esta solicitud son fieles y exactos. Autorizo a LIN GROUP S.A. a verificar la información proporcionada y a consultar mi historial crediticio en las bases de datos de riesgo pertinentes conforme a la ley vigente.</p>
        <div className="mt-4 text-center">
          <AppFooter textClassName="text-[11px] text-gray-600" linkClassName="text-blue-600 hover:underline" />
        </div>
      </div>
    </div>
  );
};
