import { getCreditInfo, getBadgeClass } from '../utils/loanUtils';

interface CreditStatusBadgeProps {
  expiresAt: number;
  inforconfConfirmedAt?: number;
  paidAmount?: number;
  currentBalance?: number;
  compact?: boolean;
}

export default function CreditStatusBadge({
  expiresAt,
  inforconfConfirmedAt,
  paidAmount = 0,
  currentBalance = 0,
  compact = false,
}: CreditStatusBadgeProps) {
  const creditInfo = getCreditInfo(expiresAt, inforconfConfirmedAt);

  // Si está pagado, mostrar verde
  if (paidAmount > 0 && currentBalance === 0) {
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getBadgeClass('green')}`}>
        ✓ PAGADO
      </span>
    );
  }

  if (compact) {
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getBadgeClass(creditInfo.color)}`}>
        {creditInfo.status}
      </span>
    );
  }

  return (
    <div className="flex items-center space-x-2">
      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getBadgeClass(creditInfo.color)}`}>
        {creditInfo.status}
      </span>
      <span className="text-xs text-gray-600">
        {creditInfo.label}
      </span>
    </div>
  );
}
