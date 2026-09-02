import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, COMPANY_ID } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import type { Client, CollectionManagement, Loan } from '../../types';
import {
  getCollectionManagementId,
  getLoanDueDateForManagement,
  loadCollectionManagements,
  markCollectionAsManaged,
} from '../../services/collectionManagementService';
import type { CollectionDay } from '../../utils/collectionCalendarUtils';
import {
  generateMonthCalendar,
  getLoanCollectionDate,
  getMonthName,
} from '../../utils/collectionCalendarUtils';

export const LoanCalendar: React.FC = () => {
  const { userData } = useAuth();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Map<string, Client>>(new Map());
  const [managements, setManagements] = useState<Map<string, CollectionManagement>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarDays, setCalendarDays] = useState<CollectionDay[]>([]);

  useEffect(() => {
    void loadData();
  }, [userData]);

  useEffect(() => {
    if (loans.length > 0 && clients.size > 0) {
      generateCalendar();
    } else {
      setCalendarDays([]);
    }
  }, [loans, clients, currentDate]);

  const loadData = async () => {
    if (!userData) return;

    try {
      setLoading(true);

      const baseLoansRef = collection(db, `companies/${COMPANY_ID}/loans`);
      const loansQuery = query(baseLoansRef, where('status', 'in', ['ACTIVE', 'FROZEN', 'CONGELADO']));

      const [loansSnapshot, managementMap] = await Promise.all([
        getDocs(loansQuery),
        loadCollectionManagements(),
      ]);

      const loansData = loansSnapshot.docs
        .map((docItem) => ({ ...docItem.data(), id: docItem.id }) as Loan)
        .filter(
          (loan) =>
            loan.status !== 'PAID' &&
            loan.status !== 'CONGELADO' &&
            (loan.approvalStatus || 'APPROVED') === 'APPROVED'
        );

      const clientsMap = new Map<string, Client>();
      const clientIds = [...new Set(loansData.map((loan) => loan.clientId))];

      for (let index = 0; index < clientIds.length; index += 10) {
        const batch = clientIds.slice(index, index + 10);
        if (batch.length === 0) continue;

        const clientsSnapshot = await getDocs(
          query(collection(db, `companies/${COMPANY_ID}/clients`), where('__name__', 'in', batch))
        );

        clientsSnapshot.docs.forEach((docItem) => {
          clientsMap.set(docItem.id, { ...docItem.data(), id: docItem.id } as Client);
        });
      }

      setLoans(loansData);
      setClients(clientsMap);
      setManagements(managementMap);
    } catch (error) {
      console.error('Error cargando datos del calendario:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateCalendar = () => {
    const calendar = generateMonthCalendar(
      loans,
      clients,
      currentDate.getFullYear(),
      currentDate.getMonth()
    );
    setCalendarDays(calendar.days);
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getManagementStatus = (loan: Loan) => {
    const key = getCollectionManagementId(loan.id!, getLoanDueDateForManagement(loan));
    return managements.get(key)?.status || 'PENDING';
  };

  const handleMarkManaged = async (loan: Loan) => {
    if (!userData || savingId === loan.id) return;

    try {
      setSavingId(loan.id!);
      await markCollectionAsManaged(loan, userData);

      const dueDate = getLoanDueDateForManagement(loan);
      const key = getCollectionManagementId(loan.id!, dueDate);
      const now = Date.now();

      setManagements((previous) => {
        const next = new Map(previous);
        next.set(key, {
          id: key,
          companyId: COMPANY_ID,
          loanId: loan.id!,
          clientId: loan.clientId,
          collectorId: loan.collectorId,
          collectorName: loan.collectorName,
          dueDate,
          status: 'MANAGED',
          managedAt: now,
          managedBy: userData.uid,
          managedByName: userData.name,
          createdAt: now,
          updatedAt: now,
          createdBy: userData.uid,
        });
        return next;
      });
    } catch (error) {
      console.error('Error marcando gestion:', error);
      alert('No se pudo marcar la cobranza como gestionada.');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <p className="text-gray-600">Cargando calendario...</p>
      </div>
    );
  }

  const monthName = getMonthName(currentDate.getMonth());
  const year = currentDate.getFullYear();
  const today = new Date();
  const orderedCalendarRows = calendarDays
    .filter((day) => day.loans.length > 0)
    .flatMap((day) =>
      day.loans.map((item) => ({
        day,
        item,
        dueDate: getLoanCollectionDate(item.loan),
      }))
    )
    .sort((left, right) => left.dueDate - right.dueDate);

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={goToPreviousMonth}
          className="rounded bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300"
        >
          ← Anterior
        </button>

        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">
            {monthName} {year}
          </h2>
          <p className="text-sm text-gray-600">
            {userData?.role === 'COLLECTOR' ? 'Tus cobranzas' : 'Todas las cobranzas'}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={goToToday}
            className="rounded bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-600"
          >
            Hoy
          </button>
          <button
            onClick={goToNextMonth}
            className="rounded bg-gray-200 px-4 py-2 font-semibold hover:bg-gray-300"
          >
            Siguiente →
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-2">
        {['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'].map((day) => (
          <div
            key={day}
            className="border-b-2 border-gray-300 py-2 text-center font-bold text-gray-600"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2 auto-rows-[120px]">
        {Array.from({ length: new Date(year, currentDate.getMonth(), 1).getDay() }).map((_, index) => (
          <div key={`empty-${index}`} className="rounded bg-gray-50" />
        ))}

        {calendarDays.map((day) => {
          const isToday =
            day.dayOfMonth === today.getDate() &&
            currentDate.getMonth() === today.getMonth() &&
            year === today.getFullYear();

          const hasCollections = day.loans.length > 0;

          return (
            <div
              key={day.dayOfMonth}
              className={`flex flex-col overflow-hidden rounded-lg border p-2 text-xs ${
                isToday
                  ? 'border-yellow-400 bg-yellow-100'
                  : hasCollections
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className={`font-bold ${isToday ? 'text-yellow-900' : 'text-gray-700'}`}>
                {day.dayOfMonth}
              </div>

              {hasCollections && (
                <div className="mt-1 flex-1 space-y-1 overflow-y-auto">
                  {day.loans.slice(0, 3).map((item, index) => {
                    const managementStatus = getManagementStatus(item.loan);

                    return (
                      <div
                        key={`${item.loan.id}-${index}`}
                        className={`rounded p-1 text-[10px] line-clamp-2 ${
                          managementStatus === 'MANAGED'
                            ? 'bg-blue-200 text-blue-900'
                            : 'bg-orange-200 text-orange-900 font-bold'
                        }`}
                        title={`${item.client.fullName} - ${
                          managementStatus === 'MANAGED' ? 'Gestionado' : 'Pendiente'
                        }`}
                      >
                        {item.client.fullName?.split(' ')[0]}
                      </div>
                    );
                  })}
                  {day.loans.length > 3 && (
                    <div className="px-1 text-[10px] font-bold text-gray-600">
                      +{day.loans.length - 3} mas
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border-2 border-yellow-400 bg-yellow-100" />
          <span>Hoy</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border border-orange-300 bg-orange-200" />
          <span>Pendiente</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border border-blue-300 bg-blue-200" />
          <span>Gestionado</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded border border-gray-200 bg-gray-50" />
          <span>Sin cobranzas</span>
        </div>
      </div>

      <div className="mt-8 border-t-2 pt-6">
        <h3 className="mb-4 text-lg font-bold text-gray-800">Proximas cobranzas (7 dias)</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">Cliente</th>
                <th className="px-4 py-2 text-left">Cobrador</th>
                <th className="px-4 py-2 text-right">Saldo</th>
                <th className="px-4 py-2 text-center">Estado</th>
                <th className="px-4 py-2 text-center">Gestion</th>
              </tr>
            </thead>
            <tbody>
              {orderedCalendarRows.map(({ day, item }, index) => {
                const managementStatus = getManagementStatus(item.loan);
                const dueDate = new Date(getLoanCollectionDate(item.loan)).toLocaleDateString('es-PY');

                return (
                  <tr
                    key={`${day.dayOfMonth}-${item.loan.id}-${index}`}
                    className={`border-b ${
                      managementStatus === 'MANAGED'
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-orange-200 bg-orange-50'
                    }`}
                  >
                    <td className="px-4 py-2 font-semibold">{dueDate}</td>
                    <td className="px-4 py-2">{item.client.fullName}</td>
                    <td className="px-4 py-2">{item.loan.collectorName}</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      Gs. {item.loan.currentBalance.toLocaleString('es-PY')}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {managementStatus === 'MANAGED' ? (
                        <span className="rounded bg-blue-200 px-3 py-1 text-xs font-bold text-blue-900">
                          GESTIONADO
                        </span>
                      ) : (
                        <span className="rounded bg-orange-200 px-3 py-1 text-xs font-bold text-orange-900">
                          PENDIENTE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {managementStatus === 'MANAGED' ? (
                        <span className="text-xs font-semibold text-blue-700">Confirmado</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleMarkManaged(item.loan)}
                          disabled={savingId === item.loan.id}
                          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingId === item.loan.id ? 'Guardando...' : 'Marcar gestionado'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {calendarDays.filter((day) => day.loans.length > 0).length === 0 && (
          <div className="py-8 text-center text-gray-600">
            <p className="text-lg">No hay cobranzas programadas para este periodo</p>
          </div>
        )}
      </div>
    </div>
  );
};
