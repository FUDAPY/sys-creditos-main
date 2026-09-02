import { useRef } from 'react';
import type { Client } from '../../types';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface ClientFormPrintProps {
  client: Client;
  companyName?: string;
  companyLogo?: string;
  onClose: () => void;
}

export default function ClientFormPrint({
  client,
  companyLogo = '/logo.png',
  onClose,
}: ClientFormPrintProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;

    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        allowTaint: true,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const padding = 10; // márgenes
      const contentWidth = pageWidth - 2 * padding;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;

      let yPosition = 0;
      let pageCount = 1;

      // Primera página
      pdf.addImage(imgData, 'PNG', padding, padding, contentWidth, imgHeight);

      // Si necesita múltiples páginas
      yPosition = imgHeight + padding;
      const pageContentHeight = pageHeight - 2 * padding;

      while (yPosition > pageContentHeight) {
        pageCount++;
        pdf.addPage();
        yPosition -= pageContentHeight;
        pdf.addImage(
          imgData,
          'PNG',
          padding,
          padding - yPosition,
          contentWidth,
          imgHeight
        );
      }

      pdf.save(`Formulario-Cliente-${client.documentId}.pdf`);
    } catch (error) {
      console.error('Error al generar PDF:', error);
      alert('Error al generar el PDF');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 overflow-y-auto z-50 print:bg-white print:static">
      <div className="mx-auto bg-white print:bg-white">
        {/* Barra de control - oculta al imprimir */}
        <div className="print:hidden sticky top-0 bg-white border-b border-gray-300 px-6 py-4 flex justify-between items-center shadow-md">
          <h2 className="text-xl font-bold text-gray-800">Formulario de Cliente - Listo para Descargar</h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              🖨️ Imprimir
            </button>
            <button
              onClick={handleDownloadPDF}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              📥 Descargar PDF
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>

        {/* Contenido Imprimible - Diseño A4 con márgenes 10mm */}
        <div 
          ref={printRef} 
          className="w-full mx-auto bg-white text-gray-800"
          style={{ 
            width: '210mm',
            height: '297mm',
            padding: '10mm',
            margin: '20px auto',
            boxSizing: 'border-box',
            fontSize: '10pt',
            fontFamily: 'Arial, sans-serif',
            lineHeight: '1.3',
            color: '#333'
          }}
        >
          {/* ENCABEZADO */}
          <div style={{ borderBottom: '2px solid #003d82', paddingBottom: '8mm', marginBottom: '6mm', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8mm', marginBottom: '4mm' }}>
              <img
                src={companyLogo}
                alt="Logo"
                style={{
                  width: '25mm',
                  height: '25mm',
                  borderRadius: '50%',
                  border: '2px solid #003d82',
                  objectFit: 'cover'
                }}
              />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '13pt', fontWeight: 'bold', color: '#003d82', margin: '0' }}>
                  ESTUDIO JURIDICO LIN GROUP
                </div>
                <div style={{ fontSize: '9pt', color: '#666', margin: '1mm 0' }}>
                  GALERIA JEBAI CENTER - TORRE A 2DO PISO
                </div>
                <div style={{ fontSize: '9pt', color: '#666', margin: '0' }}>
                  Ciudad del Este, Paraguay | Tel: 0982 210 777
                </div>
              </div>
            </div>
            <div style={{ fontSize: '11pt', fontWeight: 'bold', color: '#003d82', marginTop: '3mm' }}>
              FORMULARIO DE REGISTRO - CLIENTE
            </div>
            <div style={{ fontSize: '8pt', color: '#999', marginTop: '2mm' }}>
              Doc. {client.documentId} | {new Date().toLocaleDateString('es-ES')}
            </div>
          </div>

          {/* SECCIÓN 1: DATOS PERSONALES */}
          <div style={{ marginBottom: '5mm' }}>
            <div style={{ 
              fontSize: '10pt', 
              fontWeight: 'bold', 
              backgroundColor: '#e8f0f7',
              padding: '2mm 3mm',
              marginBottom: '2mm',
              borderLeft: '3px solid #003d82'
            }}>
              1. DATOS PERSONALES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm', fontSize: '9pt' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>NOMBRE</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm', marginBottom: '2mm' }}>
                  {client.fullName}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>C.I. / RUC</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm', marginBottom: '2mm' }}>
                  {client.documentId}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>TELÉFONO</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>{client.phone}</div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>EMAIL</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>{client.email || '-'}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>DOMICILIO</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>
                  {client.address}, {client.city}
                </div>
              </div>
            </div>
          </div>

          {/* SECCIÓN 2: DATOS LABORALES */}
          <div style={{ marginBottom: '5mm' }}>
            <div style={{ 
              fontSize: '10pt', 
              fontWeight: 'bold', 
              backgroundColor: '#e8f0f7',
              padding: '2mm 3mm',
              marginBottom: '2mm',
              borderLeft: '3px solid #003d82'
            }}>
              2. DATOS LABORALES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm', fontSize: '9pt' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>EMPRESA</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>{client.workplaceName || '-'}</div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>CARGO</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>{client.position || '-'}</div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>ANTIGÜEDAD</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>{client.seniority || '-'}</div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '8pt' }}>SITUACIÓN LABORAL</div>
                <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '1mm' }}>{client.employmentStatus || '-'}</div>
              </div>
            </div>
          </div>

          {/* SECCIÓN 3: REFERENCIAS PERSONALES */}
          <div style={{ marginBottom: '5mm' }}>
            <div style={{ 
              fontSize: '10pt', 
              fontWeight: 'bold', 
              backgroundColor: '#e8f0f7',
              padding: '2mm 3mm',
              marginBottom: '2mm',
              borderLeft: '3px solid #003d82'
            }}>
              3. REFERENCIAS PERSONALES
            </div>
            {client.references && client.references.length > 0 ? (
              <div style={{ fontSize: '8pt' }}>
                {client.references.map((ref, idx) => (
                  <div key={idx} style={{ marginBottom: '2mm', paddingBottom: '2mm', borderBottom: '1px dotted #ddd' }}>
                    <div style={{ fontWeight: 'bold', color: '#003d82' }}>Ref. {idx + 1}: {ref.name}</div>
                    <div>Tel: {ref.phone} | {ref.relationship || ''} | {ref.workplace || ''}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '9pt', color: '#999' }}>Sin referencias registradas</div>
            )}
          </div>

          {/* SECCIÓN 4: UBICACIÓN GPS */}
          {client.location && (client.location.latitude || client.location.longitude) && (
            <div style={{ marginBottom: '5mm', padding: '3mm', backgroundColor: '#f0f8ff', border: '1px solid #003d82' }}>
              <div style={{ fontWeight: 'bold', color: '#003d82', fontSize: '9pt', marginBottom: '2mm' }}>
                📍 UBICACIÓN GPS
              </div>
              <div style={{ fontSize: '8pt', fontFamily: 'monospace' }}>
                Latitud: {client.location.latitude?.toFixed(6)}<br />
                Longitud: {client.location.longitude?.toFixed(6)}
              </div>
            </div>
          )}

          {/* FIRMA */}
          <div style={{ marginTop: '8mm', paddingTop: '5mm', borderTop: '2px solid #003d82' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15mm', fontSize: '8pt', textAlign: 'center' }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: '15mm' }}>FIRMA DEL CLIENTE</div>
                <div style={{ borderTop: '1px solid #000', paddingTop: '2mm', fontSize: '9pt', fontWeight: 'bold' }}>
                  {client.fullName}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: '15mm' }}>FIRMA DEL ASESOR</div>
                <div style={{ borderTop: '1px solid #000', paddingTop: '2mm' }}>
                  LIN GROUP Y ASOCIADOS
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
