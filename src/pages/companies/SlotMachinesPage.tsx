import { useEffect, useMemo, useState } from 'react';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import {
  createSlotMachineEntry,
  createSlotMachineSite,
  getSlotMachineEntries,
  getSlotMachineSites,
} from '../../services/slotMachineService';
import type { SlotMachineEntry, SlotMachineSite, User } from '../../types';

const formatDateInput = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 12, 0, 0, 0);
};

export default function SlotMachinesPage() {
  const { userData } = useAuth();
  const [sites, setSites] = useState<SlotMachineSite[]>([]);
  const [entries, setEntries] = useState<SlotMachineEntry[]>([]);
  const [collectors, setCollectors] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSite, setSavingSite] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState({
    name: '',
    locationName: '',
    address: '',
    collectorId: '',
  });
  const [entryForm, setEntryForm] = useState({
    siteId: '',
    collectionDate: formatDateInput(Date.now()),
    amount: '',
    notes: '',
  });

  useEffect(() => {
    if (!userData) return;
    void loadData();
  }, [userData]);

  const loadData = async () => {
    if (!userData) return;

    try {
      setLoading(true);
      setError(null);

      const [sitesData, entriesData, collectorsSnap] = await Promise.all([
        getSlotMachineSites(userData),
        getSlotMachineEntries(userData),
        getDocsFromServer(
          query(
            collection(db, `companies/${COMPANY_ID}/users`),
            where('isActive', '==', true)
          )
        ),
      ]);

      const availableCollectors = collectorsSnap.docs
        .map((item) => ({ ...(item.data() as User), uid: (item.data() as User).uid || item.id }))
        .filter((item) => item.role === 'COLLECTOR' || item.role === 'ADMIN')
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));

      setSites(sitesData);
      setEntries(entriesData);
      setCollectors(availableCollectors);

      if (!entryForm.siteId && sitesData.length > 0) {
        setEntryForm((previous) => ({ ...previous, siteId: sitesData[0].id || '' }));
      }
      if (!siteForm.collectorId && availableCollectors.length > 0) {
        setSiteForm((previous) => ({ ...previous, collectorId: availableCollectors[0].uid }));
      }
    } catch (err) {
      console.error('Error cargando tragamonedas:', err);
      setError('No se pudo cargar el modulo de tragamonedas.');
    } finally {
      setLoading(false);
    }
  };

  const selectedSite = useMemo(
    () => sites.find((item) => item.id === entryForm.siteId) || null,
    [entryForm.siteId, sites]
  );

  const estimatedCommission = useMemo(() => {
    const amount = Number(entryForm.amount || 0);
    const commissionRate = selectedSite?.commissionRate ?? 10;
    return Math.round(amount * (commissionRate / 100));
  }, [entryForm.amount, selectedSite?.commissionRate]);

  const handleCreateSite = async () => {
    if (!userData || userData.role !== 'ADMIN') return;
    if (!siteForm.name.trim() || !siteForm.locationName.trim() || !siteForm.collectorId) {
      setError('Completa nombre, ubicacion y cobrador de la tragamonedas.');
      return;
    }

    const collector = collectors.find((item) => item.uid === siteForm.collectorId);
    if (!collector) {
      setError('Selecciona un cobrador valido.');
      return;
    }

    try {
      setSavingSite(true);
      setError(null);
      const createdSite = await createSlotMachineSite(
        {
          name: siteForm.name,
          locationName: siteForm.locationName,
          address: siteForm.address,
          collectorId: collector.uid,
          collectorName: collector.name,
        },
        userData.uid
      );

      setSiteForm({
        name: '',
        locationName: '',
        address: '',
        collectorId: collector.uid,
      });
      setEntryForm((previous) => ({ ...previous, siteId: createdSite.id || '' }));
      await loadData();
    } catch (err) {
      console.error('Error creando tragamonedas:', err);
      setError('No se pudo guardar la ubicacion de tragamonedas.');
    } finally {
      setSavingSite(false);
    }
  };

  const handleCreateEntry = async () => {
    if (!userData || !selectedSite) return;

    const amount = Number(entryForm.amount || 0);
    if (!selectedSite.id || !entryForm.collectionDate || amount <= 0) {
      setError('Completa fecha, ubicacion y monto de recaudacion.');
      return;
    }

    try {
      setSavingEntry(true);
      setError(null);
      await createSlotMachineEntry(
        {
          siteId: selectedSite.id,
          siteName: selectedSite.name,
          locationName: selectedSite.locationName,
          collectorId: selectedSite.collectorId,
          collectorName: selectedSite.collectorName,
          collectionDate: parseDateInput(entryForm.collectionDate),
          amount,
          commissionRate: selectedSite.commissionRate ?? 10,
          notes: entryForm.notes,
        },
        userData.uid
      );

      setEntryForm((previous) => ({
        ...previous,
        amount: '',
        notes: '',
      }));
      await loadData();
    } catch (err) {
      console.error('Error registrando recaudacion:', err);
      setError('No se pudo guardar la recaudacion diaria.');
    } finally {
      setSavingEntry(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-gray-600">Cargando tragamonedas...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {userData?.role === 'ADMIN' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Nueva ubicacion de tragamonedas</h2>
          <p className="mt-1 text-sm text-slate-500">
            Registra donde estan ubicadas y a que cobrador corresponde la comision.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={siteForm.name}
              onChange={(event) => setSiteForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Nombre o codigo"
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
            />
            <input
              value={siteForm.locationName}
              onChange={(event) => setSiteForm((prev) => ({ ...prev, locationName: event.target.value }))}
              placeholder="Ubicacion"
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
            />
            <input
              value={siteForm.address}
              onChange={(event) => setSiteForm((prev) => ({ ...prev, address: event.target.value }))}
              placeholder="Direccion"
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
            />
            <select
              value={siteForm.collectorId}
              onChange={(event) => setSiteForm((prev) => ({ ...prev, collectorId: event.target.value }))}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
            >
              <option value="">Seleccionar cobrador</option>
              {collectors.map((collector) => (
                <option key={collector.uid} value={collector.uid}>
                  {collector.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleCreateSite()}
              disabled={savingSite}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {savingSite ? 'Guardando...' : 'Guardar ubicacion'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Cargar recaudacion diaria</h2>
        <p className="mt-1 text-sm text-slate-500">
          Se calcula automaticamente el 10% de comision por defecto y queda pendiente en Aprobar Rendiciones.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={entryForm.siteId}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, siteId: event.target.value }))}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
          >
            <option value="">Seleccionar tragamonedas</option>
            {sites.filter((site) => site.isActive).map((site) => (
              <option key={site.id} value={site.id}>
                {site.locationName} - {site.collectorName}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={entryForm.collectionDate}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, collectionDate: event.target.value }))}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
          />
          <input
            type="number"
            min="1"
            value={entryForm.amount}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, amount: event.target.value }))}
            placeholder="Recaudacion del dia"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
          />
          <input
            value={entryForm.notes}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Observacion"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Ubicacion</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {selectedSite?.locationName || 'Sin seleccionar'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Cobrador</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {selectedSite?.collectorName || 'Sin seleccionar'}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Comision</p>
            <p className="mt-2 text-lg font-bold text-emerald-700">
              Gs. {estimatedCommission.toLocaleString('es-PY')}
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              {(selectedSite?.commissionRate ?? 10).toLocaleString('es-PY')}%
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void handleCreateEntry()}
            disabled={savingEntry || !selectedSite}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {savingEntry ? 'Guardando...' : 'Registrar recaudacion'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Historial diario de tragamonedas</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-6 py-3">Fecha</th>
                <th className="px-6 py-3">Ubicacion</th>
                <th className="px-6 py-3">Cobrador</th>
                <th className="px-6 py-3">Ingreso diario</th>
                <th className="px-6 py-3">Comision</th>
                <th className="px-6 py-3">Rendido</th>
                <th className="px-6 py-3">Observacion</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100">
                  <td className="px-6 py-4">{formatDateInput(entry.collectionDate)}</td>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900">{entry.locationName}</div>
                    <div className="text-xs text-slate-500">{entry.siteName}</div>
                  </td>
                  <td className="px-6 py-4">{entry.collectorName}</td>
                  <td className="px-6 py-4 font-semibold text-blue-700">
                    Gs. {entry.amount.toLocaleString('es-PY')}
                  </td>
                  <td className="px-6 py-4 font-semibold text-emerald-700">
                    Gs. {entry.commissionAmount.toLocaleString('es-PY')}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      entry.approvalStatus === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {entry.approvalStatus === 'APPROVED' ? 'SI' : 'NO'}
                    </span>
                  </td>
                  <td className="px-6 py-4">{entry.notes || '-'}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    Aun no hay recaudaciones cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
