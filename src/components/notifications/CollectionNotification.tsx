import React, { useEffect, useState } from 'react';
import type { Loan, Client } from '../../types';
import { getTodayCollections } from '../../utils/collectionCalendarUtils';

interface NotificationProps {
  loans: Loan[];
  clients: Map<string, Client>;
  userRole: 'ADMIN' | 'COLLECTOR';
  currentUserId: string;
}

export const CollectionNotification: React.FC<NotificationProps> = ({
  loans,
  clients,
  userRole,
  currentUserId
}) => {
  const [todayCollections, setTodayCollections] = useState<Array<{
    loan: Loan;
    client: Client;
    daysUntilExpiry: number;
  }>>([]);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Filtrar créditos según rol
    let filtered = getTodayCollections(loans, clients);
    
    if (userRole === 'COLLECTOR') {
      filtered = filtered.filter(item => item.loan.collectorId === currentUserId);
    }
    
    setTodayCollections(filtered);
  }, [loans, clients, userRole, currentUserId]);

  if (!isVisible || todayCollections.length === 0) {
    return null;
  }

  return (
    <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6 rounded shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-bold text-blue-900 mb-2">
            📋 Cobranzas para hoy ({todayCollections.length})
          </h3>
          <div className="space-y-2">
            {todayCollections.map((item) => (
              <div key={item.loan.id} className="text-sm text-blue-800 bg-white p-2 rounded">
                <p className="font-semibold">{item.client.fullName}</p>
                <p className="text-xs text-gray-600">
                  Saldo: Gs. {item.loan.currentBalance.toLocaleString()}
                  {item.daysUntilExpiry < 0 && (
                    <span className="ml-2 text-red-600 font-bold">
                      ⚠️ {Math.abs(item.daysUntilExpiry)} días de atraso
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="text-blue-500 hover:text-blue-700 font-bold ml-4"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
