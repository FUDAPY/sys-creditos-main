import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import {
  getClientsForUser,
  reassignClientCollector,
  updateClientData,
  updateClientReferences,
} from '../../services/clientService';
import { getLoanFinancialSnapshot } from '../../services/loanService';
import type { Client, Loan, User } from '../../types';

interface ClientPortfolioRow {
  client: Client;
  loans: Loan[];
  totalOutstanding: number;
  activeLoans: number;
}

const PAGE_SIZE = 10;

export default function ClientsList() {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [collectorNames, setCollectorNames] = useState<Record<string, string>>({});
  const [collectors, setCollectors] = useState<Array<{ uid: string; name: string }>>([]);
  const [search, setSearch] = useState('');
  const [selectedCollector, setSelectedCollector] = useState<'ALL' | string>('ALL');
  const [selectedCompany, setSelectedCompany] = useState<'ALL' | string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCollector, setSavingCollector] = useState(false);
  const [reassigningClient, setReassigningClient] = useState<Client | null>(null);
  const [nextCollectorId, setNextCollectorId] = useState('');
  const [editingReferencesClient, setEditingReferencesClient] = useState<Client | null>(null);
  const [referencesForm, setReferencesForm] = useState<Client['references']>([]);
  const [savingReferences, setSavingReferences] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientForm, setClientForm] = useState<Partial<Client> | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!userData) return;
    void loadData();
  }, [userData]);

  const loadData = async () => {
    if (!userData) return;

    try {
      setLoading(true);
      setError(null);

      const [clientsData, loansSnap, usersSnap] = await Promise.all([
        getClientsForUser(userData),
        getDocs(
          userData.role === 'COLLECTOR'
            ? query(
                collection(db, `companies/${COMPANY_ID}/loans`),
                where('collectorId', '==', userData.uid),
                orderBy('createdAt', 'desc')
              )
            : query(collection(db, `companies/${COMPANY_ID}/loans`), orderBy('createdAt', 'desc'))
        ),
        userData.role === 'ADMIN'
          ? getDocs(
              query(
                collection(db, `companies/${COMPANY_ID}/users`),
                where('role', '==', 'COLLECTOR'),
                where('isActive', '==', true)
              )
            )
          : Promise.resolve(null),
      ]);

      const nextCollectorNames: Record<string, string> = {};
      const nextCollectors: Array<{ uid: string; name: string }> = [];
      if (usersSnap) {
        usersSnap.docs.forEach((doc) => {
          const user = doc.data() as User;
          nextCollectorNames[doc.id] = user.name;
          nextCollectors.push({ uid: doc.id, name: user.name });
        });
      } else {
        nextCollectorNames[userData.uid] = userData.name;
      }

      setClients(clientsData);
      const nextLoans = loansSnap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as Loan) }))
        .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      setLoans(nextLoans);
      setCollectorNames(nextCollectorNames);
      setCollectors(nextCollectors);
    } catch (err) {
      console.error('Error cargando clientes:', err);
      setError('No se pudo cargar el listado de clientes.');
    } finally {
      setLoading(false);
    }
  };

  const portfolioRows = useMemo<ClientPortfolioRow[]>(() => {
    return clients.map((client) => {
      const clientLoans = loans.filter(
        (loan) => loan.clientId === client.id && (loan.approvalStatus || 'APPROVED') === 'APPROVED'
      );
      const activeClientLoans = clientLoans.filter((loan) => {
        if (loan.status === 'PAID') return false;
        return getLoanFinancialSnapshot(loan).totalDue > 0;
      });
      const totalOutstanding = clientLoans.reduce((sum, loan) => {
        if (loan.status === 'PAID') {
          return sum;
        }

        return sum + getLoanFinancialSnapshot(loan).totalDue;
      }, 0);

      return {
        client,
        loans: clientLoans,
        totalOutstanding,
        activeLoans: activeClientLoans.length,
      };
    });
  }, [clients, loans]);

  const resolveCollectorName = (client: Client) => {
    return (
      client.collectorName ||
      (client.collectorId ? collectorNames[client.collectorId] : '') ||
      loans.find((loan) => loan.clientId === client.id)?.collectorName ||
      'Sin asignar'
    );
  };

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return portfolioRows.filter(({ client }) => {
      const matchesSearch =
        !term ||
        client.fullName.toLowerCase().includes(term) ||
        client.documentId.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term);

      const matchesCollector =
        userData?.role !== 'ADMIN' ||
        selectedCollector === 'ALL' ||
        client.collectorId === selectedCollector;

      const matchesCompany =
        selectedCompany === 'ALL' ||
        (client.workplaceName || '').trim().toLowerCase() === selectedCompany.toLowerCase();

      return matchesSearch && matchesCollector && matchesCompany;
    });
  }, [portfolioRows, search, selectedCollector, selectedCompany, userData?.role]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedCollector, selectedCompany, userData?.role]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredRows]);

  const availableCollectors = useMemo(() => {
    if (userData?.role !== 'ADMIN') return [];
    if (collectors.length > 0) return collectors;

    const map = new Map<string, string>();
    clients.forEach((client) => {
      if (client.collectorId) {
        map.set(client.collectorId, resolveCollectorName(client));
      }
    });

    return Array.from(map.entries()).map(([uid, name]) => ({ uid, name }));
  }, [clients, userData?.role, collectors, loans, collectorNames]);

  const availableCompanies = useMemo(() => {
    const unique = new Set<string>();
    clients.forEach((client) => {
      const company = (client.workplaceName || '').trim();
      if (company) unique.add(company);
    });
    return Array.from(unique).sort((left, right) => left.localeCompare(right, 'es'));
  }, [clients]);

  const openReassignModal = (client: Client) => {
    setReassigningClient(client);
    setNextCollectorId(client.collectorId || '');
  };

  const closeReassignModal = () => {
    if (savingCollector) return;
    setReassigningClient(null);
    setNextCollectorId('');
  };

  const openReferencesModal = (client: Client) => {
    setEditingReferencesClient(client);
    setReferencesForm(
      client.references?.length
        ? client.references.map((reference) => ({ ...reference }))
        : [
            { name: '', relationship: '', workplace: '', phone: '' },
            { name: '', relationship: '', workplace: '', phone: '' },
            { name: '', relationship: '', workplace: '', phone: '' },
          ]
    );
  };

  const openEditClientModal = (client: Client) => {
    setEditingClient(client);
    setClientForm({
      ...client,
      references: client.references?.length
        ? client.references.map((reference) => ({ ...reference }))
        : [
            { name: '', relationship: '', workplace: '', phone: '' },
            { name: '', relationship: '', workplace: '', phone: '' },
            { name: '', relationship: '', workplace: '', phone: '' },
          ],
      location: {
        latitude: client.location?.latitude || 0,
        longitude: client.location?.longitude || 0,
        googleMapsUrl: client.location?.googleMapsUrl || '',
      },
    });
  };

  const closeEditClientModal = () => {
    if (savingClient) return;
    setEditingClient(null);
    setClientForm(null);
  };

  const closeReferencesModal = () => {
    if (savingReferences) return;
    setEditingReferencesClient(null);
    setReferencesForm([]);
  };

  const handleClientFieldChange = (field: keyof Client, value: string) => {
    setClientForm((previous) => ({
      ...(previous || {}),
      [field]: value,
    }));
  };

  const handleClientReferenceChange = (
    index: number,
    field: keyof Client['references'][number],
    value: string
  ) => {
    setClientForm((previous) => {
      const nextReferences = [...(previous?.references || [])];
      nextReferences[index] = {
        ...(nextReferences[index] || { name: '', relationship: '', workplace: '', phone: '' }),
        [field]: value,
      };

      return {
        ...(previous || {}),
        references: nextReferences,
      };
    });
  };

  const handleClientLocationChange = (
    field: keyof Client['location'],
    value: string
  ) => {
    setClientForm((previous) => ({
      ...(previous || {}),
      location: {
        latitude: previous?.location?.latitude || 0,
        longitude: previous?.location?.longitude || 0,
        googleMapsUrl: previous?.location?.googleMapsUrl || '',
        [field]: field === 'googleMapsUrl' ? value : Number(value || 0),
      },
    }));
  };

  const handleSaveCollector = async () => {
    if (!userData || userData.role !== 'ADMIN' || !reassigningClient || !nextCollectorId) {
      return;
    }

    if (!reassigningClient.id) {
      setError('No se pudo identificar el cliente a reasignar.');
      return;
    }

    const collector = availableCollectors.find((item) => item.uid === nextCollectorId);
    if (!collector) {
      setError('Selecciona un cobrador valido para reasignar el cliente.');
      return;
    }

    try {
      setSavingCollector(true);
      setError(null);
      await reassignClientCollector(reassigningClient.id, collector.uid, collector.name, userData.uid);
      setReassigningClient(null);
      setNextCollectorId('');
      await loadData();
    } catch (err) {
      console.error('Error reasignando cobrador:', err);
      setError('No se pudo cambiar el cobrador asignado del cliente.');
    } finally {
      setSavingCollector(false);
    }
  };

  const handleReferenceChange = (
    index: number,
    field: keyof Client['references'][number],
    value: string
  ) => {
    setReferencesForm((previous) =>
      previous.map((reference, currentIndex) =>
        currentIndex === index ? { ...reference, [field]: value } : reference
      )
    );
  };

  const handleSaveReferences = async () => {
    if (!userData || userData.role !== 'ADMIN' || !editingReferencesClient?.id) {
      return;
    }

    const hasInvalidReference = referencesForm.some(
      (reference) =>
        !reference.name.trim() ||
        !reference.relationship.trim() ||
        !reference.workplace.trim() ||
        !reference.phone.trim()
    );

    if (hasInvalidReference) {
      setError('Completa correctamente las 3 referencias antes de guardar.');
      return;
    }

    try {
      setSavingReferences(true);
      setError(null);
      await updateClientReferences(editingReferencesClient.id, referencesForm, userData.uid);
      closeReferencesModal();
      await loadData();
    } catch (err) {
      console.error('Error actualizando referencias:', err);
      setError('No se pudieron actualizar las referencias del cliente.');
    } finally {
      setSavingReferences(false);
    }
  };

  const handleSaveClient = async () => {
    if (!userData || userData.role !== 'ADMIN' || !editingClient?.id || !clientForm) {
      return;
    }

    if (
      !clientForm.fullName?.trim() ||
      !clientForm.documentId?.trim() ||
      !clientForm.phone?.trim() ||
      !clientForm.address?.trim() ||
      !clientForm.city?.trim() ||
      !clientForm.workplaceName?.trim() ||
      !clientForm.position?.trim() ||
      !clientForm.workPhone?.trim() ||
      !clientForm.seniority?.trim()
    ) {
      setError('Completa los campos principales del cliente antes de guardar.');
      return;
    }

    const references = clientForm.references || [];
    const hasInvalidReference = references.some(
      (reference) =>
        !reference.name.trim() ||
        !reference.relationship.trim() ||
        !reference.workplace.trim() ||
        !reference.phone.trim()
    );

    if (hasInvalidReference) {
      setError('Completa correctamente las 3 referencias antes de guardar.');
      return;
    }

    try {
      setSavingClient(true);
      setError(null);

      const nextCollectorId = clientForm.collectorId || '';
      const nextCollectorName =
        nextCollectorId ? availableCollectors.find((item) => item.uid === nextCollectorId)?.name || '' : '';

      if (
        nextCollectorId &&
        nextCollectorId !== (editingClient.collectorId || '') &&
        nextCollectorName
      ) {
        await reassignClientCollector(editingClient.id, nextCollectorId, nextCollectorName, userData.uid);
      }

      await updateClientData(
        editingClient.id,
        {
          ...clientForm,
          collectorId: nextCollectorId || editingClient.collectorId,
          collectorName: nextCollectorName || editingClient.collectorName,
        },
        userData.uid
      );

      closeEditClientModal();
      await loadData();
    } catch (err) {
      console.error('Error actualizando cliente:', err);
      setError('No se pudieron actualizar los datos del cliente.');
    } finally {
      setSavingClient(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando clientes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-4 border-b bg-gray-50 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              Listado General de Clientes
            </h2>
            <p className="text-sm text-gray-500">
              {userData?.role === 'ADMIN'
                ? 'Control administrativo completo, incluso si el cliente aún no tiene crédito.'
                : 'Vista completa de clientes registrados en el sistema.'}
            </p>
          </div>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, C.I. o teléfono..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px]"
            />
            {userData?.role === 'ADMIN' && (
              <select
                value={selectedCollector}
                onChange={(event) => setSelectedCollector(event.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">Todos los cobradores</option>
                {availableCollectors.map((collector) => (
                  <option key={collector.uid} value={collector.uid}>
                    {collector.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={selectedCompany}
              onChange={(event) => setSelectedCompany(event.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">Empresas (todas)</option>
              {availableCompanies.map((companyName) => (
                <option key={companyName} value={companyName}>
                  {companyName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
              <tr>
                <th className="px-6 py-3 font-semibold">Cliente</th>
                <th className="px-6 py-3 font-semibold">Contacto</th>
                <th className="px-6 py-3 font-semibold">Empresa</th>
                <th className="px-6 py-3 font-semibold">Cobrador</th>
                <th className="px-6 py-3 font-semibold">Créditos</th>
                <th className="px-6 py-3 font-semibold">Monto vigente</th>
                <th className="px-6 py-3 font-semibold">Estado</th>
                <th className="px-6 py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map(({ client, activeLoans, totalOutstanding }) => (
                <tr key={client.id} className="bg-white border-b hover:bg-blue-50 transition-colors">
                  <td className="px-6 py-4">
                    {userData?.role === 'ADMIN' ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/clientes/${client.id}`)}
                        className="text-left group"
                      >
                        <div className="font-medium text-gray-900 group-hover:text-blue-700 group-hover:underline">
                          {client.fullName}
                        </div>
                        <div className="text-xs text-gray-500">C.I: {client.documentId}</div>
                      </button>
                    ) : (
                      <>
                        <div className="font-medium text-gray-900">{client.fullName}</div>
                        <div className="text-xs text-gray-500">C.I: {client.documentId}</div>
                      </>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div>{client.phone}</div>
                    <div className="text-xs text-gray-500">{client.city}</div>
                  </td>
                  <td className="px-6 py-4">{client.workplaceName || 'Sin empresa'}</td>
                  <td className="px-6 py-4">{resolveCollectorName(client)}</td>
                  <td className="px-6 py-4 font-semibold text-gray-800">{activeLoans}</td>
                  <td className="px-6 py-4 font-semibold text-blue-700">
                    Gs. {totalOutstanding.toLocaleString('es-PY')}
                  </td>
                  <td className="px-6 py-4">
                    {activeLoans > 0 ? (
                      <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold">
                        Con crédito
                      </span>
                    ) : (
                      <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-semibold">
                        Sin crédito
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {userData?.role === 'ADMIN' ? (
                      <div className="flex flex-col items-start gap-1">
                        <button
                          onClick={() => navigate(`/clientes/${client.id}`)}
                          className="text-slate-700 hover:text-slate-900 font-semibold hover:underline"
                        >
                          Ver movimientos
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditClientModal(client)}
                          className="text-emerald-600 hover:text-emerald-800 font-semibold hover:underline"
                        >
                          Editar cliente
                        </button>
                        <button
                          type="button"
                          onClick={() => openReassignModal(client)}
                          className="text-amber-600 hover:text-amber-800 font-semibold hover:underline"
                        >
                          Cambiar cobrador
                        </button>
                        <button
                          type="button"
                          onClick={() => openReferencesModal(client)}
                          className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline"
                        >
                          Editar referencias
                        </button>
                        <button
                          onClick={() => navigate('/creditos/nuevo')}
                          className="text-blue-600 hover:text-blue-800 font-semibold hover:underline"
                        >
                          Otorgar crédito
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400">Solo consulta</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                    No se encontraron clientes para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredRows.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-gray-600">
              Mostrando {(currentPage - 1) * PAGE_SIZE + 1}-
              {Math.min(currentPage * PAGE_SIZE, filteredRows.length)} de {filteredRows.length} clientes
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                disabled={currentPage === 1}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    currentPage === page
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                disabled={currentPage === totalPages}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {userData?.role === 'ADMIN' && reassigningClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Reasignar cobrador</h3>
              <p className="mt-1 text-sm text-slate-500">
                Cliente: <span className="font-semibold text-slate-700">{reassigningClient.fullName}</span>
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Nuevo cobrador asignado
                </label>
                <select
                  value={nextCollectorId}
                  onChange={(event) => setNextCollectorId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Seleccionar cobrador</option>
                  {availableCollectors.map((collector) => (
                    <option key={collector.uid} value={collector.uid}>
                      {collector.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Esta accion actualiza el cobrador del cliente y tambien redirige sus creditos abiertos para mantener la cartera consistente.
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={closeReassignModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingCollector || !nextCollectorId}
                onClick={() => void handleSaveCollector()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingCollector ? 'Guardando...' : 'Guardar cambio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {userData?.role === 'ADMIN' && editingReferencesClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Editar referencias personales</h3>
              <p className="mt-1 text-sm text-slate-500">
                Cliente: <span className="font-semibold text-slate-700">{editingReferencesClient.fullName}</span>
              </p>
            </div>

            <div className="space-y-5 px-6 py-5">
              {referencesForm.map((reference, index) => (
                <div key={`reference-${index}`} className="rounded-xl border border-slate-200 p-4">
                  <p className="mb-3 text-sm font-semibold text-slate-800">
                    Referencia {index + 1}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      type="text"
                      value={reference.name}
                      onChange={(event) => handleReferenceChange(index, 'name', event.target.value)}
                      placeholder="Nombre"
                      className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={reference.relationship}
                      onChange={(event) =>
                        handleReferenceChange(index, 'relationship', event.target.value)
                      }
                      placeholder="Relacion"
                      className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={reference.workplace}
                      onChange={(event) =>
                        handleReferenceChange(index, 'workplace', event.target.value)
                      }
                      placeholder="Lugar de trabajo"
                      className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={reference.phone}
                      onChange={(event) => handleReferenceChange(index, 'phone', event.target.value)}
                      placeholder="Telefono"
                      className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={closeReferencesModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingReferences}
                onClick={() => void handleSaveReferences()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingReferences ? 'Guardando...' : 'Guardar referencias'}
              </button>
            </div>
          </div>
        </div>
      )}

      {userData?.role === 'ADMIN' && editingClient && clientForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="w-full max-w-6xl rounded-2xl bg-white shadow-2xl max-h-[95vh] overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Editar cliente</h3>
              <p className="mt-1 text-sm text-slate-500">
                Cliente: <span className="font-semibold text-slate-700">{editingClient.fullName}</span>
              </p>
            </div>

            <div className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-6">
              <div>
                <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.15em] text-slate-500">
                  Datos personales
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={clientForm.fullName || ''} onChange={(e) => handleClientFieldChange('fullName', e.target.value)} placeholder="Nombre completo" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.documentId || ''} onChange={(e) => handleClientFieldChange('documentId', e.target.value)} placeholder="Documento" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.phone || ''} onChange={(e) => handleClientFieldChange('phone', e.target.value)} placeholder="Telefono" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.email || ''} onChange={(e) => handleClientFieldChange('email', e.target.value)} placeholder="Email" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input type="date" value={clientForm.birthDate || ''} onChange={(e) => handleClientFieldChange('birthDate', e.target.value)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.nationality || ''} onChange={(e) => handleClientFieldChange('nationality', e.target.value)} placeholder="Nacionalidad" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.address || ''} onChange={(e) => handleClientFieldChange('address', e.target.value)} placeholder="Direccion" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm md:col-span-2" />
                  <input value={clientForm.city || ''} onChange={(e) => handleClientFieldChange('city', e.target.value)} placeholder="Ciudad" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.neighborhood || ''} onChange={(e) => handleClientFieldChange('neighborhood', e.target.value)} placeholder="Barrio" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <select value={clientForm.housingType || 'PROPIA'} onChange={(e) => handleClientFieldChange('housingType', e.target.value)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">
                    <option value="PROPIA">Propia</option>
                    <option value="ALQUILADA">Alquilada</option>
                    <option value="FAMILIAR">Familiar</option>
                  </select>
                  <select value={clientForm.collectorId || ''} onChange={(e) => handleClientFieldChange('collectorId', e.target.value)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">
                    <option value="">Seleccionar cobrador</option>
                    {availableCollectors.map((collector) => (
                      <option key={collector.uid} value={collector.uid}>
                        {collector.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.15em] text-slate-500">
                  Datos laborales
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={clientForm.workplaceName || ''} onChange={(e) => handleClientFieldChange('workplaceName', e.target.value)} placeholder="Empresa" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.position || ''} onChange={(e) => handleClientFieldChange('position', e.target.value)} placeholder="Cargo" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.department || ''} onChange={(e) => handleClientFieldChange('department', e.target.value)} placeholder="Departamento" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.seniority || ''} onChange={(e) => handleClientFieldChange('seniority', e.target.value)} placeholder="Antiguedad" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.workPhone || ''} onChange={(e) => handleClientFieldChange('workPhone', e.target.value)} placeholder="Telefono laboral" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <select value={clientForm.employmentStatus || 'EMPLEADO'} onChange={(e) => handleClientFieldChange('employmentStatus', e.target.value)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm">
                    <option value="EMPLEADO">Empleado</option>
                    <option value="PROPIETARIO">Propietario</option>
                    <option value="INDEPENDIENTE">Independiente</option>
                  </select>
                  <input value={clientForm.workplaceAddress || ''} onChange={(e) => handleClientFieldChange('workplaceAddress', e.target.value)} placeholder="Direccion laboral" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm md:col-span-2" />
                  <input value={clientForm.workplaceCity || ''} onChange={(e) => handleClientFieldChange('workplaceCity', e.target.value)} placeholder="Ciudad laboral" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.workplaceNeighborhood || ''} onChange={(e) => handleClientFieldChange('workplaceNeighborhood', e.target.value)} placeholder="Barrio laboral" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.15em] text-slate-500">
                  Referencias personales
                </h4>
                <div className="space-y-4">
                  {(clientForm.references || []).map((reference, index) => (
                    <div key={`edit-reference-${index}`} className="rounded-xl border border-slate-200 p-4">
                      <p className="mb-3 text-sm font-semibold text-slate-800">Referencia {index + 1}</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input value={reference.name} onChange={(e) => handleClientReferenceChange(index, 'name', e.target.value)} placeholder="Nombre" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                        <input value={reference.relationship} onChange={(e) => handleClientReferenceChange(index, 'relationship', e.target.value)} placeholder="Relacion" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                        <input value={reference.workplace} onChange={(e) => handleClientReferenceChange(index, 'workplace', e.target.value)} placeholder="Lugar de trabajo" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                        <input value={reference.phone} onChange={(e) => handleClientReferenceChange(index, 'phone', e.target.value)} placeholder="Telefono" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.15em] text-slate-500">
                  Ubicacion
                </h4>
                <div className="grid gap-3 md:grid-cols-3">
                  <input type="number" value={clientForm.location?.latitude || 0} onChange={(e) => handleClientLocationChange('latitude', e.target.value)} placeholder="Latitud" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input type="number" value={clientForm.location?.longitude || 0} onChange={(e) => handleClientLocationChange('longitude', e.target.value)} placeholder="Longitud" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm" />
                  <input value={clientForm.location?.googleMapsUrl || ''} onChange={(e) => handleClientLocationChange('googleMapsUrl', e.target.value)} placeholder="URL mapa" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm md:col-span-3" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={closeEditClientModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingClient}
                onClick={() => void handleSaveClient()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingClient ? 'Guardando...' : 'Guardar cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
