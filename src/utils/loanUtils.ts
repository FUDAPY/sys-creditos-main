export type CreditColor = 'green' | 'yellow' | 'orange' | 'red';
export type CreditStatus = 'BUENO' | 'INFORCONF' | 'PREJUDICIAL' | 'JUDICIAL';

interface CreditInfo {
  daysLate: number;
  color: CreditColor;
  status: CreditStatus;
  label: string;
}

export const calculateDaysLate = (expiresAt: number): number => {
  const now = Date.now();
  const daysMs = expiresAt - now;
  const days = Math.ceil(daysMs / (1000 * 60 * 60 * 24));
  return Math.max(0, -days);
};

export const getCreditInfo = (
  expiresAt: number,
  inforconfConfirmedAt?: number
): CreditInfo => {
  const daysLate = calculateDaysLate(expiresAt);

  if (daysLate === 0) {
    return {
      daysLate: 0,
      color: 'green',
      status: 'BUENO',
      label: 'Al dia',
    };
  }

  if (daysLate <= 30) {
    return {
      daysLate,
      color: 'green',
      status: 'BUENO',
      label: `${daysLate} dias de atraso`,
    };
  }

  if (!inforconfConfirmedAt || daysLate <= 60) {
    return {
      daysLate,
      color: 'yellow',
      status: 'INFORCONF',
      label: !inforconfConfirmedAt
        ? `${daysLate} dias de atraso (pendiente confirmar Inforconf)`
        : `${daysLate} dias de atraso`,
    };
  }

  if (daysLate <= 90) {
    return {
      daysLate,
      color: 'orange',
      status: 'PREJUDICIAL',
      label: `${daysLate} dias de atraso`,
    };
  }

  return {
    daysLate,
    color: 'red',
    status: 'JUDICIAL',
    label: `${daysLate} dias de atraso`,
  };
};

export const getColorClass = (color: CreditColor): string => {
  const colorMap = {
    green: 'bg-green-100 border-green-300 text-green-800',
    yellow: 'bg-yellow-100 border-yellow-300 text-yellow-800',
    orange: 'bg-orange-100 border-orange-300 text-orange-800',
    red: 'bg-red-100 border-red-300 text-red-800',
  };
  return colorMap[color];
};

export const getBadgeClass = (color: CreditColor): string => {
  const badgeMap = {
    green: 'bg-green-500 text-white',
    yellow: 'bg-yellow-500 text-white',
    orange: 'bg-orange-500 text-white',
    red: 'bg-red-500 text-white',
  };
  return badgeMap[color];
};

export const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

export const getDaysRemaining = (expiresAt: number): number => {
  const now = Date.now();
  const daysMs = expiresAt - now;
  return Math.ceil(daysMs / (1000 * 60 * 60 * 24));
};
