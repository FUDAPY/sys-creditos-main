import React, { useState } from 'react';

interface PagareTomoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tomo: string) => void;
  clientName?: string;
  amount?: number;
}

export const PagareTomoModal: React.FC<PagareTomoModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  clientName,
  amount,
}) => {
  const [tomo, setTomo] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tomo.trim()) {
      setError('El campo N° de Tomo es obligatorio para generar el pagaré.');
      return;
    }
    setError('');
    onConfirm(tomo.trim());
    setTomo('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 text-white animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center pb-3 border-b border-slate-800">
          <h3 className="text-lg font-bold text-emerald-400">
            📄 Registro Obligatorio de Pagaré
          </h3>
          <button
            onClick={onClose}
            type="button"
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <p className="text-sm text-slate-300">
            Estás creando un nuevo crédito para <strong className="text-white">{clientName || 'el cliente'}</strong> por un monto de{' '}
            <strong className="text-emerald-400">
              {amount ? `Gs. ${amount.toLocaleString('es-PY')}` : 'monto especificado'}
            </strong>. Se generará automáticamente el pagaré en estado <span className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded text-xs border border-emerald-700">activo</span>.
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-200 mb-1">
              Número / Código de Tomo <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={tomo}
              onChange={(e) => {
                setTomo(e.target.value);
                if (error) setError('');
              }}
              placeholder="Ej: TOMO-2026-04, 1024, Lib-A..."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoFocus
            />
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-emerald-900/40"
            >
              Confirmar y Crear Crédito
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
