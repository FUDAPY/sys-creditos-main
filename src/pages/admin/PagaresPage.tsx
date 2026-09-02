import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { Pagare, PagareStatus } from '../../types';
import {
  exportPagaresToExcel,
  getPagares,
  importPagaresFromCSV,
  togglePagareStatus,
} from '../../services/pagareService';

export default function PagaresPage() {
  const { userData } = useAuth();
  const [pagares, setPagares] = useState<Pagare[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTomo, setSelectedTomo] = useState<string>('ALL');
  const [selectedEstado, setSelectedEstado] = useState<'ALL' | PagareStatus>('ALL');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getPagares();
      setPagares(data);
    } catch (err) {
      console.error('Error cargando pagares:', err);
    } finally {
      setLoading(false);
    }
  };

  const tomosDisponibles = useMemo(() => {
    const set = new Set<string>();
    pagares.forEach((p) => {
      if (p.tomo) set.add(String(p.tomo).trim());
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
      return numA - numB;
    });
  }, [pagares]);

  const filteredPagares = useMemo(() => {
    const query = search.trim().toLowerCase();
    return pagares.filter((item) => {
      const matchesSearch =
        !query ||
        item.nombre.toLowerCase().includes(query) ||
        item.cedula.toLowerCase().includes(query) ||
        String(item.tomo).toLowerCase().includes(query);

      const matchesTomo = selectedTomo === 'ALL' || String(item.tomo).trim() === selectedTomo;
      const matchesEstado = selectedEstado === 'ALL' || item.estado === selectedEstado;

      return matchesSearch && matchesTomo && matchesEstado;
    });
  }, [pagares, search, selectedTomo, selectedEstado]);

  const stats = useMemo(() => {
    const total = pagares.length;
    const activos = pagares.filter((p) => p.estado === 'activo').length;
    const cancelados = pagares.filter((p) => p.estado === 'cancelado').length;
    return { total, activos, cancelados };
  }, [pagares]);

  const handleToggleState = async (pagare: Pagare) => {
    if (!userData || updatingId) return;
    const nextState: PagareStatus = pagare.estado === 'activo' ? 'cancelado' : 'activo';
    setUpdatingId(pagare.id || null);
    try {
      await togglePagareStatus(pagare.id!, nextState, userData);
      setPagares((prev) =>
        prev.map((p) =>
          p.id === pagare.id
            ? {
                ...p,
                estado: nextState,
                entregadoAt: nextState === 'cancelado' ? Date.now() : undefined,
                entregadoByName: nextState === 'cancelado' ? userData.name : undefined,
              }
            : p
        )
      );
    } catch (err) {
      console.error('Error actualizando pagare:', err);
      alert('No se pudo actualizar el estado del pagare.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userData) return;

    setImporting(true);
    try {
      const text = await file.text();
      const result = await importPagaresFromCSV(text, userData.uid);
      alert(`Importacion completada: ${result.importedCount} pagares importados. (${result.errorsCount} omitidos)`);
      await loadData();
    } catch (err) {
      console.error('Error al importar CSV:', err);
      alert('Ocurrio un error al importar el archivo CSV.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExport = () => {
    if (filteredPagares.length === 0) {
      alert('No hay pagarés para exportar.');
      return;
    }
    exportPagaresToExcel(filteredPagares);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventario de Pagarés</h1>
          <p className="text-sm text-slate-500">
            Gestión de pagarés por tomo, cédula y cliente. Máquina de estados: Activo / Cancelado.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv"
            className="hidden"
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 flex items-center gap-2 shadow"
          >
            📥 {importing ? 'Importando CSV...' : 'Importar CSV'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition flex items-center gap-2 shadow"
          >
            📊 Exportar XLSX
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Pagarés</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{stats.total.toLocaleString('es-PY')}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Activos en Tomo</p>
          <p className="mt-2 text-3xl font-bold text-emerald-800">{stats.activos.toLocaleString('es-PY')}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-700">Cancelados</p>
          <p className="mt-2 text-3xl font-bold text-red-800">{stats.cancelados.toLocaleString('es-PY')}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, C.I. o tomo..."
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          <select
            value={selectedTomo}
            onChange={(e) => setSelectedTomo(e.target.value)}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">Todos los Tomos</option>
            {tomosDisponibles.map((tomo) => (
              <option key={tomo} value={tomo}>
                Tomo {tomo}
              </option>
            ))}
          </select>
          <select
            value={selectedEstado}
            onChange={(e) => setSelectedEstado(e.target.value as 'ALL' | PagareStatus)}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="activo">Activos</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <h3 className="font-bold text-slate-800">
            Listado ({filteredPagares.length.toLocaleString('es-PY')})
          </h3>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Cargando pagarés...</div>
          ) : filteredPagares.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No se encontraron pagarés.</div>
          ) : (
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-6 py-3">Tomo</th>
                  <th className="px-6 py-3">Cliente / C.I.</th>
                  <th className="px-6 py-3 text-right">Monto</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPagares.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="px-6 py-4 font-bold text-slate-900">Tomo {item.tomo}</td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{item.nombre}</p>
                      <p className="text-xs text-slate-500">C.I.: {item.cedula || 'Sin C.I.'}</p>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">
                      Gs. {Math.round(item.monto || 0).toLocaleString('es-PY')}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                          item.estado === 'activo'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-red-100 text-red-800 border border-red-300'
                        }`}
                      >
                        {item.estado === 'activo' ? 'activo' : 'cancelado'}
                      </span>
                      {item.estado === 'cancelado' && item.entregadoByName && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          Cancelado por {item.entregadoByName}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={updatingId === item.id}
                        onClick={() => void handleToggleState(item)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
                          item.estado === 'activo'
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                      >
                        {updatingId === item.id
                          ? 'Guardando...'
                          : item.estado === 'activo'
                            ? 'Marcar Cancelado'
                            : 'Marcar Activo'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
