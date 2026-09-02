import type { CurrencyCode } from '../types';

export const getCurrencySymbol = (currency: CurrencyCode = 'PYG') =>
  currency === 'USD' ? 'USD' : 'Gs.';

export const formatCurrencyAmount = (amount: number, currency: CurrencyCode = 'PYG') =>
  `${getCurrencySymbol(currency)} ${amount.toLocaleString('es-PY')}`;
