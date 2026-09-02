import type { Loan, Client } from '../types';

export interface CollectionDay {
  date: Date;
  dayOfMonth: number;
  dayOfWeek: string;
  loans: Array<{
    loan: Loan;
    client: Client;
    daysUntilExpiry: number;
    isOverdue: boolean;
  }>;
}

export interface MonthCalendar {
  year: number;
  month: number;
  monthName: string;
  days: CollectionDay[];
}

/**
 * Calcula los días hasta que expire un crédito
 */
export const calculateDaysUntilExpiry = (expiresAt: number): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiryDate = new Date(expiresAt);
  expiryDate.setHours(0, 0, 0, 0);
  
  const diffTime = expiryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
};

export const getLoanCollectionDate = (loan: Pick<Loan, 'nextDueDate' | 'expiresAt'>): number =>
  loan.nextDueDate || loan.expiresAt;

const sortCollectionsByDate = <T extends { loan: Loan; client: Client }>(items: T[]) =>
  [...items].sort((left, right) => {
    const dueDateDifference =
      getLoanCollectionDate(left.loan) - getLoanCollectionDate(right.loan);

    if (dueDateDifference !== 0) {
      return dueDateDifference;
    }

    return (left.client.fullName || '').localeCompare(right.client.fullName || '', 'es');
  });

/**
 * Obtiene el nombre del día de la semana en español
 */
export const getDayName = (date: Date): string => {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sab'];
  return days[date.getDay()];
};

/**
 * Obtiene el nombre del mes en español
 */
export const getMonthName = (monthIndex: number): string => {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return months[monthIndex];
};

/**
 * Crea un calendario del mes con información de cobranzas
 */
export const generateMonthCalendar = (
  loans: Loan[],
  clients: Map<string, Client>,
  year: number,
  month: number
): MonthCalendar => {
  const monthName = getMonthName(month);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  
  const days: CollectionDay[] = [];
  
  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    const dayOfWeek = getDayName(currentDate);
    
    // Filtrar créditos que vencen este día
    const dailyLoans = sortCollectionsByDate(
      loans
      .filter(loan => {
        if (loan.status === 'PAID') return false; // No mostrar pagados
        
        const expiryDate = new Date(getLoanCollectionDate(loan));
        return (
          expiryDate.getFullYear() === year &&
          expiryDate.getMonth() === month &&
          expiryDate.getDate() === day
        );
      })
      .map(loan => ({
        loan,
        client: clients.get(loan.clientId) || ({} as Client),
        daysUntilExpiry: calculateDaysUntilExpiry(getLoanCollectionDate(loan)),
        isOverdue: calculateDaysUntilExpiry(getLoanCollectionDate(loan)) < 0
      }))
    );
    
    // También incluir créditos vencidos en cualquier día (vencieron en el pasado)
    const overdueLoans = sortCollectionsByDate(
      loans
      .filter(loan => {
        if (loan.status === 'PAID') return false;
        const daysUntil = calculateDaysUntilExpiry(getLoanCollectionDate(loan));
        return daysUntil < 0; // Vencidos
      })
      .map(loan => ({
        loan,
        client: clients.get(loan.clientId) || ({} as Client),
        daysUntilExpiry: calculateDaysUntilExpiry(getLoanCollectionDate(loan)),
        isOverdue: true
      }))
    );
    
    // Si es el primer día del mes, mostrar vencidos
    if (day === 1) {
      days.push({
        date: currentDate,
        dayOfMonth: day,
        dayOfWeek,
        loans: overdueLoans
      });
    } else {
      days.push({
        date: currentDate,
        dayOfMonth: day,
        dayOfWeek,
        loans: dailyLoans
      });
    }
  }
  
  return {
    year,
    month,
    monthName,
    days
  };
};

/**
 * Obtiene los clientes a cobrar hoy
 */
export const getTodayCollections = (
  loans: Loan[],
  clients: Map<string, Client>
): Array<{ loan: Loan; client: Client; daysUntilExpiry: number }> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return loans
    .filter(loan => {
      if (loan.status === 'PAID') return false;
      
      const daysUntil = calculateDaysUntilExpiry(getLoanCollectionDate(loan));
      // Mostrar los que vencen hoy y los que ya vencieron
      return daysUntil <= 0;
    })
    .map(loan => ({
      loan,
      client: clients.get(loan.clientId) || ({} as Client),
      daysUntilExpiry: calculateDaysUntilExpiry(getLoanCollectionDate(loan))
    }))
    .sort((a, b) => a.loan.collectorName.localeCompare(b.loan.collectorName));
};

/**
 * Obtiene las próximas cobranzas en los próximos N días
 */
export const getUpcomingCollections = (
  loans: Loan[],
  clients: Map<string, Client>,
  daysAhead: number = 7
): Array<{ date: Date; collections: Array<{ loan: Loan; client: Client }> }> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const upcoming = [];
  
  for (let i = 0; i <= daysAhead; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() + i);
    
    const dailyCollections = loans
      .filter(loan => {
        if (loan.status === 'PAID') return false;
        
        const expiryDate = new Date(getLoanCollectionDate(loan));
        expiryDate.setHours(0, 0, 0, 0);
        
        return expiryDate.getTime() === checkDate.getTime();
      })
      .map(loan => ({
        loan,
        client: clients.get(loan.clientId) || ({} as Client)
      }));
    
    if (dailyCollections.length > 0) {
      upcoming.push({
        date: new Date(checkDate),
        collections: dailyCollections
      });
    }
  }
  
  return upcoming;
};
