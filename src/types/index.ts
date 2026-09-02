export type Role = 'ADMIN' | 'COLLECTOR';
export type LoanStatus = 'ACTIVE' | 'FROZEN' | 'PAID' | 'CONGELADO' | 'ANULADO';
export type LoanType =
  | 'PRESTAMO'
  | 'EMPENO'
  | 'PRESTACION_SERVICIOS'
  | 'ALQUILER_INMUEBLE'
  | 'CELULAR'
  | 'CONGELADO';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type CollectionManagementStatus = 'PENDING' | 'MANAGED';
export type PaymentType = 'CAPITAL' | 'INTEREST' | 'MIXED';
export type PlanFrecuencia = 'ANUAL' | 'MENSUAL';

export type CurrencyCode = 'PYG' | 'USD';

export interface BaseDocument {
  id?: string;
  companyId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface User extends BaseDocument {
  uid: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export interface Client extends BaseDocument {
  fullName: string;
  fullNameLower?: string;
  documentId: string;
  documentSearch?: string;
  collectorId?: string;
  collectorName?: string;
  birthDate?: string;
  nationality?: string;
  phone: string;
  phoneSearch?: string;
  email?: string;
  address: string;
  city: string;
  neighborhood?: string;
  housingType: 'PROPIA' | 'ALQUILADA' | 'FAMILIAR';
  workplaceName: string;
  workplaceAddress?: string;
  workplaceCity?: string;
  workplaceNeighborhood?: string;
  seniority: string;
  employmentStatus: 'PROPIETARIO' | 'EMPLEADO' | 'INDEPENDIENTE';
  workPhone: string;
  position: string;
  department?: string;
  references: Array<{
    name: string;
    relationship: string;
    workplace: string;
    phone: string;
  }>;
  location: {
    latitude: number;
    longitude: number;
    googleMapsUrl?: string;
  };
}

export interface Loan extends BaseDocument {
  clientId: string;
  clientName?: string;
  clientNameLower?: string;
  clientDocumentId?: string;
  clientPhone?: string;
  clientAddress?: string;
  collectorId: string;
  collectorName: string;
  principal: number;
  currency: CurrencyCode;
  interestRate: number;
  cycleDays?: number;
  loanType: LoanType;
  description?: string;
  pawnDescription?: string;
  totalAmount: number;
  paidAmount: number;
  currentBalance: number;
  saldoInicial?: number;
  saldoDefinitivo?: number;
  saldoProvisorio?: number;
  totalPagadoAprobado?: number;
  totalPendienteAprobacion?: number;
  tienePagosPendientes?: boolean;
  estadoCobranza?: 'activo' | 'pendiente_rendicion' | 'pendiente_aprobacion' | 'pagado';
  ultimoPagoPendienteAt?: number;
  ultimoPagoPendienteId?: string;
  interestPaidAmount?: number;
  accruedInterestBalance?: number;
  accruedLateFeeBalance?: number;
  nextDueDate?: number;
  lastAccruedAt?: number;
  refinancingCount?: number;
  status: LoanStatus;
  approvalStatus?: ApprovalStatus;
  approvedAt?: number;
  approvedBy?: string;
  inforconfConfirmedAt?: number;
  inforconfConfirmedBy?: string;
  hasPagare?: boolean;
  origen?: LoanOrigen;
  planFrecuencia?: PlanFrecuencia;
  cantidadCuotas?: number;
  montoCuota?: number;
  isLocatable?: boolean;
  creditDate?: number;
  grantedAt: number;
  expiresAt: number;
  commissionRate: number;
  anuladoAt?: number;
  anuladoBy?: string;
  anulacionRazon?: string;
}

export interface Payment extends BaseDocument {
  loanId: string;
  clientId: string;
  clientName?: string;
  clientNameLower?: string;
  clientDocumentId?: string;
  collectorId: string;
  collectorName: string;
  paymentType?: PaymentType;
  currency?: CurrencyCode;
  paidAt?: number;
  amount: number;
  previousBalance: number;
  newBalance: number;
  principalApplied?: number;
  interestApplied?: number;
  interestDueAtPayment?: number;
  lateFeeDueAtPayment?: number;
  arrearsApplied: number;
  resultingInterestBalance?: number;
  resultingLateFeeBalance?: number;
  nextDueDateAfterPayment?: number;
  lastAccruedAtAfterPayment?: number;
  refinancingApplied?: number;
  refinancingCycles?: number;
  interestCharged?: number;
  commissionAmount: number;
  approvalStatus?: ApprovalStatus;
  estadoRendicion?: 'pendiente_rendicion' | 'pendiente_aprobacion' | 'aprobado' | 'rechazado' | 'anulado';
  anuladoAt?: number;
  anuladoBy?: string;
  anulacionRazon?: string;
  approvedAt?: number;
  approvedBy?: string;
  approvedByName?: string;
  loanImpactApplied?: boolean;
}

export interface CollectorStatement extends BaseDocument {
  collectorId: string;
  collectorName: string;
  period: string;
  creditsGiven: number;
  amountGiven: number;
  amountCollected: number;
  commissionsEarned: number;
}

export interface CollectionManagement extends BaseDocument {
  loanId: string;
  clientId: string;
  collectorId: string;
  collectorName: string;
  dueDate: number;
  status: CollectionManagementStatus;
  managedAt?: number;
  managedBy: string;
  managedByName: string;
  contactedAt?: number;
  contactedBy?: string;
  contactedByName?: string;
}

export interface SlotMachineSite extends BaseDocument {
  name: string;
  locationName: string;
  address?: string;
  collectorId: string;
  collectorName: string;
  commissionRate: number;
  isActive: boolean;
}

export interface SlotMachineEntry extends BaseDocument {
  siteId: string;
  siteName: string;
  locationName: string;
  collectorId: string;
  collectorName: string;
  collectionDate: number;
  amount: number;
  commissionRate?: number;
  commissionAmount: number;
  approvalStatus?: ApprovalStatus;
  approvedAt?: number;
  approvedBy?: string;
  approvedByName?: string;
  notes?: string;
}

export type LoanOrigen =
  | 'sistema_creditos'
  | 'empeno'
  | 'alquiler'
  | 'prestacion_servicios'
  | 'juridico'
  | 'pos';

export type PagareStatus = 'activo' | 'cancelado';

export interface Pagare extends BaseDocument {
  loanId?: string;
  nombre: string;
  nombreLower?: string;
  cedula: string;
  cedulaSearch?: string;
  monto: number;
  tomo: string;
  cobrador?: string;
  estado: PagareStatus;
  entregadoAt?: number;
  entregadoBy?: string;
  entregadoByName?: string;
}

