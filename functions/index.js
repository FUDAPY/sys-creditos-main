const fs = require("fs");
const path = require("path");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: "southamerica-east1",
  maxInstances: 10,
});

const COMPANY_ID = "lin_group_sa_001";
const COMPANY_NAME = "LIN GROUP S.A.";
const SYSTEM_NAME = "SysCreditos";
const DAY_MS = 1000 * 60 * 60 * 24;
const DEFAULT_INTEREST_RATE = 20;
const DEFAULT_CYCLE_DAYS = 30;
const HEALTH_DOCUMENT_PATH = "health/status";
const FINANCIAL_APP_NAME = "financial-target";
const FINANCIAL_SERVICE_ACCOUNT_CANDIDATES = [
  path.join(__dirname, "secrets", "financial-service-account.json"),
  path.join(__dirname, "secrets", "sys-financiero-firebase-adminsdk-fbsvc-89d4fee165.json"),
  path.join(__dirname, "secrets", "sys-financiero-firebase-adminsdk-fbsvc-b2d437ad43.json"),
];
const FINANCIAL_BRANCH_ID = process.env.FINANCIAL_BRANCH_ID || "syscreditos";
const FINANCIAL_BRANCH_NAME = process.env.FINANCIAL_BRANCH_NAME || SYSTEM_NAME;
const FINANCIAL_COMPANY_DOC_ID = process.env.FINANCIAL_COMPANY_DOC_ID || "general_data";

function getDb() {
  return admin.firestore();
}

function getAuth() {
  return admin.auth();
}

function getFinancialServiceAccountPath() {
  return FINANCIAL_SERVICE_ACCOUNT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function hasFinancialCredentials() {
  return Boolean(getFinancialServiceAccountPath());
}

function getFinancialApp() {
  if (!hasFinancialCredentials()) {
    throw new Error("No se encontro la credencial del Firebase financiero.");
  }

  const existing = admin.apps.find((app) => app.name === FINANCIAL_APP_NAME);
  if (existing) {
    return existing;
  }

  const serviceAccountPath = getFinancialServiceAccountPath();
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    },
    FINANCIAL_APP_NAME
  );
}

function getFinancialDb() {
  return admin.firestore(getFinancialApp());
}

const POS_APP_NAME = "pos-target";
const POS_SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "secrets",
  "sys-pos-erp-lingroup-firebase-adminsdk-fbsvc-61956b03b8.json"
);

function hasPosCredentials() {
  return fs.existsSync(POS_SERVICE_ACCOUNT_PATH);
}

function getPosApp() {
  if (!hasPosCredentials()) {
    throw new Error("No se encontro la credencial del Firebase POS.");
  }
  const existing = admin.apps.find((app) => app.name === POS_APP_NAME);
  if (existing) return existing;

  const serviceAccount = JSON.parse(fs.readFileSync(POS_SERVICE_ACCOUNT_PATH, "utf8"));
  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    },
    POS_APP_NAME
  );
}

function getPosDb() {
  return admin.firestore(getPosApp());
}

const JURIDICO_APP_NAME = "juridico-target";
const JURIDICO_SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "secrets",
  "sys-juridico-firebase-adminsdk-fbsvc-5182ed1dfc.json"
);

function hasJuridicoCredentials() {
  return fs.existsSync(JURIDICO_SERVICE_ACCOUNT_PATH);
}

function getJuridicoApp() {
  if (!hasJuridicoCredentials()) {
    throw new Error("No se encontro la credencial del Firebase Juridico.");
  }
  const existing = admin.apps.find((app) => app.name === JURIDICO_APP_NAME);
  if (existing) return existing;

  const serviceAccount = JSON.parse(fs.readFileSync(JURIDICO_SERVICE_ACCOUNT_PATH, "utf8"));
  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    },
    JURIDICO_APP_NAME
  );
}

function getJuridicoDb() {
  return admin.firestore(getJuridicoApp());
}

function buildSyncedClient({ id, name, documentId, phone, email, sourceSystem }) {
  const now = Date.now();
  return {
    id,
    companyId: COMPANY_ID,
    fullName: String(name || "Cliente sincronizado").trim(),
    fullNameLower: String(name || "Cliente sincronizado").trim().toLowerCase(),
    documentId: String(documentId || id).trim(),
    documentSearch: String(documentId || id).trim().toLowerCase(),
    phone: String(phone || "").trim(),
    phoneSearch: String(phone || "").trim(),
    email: String(email || "").trim(),
    address: "",
    city: "",
    housingType: "FAMILIAR",
    workplaceName: sourceSystem,
    seniority: "",
    employmentStatus: "INDEPENDIENTE",
    workPhone: "",
    position: "",
    references: [],
    location: { latitude: 0, longitude: 0, googleMapsUrl: "" },
    sourceSystem,
    sourceId: id,
    updatedAt: now,
    createdAt: now,
    createdBy: "system-sync",
  };
}

async function getFirstNonEmptyCollection(firestore, collectionNames) {
  for (const collectionName of collectionNames) {
    const snapshot = await firestore.collection(collectionName).get();
    if (!snapshot.empty) return { collectionName, snapshot };
  }
  return { collectionName: null, snapshot: { docs: [], size: 0, empty: true } };
}

function getSourceAmount(data) {
  return Number(data.amount || data.monto || data.importe || data.total || data.valor || 0);
}

function getSourceDate(data) {
  return normalizeTimestampMillis(
    data.paidAt || data.fechaPago || data.collectionDate || data.fecha || data.createdAt
  );
}

async function syncExternalPayments({ firestore, sourceSystem, origin, loanIdBySourceId }) {
  const { collectionName, snapshot } = await getFirstNonEmptyCollection(firestore, [
    "payments",
    "pagos",
    "cobros",
    "collections",
    "transactions",
  ]);
  if (!collectionName) return 0;

  const db = getDb();
  let syncedCount = 0;
  for (const paymentDoc of snapshot.docs) {
    const data = paymentDoc.data();
    const sourceLoanId = String(data.loanId || data.creditId || data.creditoId || data.debtId || "");
    const loanId = loanIdBySourceId[sourceLoanId] || `${origin}_${sourceLoanId}`;
    const amount = getSourceAmount(data);
    if (!sourceLoanId || amount <= 0 || !loanIdBySourceId[sourceLoanId]) continue;

    const paymentId = `${origin}_payment_${paymentDoc.id}`;
    const paymentDate = getSourceDate(data);
    await db.doc(`companies/${COMPANY_ID}/payments/${paymentId}`).set(
      {
        id: paymentId,
        companyId: COMPANY_ID,
        loanId,
        clientId: data.clientId || data.clienteId || `${origin}_${data.userId || sourceLoanId}`,
        clientName: data.clientName || data.cliente || data.nombre || "Cliente sincronizado",
        collectorId: data.collectorId || `system-${origin}`,
        collectorName: data.collectorName || sourceSystem,
        currency: data.currency || data.moneda || "PYG",
        paymentType: data.paymentType || "MIXED",
        paidAt: paymentDate,
        amount,
        previousBalance: Number(data.previousBalance || data.saldoAnterior || amount),
        newBalance: Number(data.newBalance || data.saldoNuevo || 0),
        principalApplied: Number(data.principalApplied || data.capital || 0),
        interestApplied: Number(data.interestApplied || data.interes || 0),
        arrearsApplied: Number(data.arrearsApplied || data.mora || 0),
        commissionAmount: Number(data.commissionAmount || 0),
        approvalStatus: "APPROVED",
        estadoRendicion: "aprobado",
        loanImpactApplied: true,
        sourceSystem,
        sourceOrigin: origin,
        sourceCollection: collectionName,
        sourceId: paymentDoc.id,
        sourceData: data,
        createdAt: paymentDate,
        updatedAt: Date.now(),
        createdBy: "system-sync",
      },
      { merge: true }
    );
    syncedCount++;
  }
  return syncedCount;
}

function getSourceProjectId() {
  return admin.app().options.projectId || "sys-creditos-lingroup";
}

function normalizeTimestampMillis(value, fallback = Date.now()) {
  if (value && typeof value.toMillis === "function") {
    return normalizeTimestampMillis(value.toMillis(), fallback);
  }

  if (value && typeof value.seconds === "number") {
    return normalizeTimestampMillis(value.seconds, fallback);
  }

  if (value && typeof value._seconds === "number") {
    return normalizeTimestampMillis(value._seconds, fallback);
  }

  let numericValue = Number(value);
  if (typeof value === "string" && Number.isNaN(numericValue)) {
    numericValue = Date.parse(value);
  }
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;

  // Normalize to milliseconds, then constrain to a valid Firestore date.
  if (numericValue < 100000000000) numericValue *= 1000;
  while (numericValue > 4102444800000) numericValue /= 1000;
  if (numericValue < 0 || numericValue > 4102444800000) return fallback;
  return Math.round(numericValue);
}

function normalizeTimestampToUtcNoon(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    12,
    0,
    0,
    0
  );
}

function getLoanCycleDays(loan) {
  if (Number.isFinite(loan.cycleDays) && loan.cycleDays > 0) {
    return loan.cycleDays;
  }

  if (Number.isFinite(loan.grantedAt) && Number.isFinite(loan.expiresAt)) {
    const derivedDays = Math.round((loan.expiresAt - loan.grantedAt) / DAY_MS);
    if (derivedDays > 0) {
      return derivedDays;
    }
  }

  return DEFAULT_CYCLE_DAYS;
}

function getCalendarMonthSpanFromDays(days) {
  return Math.max(1, Math.round((days || DEFAULT_CYCLE_DAYS) / 30));
}

function addUtcMonthsPreservingDay(timestamp, months) {
  const date = new Date(timestamp);
  const targetYear = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() + months;
  const targetDay = date.getUTCDate();
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0, 12, 0, 0, 0)
  ).getUTCDate();

  return Date.UTC(
    targetYear,
    targetMonthIndex,
    Math.min(targetDay, lastDayOfTargetMonth),
    12,
    0,
    0,
    0
  );
}

function calculateInterestAmount(loan) {
  if (loan.loanType === "ALQUILER_INMUEBLE" || loan.loanType === "PRESTACION_SERVICIOS") {
    return 0;
  }
  const rate =
    Number.isFinite(loan.interestRate) && loan.interestRate >= 0
      ? loan.interestRate
      : DEFAULT_INTEREST_RATE;
  const principal = Number.isFinite(loan.principal) ? loan.principal : 0;
  return Math.round(principal * (rate / 100));
}

function normalizePrincipalBalance(loan) {
  const principal = Number.isFinite(loan.principal) ? loan.principal : 0;
  const currentBalance = Number.isFinite(loan.currentBalance) ? loan.currentBalance : principal;
  return Math.max(0, Math.min(currentBalance, principal));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function assertAdminCaller(authData) {
  const db = getDb();

  if (!authData?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion para realizar esta accion.");
  }

  const userDoc = await db.doc(`companies/${COMPANY_ID}/users/${authData.uid}`).get();

  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "No se encontro el perfil del administrador.");
  }

  const userData = userDoc.data();
  if (!userData || userData.role !== "ADMIN" || userData.isActive !== true) {
    throw new HttpsError("permission-denied", "Solo los administradores pueden ejecutar esta accion.");
  }

  return userData;
}

async function ensureFinancialBranch(financialDb) {
  const now = Date.now();
  await financialDb.doc(`companies/${FINANCIAL_COMPANY_DOC_ID}`).set(
    {
      id: FINANCIAL_COMPANY_DOC_ID,
      updatedAt: now,
      sourceSystem: SYSTEM_NAME,
    },
    { merge: true }
  );

  await financialDb.doc(`companies/${FINANCIAL_COMPANY_DOC_ID}/branches/${FINANCIAL_BRANCH_ID}`).set(
    {
      id: FINANCIAL_BRANCH_ID,
      name: FINANCIAL_BRANCH_NAME,
      companyId: COMPANY_ID,
      companyName: COMPANY_NAME,
      sourceSystem: SYSTEM_NAME,
      sourceProjectId: getSourceProjectId(),
      status: "ACTIVE",
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );
}

let cachedExchangeRate = null;
let cachedExchangeRateAt = 0;

async function getUsdToPygRate() {
  const now = Date.now();
  if (cachedExchangeRate && now - cachedExchangeRateAt < 15 * 60 * 1000) {
    return cachedExchangeRate;
  }

  const endpoint = process.env.GOOGLE_EXCHANGE_RATE_URL;
  if (!endpoint) {
    throw new Error("Falta GOOGLE_EXCHANGE_RATE_URL para convertir USD a PYG.");
  }

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`El conversor de Google respondio con HTTP ${response.status}.`);
  }

  const payload = await response.json();
  const rate = Number(payload.rate || payload.usdToPyg || payload.USD_PYG);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("El conversor de Google devolvio una cotizacion invalida.");
  }

  cachedExchangeRate = rate;
  cachedExchangeRateAt = now;
  return rate;
}

async function convertMovementAmountToPyg(amount, currency) {
  const numericAmount = Math.round(Number(amount || 0));
  if (currency !== "USD") {
    return { amountPyg: numericAmount, exchangeRate: 1 };
  }

  const exchangeRate = await getUsdToPygRate();
  return {
    amountPyg: Math.round(numericAmount * exchangeRate),
    exchangeRate,
  };
}

async function buildIncomeMovement(payment) {
  const businessDate = normalizeTimestampMillis(
    payment.paidAt || payment.approvedAt || payment.createdAt
  );
  const isoDate = new Date(businessDate).toISOString().slice(0, 10);
  const systemEmail = "syscreditos@otelax.local";
  const originalCurrency = payment.currency || "PYG";
  const converted = await convertMovementAmountToPyg(payment.amount, originalCurrency);

  return {
    id: `INGRESO_${payment.id}`,
    idempotencyKey: `sys-creditos:payments:${payment.id}:INGRESO`,
    branchId: FINANCIAL_BRANCH_ID,
    branchName: FINANCIAL_BRANCH_NAME,
    branch: FINANCIAL_BRANCH_NAME,
    local: FINANCIAL_BRANCH_NAME,
    movementType: "INGRESO",
    type: "ingreso",
    tipo: "INGRESO",
    category: "COBRO_RENDIDO",
    concept: `Cobro rendido ${payment.collectorName || ""}`.trim(),
    concepto: `Cobro rendido ${payment.collectorName || ""}`.trim(),
    sourceSystem: SYSTEM_NAME,
    sourceProjectId: getSourceProjectId(),
    sourceCompanyId: COMPANY_ID,
    sourceOrigin: payment.origen || "sistema_creditos",
    sourceCollection: "payments",
    sourceId: payment.id,
    paymentId: payment.id,
    loanId: payment.loanId,
    clientId: payment.clientId || null,
    collectorId: payment.collectorId || null,
    collectorName: payment.collectorName || null,
    currency: "PYG",
    originalCurrency,
    originalAmount: Math.round(payment.amount || 0),
    exchangeRateUsdToPyg: converted.exchangeRate,
    amount: converted.amountPyg,
    monto: converted.amountPyg,
    principalApplied: Math.round(payment.principalApplied || 0),
    interestApplied: Math.round(payment.interestApplied || 0),
    lateFeeApplied: Math.round(payment.arrearsApplied || 0),
    businessDate,
    date: isoDate,
    fecha: businessDate,
    movementDate: businessDate,
    timestamp: admin.firestore.Timestamp.fromMillis(businessDate),
    user_email: payment.collectorEmail || systemEmail,
    createdAt: normalizeTimestampMillis(payment.createdAt, businessDate),
    updatedAt: Date.now(),
    status: "CONFIRMED",
  };
}

async function buildExpenseMovement(loan) {
  const businessDate = normalizeTimestampMillis(
    loan.grantedAt || loan.approvedAt || loan.createdAt
  );
  const isoDate = new Date(businessDate).toISOString().slice(0, 10);
  const systemEmail = "syscreditos@otelax.local";
  const originalCurrency = loan.currency || "PYG";
  const converted = await convertMovementAmountToPyg(loan.principal, originalCurrency);

  return {
    id: `EGRESO_${loan.id}`,
    idempotencyKey: `sys-creditos:loans:${loan.id}:EGRESO`,
    branchId: FINANCIAL_BRANCH_ID,
    branchName: FINANCIAL_BRANCH_NAME,
    branch: FINANCIAL_BRANCH_NAME,
    local: FINANCIAL_BRANCH_NAME,
    movementType: "EGRESO",
    type: "egreso",
    tipo: "EGRESO",
    category: "CREDITO_OTORGADO",
    concept: `Credito otorgado ${loan.clientName || ""}`.trim(),
    concepto: `Credito otorgado ${loan.clientName || ""}`.trim(),
    sourceSystem: SYSTEM_NAME,
    sourceProjectId: getSourceProjectId(),
    sourceCompanyId: COMPANY_ID,
    sourceOrigin: loan.origen || "sistema_creditos",
    sourceCollection: "loans",
    sourceId: loan.id,
    loanId: loan.id,
    clientId: loan.clientId || null,
    collectorId: loan.collectorId || null,
    collectorName: loan.collectorName || null,
    currency: "PYG",
    originalCurrency,
    originalAmount: Math.round(loan.principal || 0),
    exchangeRateUsdToPyg: converted.exchangeRate,
    amount: converted.amountPyg,
    monto: converted.amountPyg,
    loanType: loan.loanType || "PRESTAMO",
    businessDate,
    date: isoDate,
    fecha: businessDate,
    movementDate: businessDate,
    timestamp: admin.firestore.Timestamp.fromMillis(businessDate),
    user_email: loan.collectorEmail || systemEmail,
    createdAt: normalizeTimestampMillis(loan.createdAt, businessDate),
    updatedAt: Date.now(),
    status: "CONFIRMED",
  };
}

async function upsertFinancialMovement(movement) {
  const financialDb = getFinancialDb();
  await ensureFinancialBranch(financialDb);
  await financialDb
    .doc(`companies/${FINANCIAL_COMPANY_DOC_ID}/movements/${movement.id}`)
    .set(movement, { merge: true });
}

async function deleteFinancialMovement(movementId) {
  const financialDb = getFinancialDb();
  await financialDb.doc(`companies/${FINANCIAL_COMPANY_DOC_ID}/movements/${movementId}`).delete();
}

async function syncPaymentMovementById(paymentId) {
  const db = getDb();
  const paymentDoc = await db.doc(`companies/${COMPANY_ID}/payments/${paymentId}`).get();

  if (!paymentDoc.exists) {
    await deleteFinancialMovement(`INGRESO_${paymentId}`);
    return { synced: false, deleted: true };
  }

  const payment = { id: paymentDoc.id, ...paymentDoc.data() };
  const isApproved =
    (payment.approvalStatus || "APPROVED") === "APPROVED" &&
    payment.estadoRendicion !== "anulado";

  if (!isApproved) {
    await deleteFinancialMovement(`INGRESO_${paymentId}`);
    return { synced: false, deleted: true };
  }

  await upsertFinancialMovement(await buildIncomeMovement(payment));
  return { synced: true, deleted: false };
}

async function syncLoanMovementById(loanId) {
  const db = getDb();
  const loanDoc = await db.doc(`companies/${COMPANY_ID}/loans/${loanId}`).get();

  if (!loanDoc.exists) {
    await deleteFinancialMovement(`EGRESO_${loanId}`);
    return { synced: false, deleted: true };
  }

  const loan = { id: loanDoc.id, ...loanDoc.data() };
  const isApproved = (loan.approvalStatus || "APPROVED") === "APPROVED";

  if (!isApproved) {
    await deleteFinancialMovement(`EGRESO_${loanId}`);
    return { synced: false, deleted: true };
  }

  await upsertFinancialMovement(await buildExpenseMovement(loan));
  return { synced: true, deleted: false };
}

exports.health = onRequest(async (_request, response) => {
  try {
    const db = getDb();
    const healthRef = db.doc(HEALTH_DOCUMENT_PATH);
    const healthSnap = await healthRef.get();

    response.status(200).json({
      ok: true,
      projectId: getSourceProjectId(),
      companyId: COMPANY_ID,
      firestore: {
        enabled: true,
        healthDocumentPath: HEALTH_DOCUMENT_PATH,
        healthDocumentExists: healthSnap.exists,
      },
      storage: {
        enabled: true,
        bucket:
          admin.app().options.storageBucket ||
          "sys-creditos-lingroup.firebasestorage.app",
      },
      financialSync: {
        enabled: hasFinancialCredentials(),
        branchId: FINANCIAL_BRANCH_ID,
        branchName: FINANCIAL_BRANCH_NAME,
        companyDocId: FINANCIAL_COMPANY_DOC_ID,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Health endpoint error:", error);
    response.status(500).json({
      ok: false,
      projectId: getSourceProjectId(),
      error: "health_check_failed",
      timestamp: Date.now(),
    });
  }
});

exports.adminSetUserPassword = onCall(async (request) => {
  const adminUser = await assertAdminCaller(request.auth);
  const db = getDb();
  const auth = getAuth();
  const targetUid = String(request.data?.uid || "").trim();
  const newPassword = String(request.data?.newPassword || "").trim();

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Falta el usuario a modificar.");
  }

  if (newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "La contrasena debe tener al menos 6 caracteres.");
  }

  const targetDocRef = db.doc(`companies/${COMPANY_ID}/users/${targetUid}`);
  const targetDoc = await targetDocRef.get();

  if (!targetDoc.exists) {
    throw new HttpsError("not-found", "El usuario a modificar no existe.");
  }

  const targetUser = targetDoc.data() || {};

  try {
    await auth.updateUser(targetUid, { password: newPassword });
  } catch (error) {
    console.error("Error actualizando contrasena en Auth:", error);
    throw new HttpsError("internal", "No se pudo actualizar la contrasena en Firebase Auth.");
  }

  const now = Date.now();
  await db.collection(`companies/${COMPANY_ID}/auditLogs`).doc().set({
    companyId: COMPANY_ID,
    action: "ADMIN_SET_USER_PASSWORD",
    entity: "USER",
    entityId: targetUid,
    details: JSON.stringify({
      targetEmail: targetUser.email || null,
      targetName: targetUser.name || null,
      changedBy: adminUser.email || adminUser.name || request.auth.uid,
    }),
    createdBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  });

  return {
    success: true,
    message: "Contrasena actualizada correctamente.",
  };
});

exports.adminRebuildLoans = onCall(async (request) => {
  const adminUser = await assertAdminCaller(request.auth);
  const db = getDb();
  const applyChanges = request.data?.apply === true;
  const now = Date.now();
  const loansSnapshot = await db.collection(`companies/${COMPANY_ID}/loans`).get();

  const updates = [];
  const samples = [];

  loansSnapshot.forEach((loanDoc) => {
    const loan = loanDoc.data() || {};
    const cycleDays = getLoanCycleDays(loan);
    const cycleMonths = getCalendarMonthSpanFromDays(cycleDays);
    const grantedAtSource = loan.grantedAt || loan.creditDate || loan.createdAt || now;
    const grantedAt =
      normalizeTimestampToUtcNoon(grantedAtSource) || normalizeTimestampToUtcNoon(now);
    let expiresAt = addUtcMonthsPreservingDay(grantedAt, cycleMonths);

    if (expiresAt <= grantedAt) {
      expiresAt = addUtcMonthsPreservingDay(grantedAt, 1);
    }

    const principalBalance = normalizePrincipalBalance(loan);
    const interestPerCycle = calculateInterestAmount(loan);
    const hasAnyPayment =
      (Number.isFinite(loan.paidAmount) && loan.paidAmount > 0) ||
      (Number.isFinite(loan.interestPaidAmount) && loan.interestPaidAmount > 0);
    const storedNextDueDate = normalizeTimestampToUtcNoon(loan.nextDueDate || expiresAt);
    const nextDueDate =
      !hasAnyPayment || !storedNextDueDate || storedNextDueDate < expiresAt
        ? expiresAt
        : storedNextDueDate;
    const lastAccruedAt =
      !hasAnyPayment
        ? grantedAt
        : normalizeTimestampToUtcNoon(loan.lastAccruedAt || grantedAt) || grantedAt;

    let accruedInterestBalance = 0;
    if (principalBalance > 0) {
      if (Number.isFinite(loan.accruedInterestBalance) && loan.accruedInterestBalance > 0) {
        accruedInterestBalance = loan.accruedInterestBalance;
      } else if ((loan.interestPaidAmount || 0) > 0 && loan.accruedInterestBalance === 0) {
        accruedInterestBalance = 0;
      } else {
        accruedInterestBalance = interestPerCycle;
      }
    }

    const accruedLateFeeBalance = Math.max(
      0,
      Math.round(Number.isFinite(loan.accruedLateFeeBalance) ? loan.accruedLateFeeBalance : 0)
    );

    const status =
      principalBalance <= 0 && accruedInterestBalance <= 0 && accruedLateFeeBalance <= 0
        ? "PAID"
        : loan.status === "FROZEN"
          ? "FROZEN"
          : loan.status || "ACTIVE";

    const nextData = {
      grantedAt,
      creditDate: grantedAt,
      expiresAt,
      cycleDays,
      currentBalance: principalBalance,
      accruedInterestBalance,
      accruedLateFeeBalance,
      nextDueDate,
      lastAccruedAt,
      totalAmount: principalBalance + accruedInterestBalance + accruedLateFeeBalance,
      status,
      updatedAt: now,
    };

    const changedKeys = Object.entries(nextData)
      .filter(([key, value]) => loan[key] !== value)
      .map(([key]) => key);

    if (changedKeys.length > 0) {
      updates.push({
        ref: loanDoc.ref,
        data: nextData,
        id: loanDoc.id,
        changedKeys,
      });

      if (samples.length < 10) {
        samples.push({
          id: loanDoc.id,
          clientId: loan.clientId || null,
          changedKeys,
        });
      }
    }
  });

  if (applyChanges && updates.length > 0) {
    const groups = chunkArray(updates, 400);
    for (const group of groups) {
      const batch = db.batch();
      group.forEach((item) => batch.update(item.ref, item.data));
      await batch.commit();
    }
  }

  await db.collection(`companies/${COMPANY_ID}/auditLogs`).doc().set({
    companyId: COMPANY_ID,
    action: applyChanges ? "ADMIN_REBUILD_LOANS_APPLY" : "ADMIN_REBUILD_LOANS_PREVIEW",
    entity: "LOAN",
    entityId: "bulk",
    details: JSON.stringify({
      totalLoans: loansSnapshot.size,
      changedLoans: updates.length,
      sampleIds: samples.map((item) => item.id),
      executedBy: adminUser.email || adminUser.name || request.auth.uid,
    }),
    createdBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  });

  return {
    success: true,
    applyChanges,
    totalLoans: loansSnapshot.size,
    changedLoans: updates.length,
    samples,
  };
});

exports.adminSyncFinancialMovements = onCall(async (request) => {
  try {
    const adminUser = await assertAdminCaller(request.auth);
    const db = getDb();
    const applyChanges = request.data?.apply === true;

    if (!hasFinancialCredentials()) {
      throw new HttpsError(
        "failed-precondition",
        "Falta la credencial del Firebase financiero."
      );
    }

    const paymentsSnapshot = await db.collection(`companies/${COMPANY_ID}/payments`).get();

    const approvedPayments = paymentsSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter(
        (payment) =>
          (payment.approvalStatus || "APPROVED") === "APPROVED" &&
          payment.estadoRendicion !== "anulado"
      );
    const loansSnapshot = await db.collection(`companies/${COMPANY_ID}/loans`).get();
    const approvedLoans = loansSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter(
        (loan) =>
          (loan.approvalStatus || "APPROVED") === "APPROVED" &&
          loan.status !== "ANULADO"
      );

    if (applyChanges) {
    const movements = await Promise.all([
      ...approvedPayments.map((payment) => buildIncomeMovement(payment)),
      ...approvedLoans.map((loan) => buildExpenseMovement(loan)),
    ]);
    const groups = chunkArray(movements, 350);
    const financialDb = getFinancialDb();
    await ensureFinancialBranch(financialDb);

    for (const group of groups) {
      const batch = financialDb.batch();
      group.forEach((movement) => {
        batch.set(
          financialDb.doc(`companies/${FINANCIAL_COMPANY_DOC_ID}/movements/${movement.id}`),
          movement,
          { merge: true }
        );
      });
      await batch.commit();
    }
    }

    const now = Date.now();
    await db.collection(`companies/${COMPANY_ID}/auditLogs`).doc().set({
    companyId: COMPANY_ID,
    action: applyChanges ? "SYNC_FINANCIAL_APPLY" : "SYNC_FINANCIAL_PREVIEW",
    entity: "FINANCIAL",
    entityId: FINANCIAL_BRANCH_ID,
    details: JSON.stringify({
      branchId: FINANCIAL_BRANCH_ID,
      branchName: FINANCIAL_BRANCH_NAME,
      incomes: approvedPayments.length,
      expenses: approvedLoans.length,
      executedBy: adminUser.email || adminUser.name || request.auth.uid,
    }),
    createdBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
    });

    return {
      success: true,
      applyChanges,
      branchId: FINANCIAL_BRANCH_ID,
      branchName: FINANCIAL_BRANCH_NAME,
      incomesCount: approvedPayments.length,
      expensesCount: approvedLoans.length,
    };
  } catch (error) {
    console.error("adminSyncFinancialMovements failed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Error interno al sincronizar Financiero."
    );
  }
});

exports.syncFinancialPayment = onCall(async (request) => {
  await assertAdminCaller(request.auth);

  if (!hasFinancialCredentials()) {
    throw new HttpsError(
      "failed-precondition",
      "Falta la credencial del Firebase financiero."
    );
  }

  const paymentId = String(request.data?.paymentId || "").trim();
  if (!paymentId) {
    throw new HttpsError("invalid-argument", "Falta el paymentId.");
  }

  const result = await syncPaymentMovementById(paymentId);
  return { success: true, ...result, paymentId };
});

exports.syncFinancialLoan = onCall(async (request) => {
  await assertAdminCaller(request.auth);

  if (!hasFinancialCredentials()) {
    throw new HttpsError(
      "failed-precondition",
      "Falta la credencial del Firebase financiero."
    );
  }

  const loanId = String(request.data?.loanId || "").trim();
  if (!loanId) {
    throw new HttpsError("invalid-argument", "Falta el loanId.");
  }

  const result = await syncLoanMovementById(loanId);
  return { success: true, ...result, loanId };
});

exports.getFinancialDashboardSummary = onCall(async (request) => {
  await assertAdminCaller(request.auth);

  if (!hasFinancialCredentials()) {
    throw new HttpsError(
      "failed-precondition",
      "Falta la credencial del Firebase financiero."
    );
  }

  const startAt = Number(request.data?.startAt || 0);
  const endAt = Number(request.data?.endAt || Date.now());
  const currency = String(request.data?.currency || "ALL").toUpperCase();
  const financialDb = getFinancialDb();
  const movementsSnapshot = await financialDb
    .collection(`companies/${FINANCIAL_COMPANY_DOC_ID}/movements`)
    .get();

  const movements = movementsSnapshot.docs
    .map((movementDoc) => ({ id: movementDoc.id, ...movementDoc.data() }))
    .filter((movement) => {
      const movementDate = movement.businessDate || movement.createdAt || 0;
      const normalizedDate =
        typeof movementDate?.toMillis === "function"
          ? movementDate.toMillis()
          : Number(movementDate);
      return (
        normalizedDate >= startAt &&
        normalizedDate < endAt &&
        (currency === "ALL" || String(movement.currency || "PYG").toUpperCase() === currency)
      );
    });

  const summary = movements.reduce(
    (result, movement) => {
      const amount = Math.round(Number(movement.amount || movement.monto || 0));
      const type = String(movement.movementType || movement.tipo || "").toUpperCase();
      const origin = String(movement.sourceOrigin || movement.origen || "sistema_creditos");

      if (type === "INGRESO") result.income += amount;
      if (type === "EGRESO") result.expense += amount;
      result.byOrigin[origin] = (result.byOrigin[origin] || 0) + amount;
      return result;
    },
    { income: 0, expense: 0, byOrigin: {} }
  );

  return {
    success: true,
    startAt,
    endAt,
    currency,
    movementsCount: movements.length,
    income: summary.income,
    expense: summary.expense,
    net: summary.income - summary.expense,
    byOrigin: summary.byOrigin,
  };
});

exports.onPaymentWritten = onDocumentWritten(
  {
    document: "companies/{companyId}/payments/{paymentId}",
  },
  async (event) => {
    if (event.params.companyId !== COMPANY_ID) return;

    if (!hasFinancialCredentials()) {
      console.warn("Sin credencial financiera; se reintentara mediante sincronizacion manual.");
      return;
    }

    const paymentId = event.params.paymentId;
    if (!event.data?.after.exists) {
      await deleteFinancialMovement(`INGRESO_${paymentId}`);
      return;
    }

    await syncPaymentMovementById(paymentId);
  }
);

exports.onLoanWritten = onDocumentWritten(
  {
    document: "companies/{companyId}/loans/{loanId}",
  },
  async (event) => {
    if (event.params.companyId !== COMPANY_ID) return;

    if (!hasFinancialCredentials()) {
      console.warn("Sin credencial financiera; se reintentara mediante sincronizacion manual.");
      return;
    }

    const loanId = event.params.loanId;
    if (!event.data?.after.exists) {
      await deleteFinancialMovement(`EGRESO_${loanId}`);
      return;
    }

    await syncLoanMovementById(loanId);
  }
);

exports.syncPosInboundUsers = onCall(async (request) => {
  await assertAdminCaller(request.auth);
  if (!hasPosCredentials()) {
    throw new HttpsError("failed-precondition", "Falta la credencial del Firebase POS.");
  }

  const posDb = getPosDb();
  const db = getDb();
  const posUsersSnap = await posDb.collection("users").get();
  let replicatedCount = 0;
  let clientsCount = 0;
  const loanIdBySourceId = {};

  for (const userDoc of posUsersSnap.docs) {
    const userData = userDoc.data();
    const debt = Number(userData.deuda || userData.saldoDeudor || 0);
    const clientId = `pos_${userDoc.id}`;
    loanIdBySourceId[userDoc.id] = clientId;
    const clientRef = db.doc(`companies/${COMPANY_ID}/clients/${clientId}`);
    const loanRef = db.doc(`companies/${COMPANY_ID}/loans/${clientId}`);
    const client = buildSyncedClient({
      id: clientId,
      name: userData.nombre || userData.name,
      documentId: userData.documento || userData.documentId || userDoc.id,
      phone: userData.telefono || userData.phone,
      email: userData.email,
      sourceSystem: "POS",
    });

    await clientRef.set(client, { merge: true });
    clientsCount++;

    const now = Date.now();
    await loanRef.set(
      {
        id: clientId,
        companyId: COMPANY_ID,
        clientId,
        clientName: client.fullName,
        clientDocumentId: client.documentId,
        clientPhone: client.phone,
        principal: debt,
        currentBalance: debt,
        totalAmount: debt,
        saldoInicial: debt,
        saldoDefinitivo: debt,
        saldoProvisorio: debt,
        origen: "pos",
        loanType: "POS",
        status: debt > 0 ? "ACTIVE" : "PAID",
        approvalStatus: "APPROVED",
        currency: userData.moneda || "PYG",
        interestRate: 0,
        commissionRate: 0,
        collectorId: userData.collectorId || "system-pos",
        collectorName: userData.collectorName || "POS",
        grantedAt: Number(userData.createdAt || now),
        expiresAt: Number(userData.expiresAt || now),
        updatedAt: now,
        createdAt: Number(userData.createdAt || now),
        createdBy: "system-sync",
        sourceSystem: "POS",
        sourceId: userDoc.id,
        sourceData: userData,
      },
      { merge: true }
    );
    replicatedCount++;
  }

  const paymentsCount = await syncExternalPayments({
    firestore: posDb,
    sourceSystem: "POS",
    origin: "pos",
    loanIdBySourceId,
  });

  return { success: true, replicatedCount, clientsCount, paymentsCount };
});

exports.syncJuridicoInboundCredits = onCall(async (request) => {
  await assertAdminCaller(request.auth);
  if (!hasJuridicoCredentials()) {
    throw new HttpsError("failed-precondition", "Falta la credencial del Firebase Juridico.");
  }

  const juridicoDb = getJuridicoDb();
  const db = getDb();
  const juridicoSnap = await juridicoDb.collection("estudio_juridico/oficina_central/creditos").get();
  let replicatedCount = 0;
  let clientsCount = 0;
  const loanIdBySourceId = {};

  for (const creditDoc of juridicoSnap.docs) {
    const data = creditDoc.data();
    const total = Number(data.montoTotal || data.principal || 0);
    const balance = Number(data.saldoPendiente || data.currentBalance || total);
    const clientId = `juridico_${creditDoc.id}`;
    loanIdBySourceId[creditDoc.id] = clientId;
    const clientRef = db.doc(`companies/${COMPANY_ID}/clients/${clientId}`);
    const client = buildSyncedClient({
      id: clientId,
      name: data.cliente || data.clientName,
      documentId: data.cedula || data.documentId || creditDoc.id,
      phone: data.telefono || data.phone,
      email: data.email,
      sourceSystem: "JURIDICO",
    });

    await clientRef.set(client, { merge: true });
    clientsCount++;

    const targetDocRef = db.doc(`companies/${COMPANY_ID}/loans/${clientId}`);
    await targetDocRef.set(
      {
        id: clientId,
        companyId: COMPANY_ID,
        clientId,
        clientName: client.fullName,
        clientDocumentId: client.documentId,
        clientPhone: client.phone,
        principal: total,
        currentBalance: balance,
        totalAmount: total,
        origen: "juridico",
        loanType: "JURIDICO",
        status: balance > 0 ? "ACTIVE" : "PAID",
        approvalStatus: "APPROVED",
        currency: data.moneda || "PYG",
        interestRate: Number(data.interestRate || 0),
        commissionRate: 0,
        collectorId: data.collectorId || "system-juridico",
        collectorName: data.collectorName || "Juridico",
        grantedAt: Date.now(),
        expiresAt: Number(data.expiresAt || Date.now()),
        updatedAt: Date.now(),
        createdAt: Date.now(),
        createdBy: "system-sync",
        sourceSystem: "JURIDICO",
        sourceId: creditDoc.id,
        sourceData: data,
      },
      { merge: true }
    );
    replicatedCount++;
  }

  const paymentsCount = await syncExternalPayments({
    firestore: juridicoDb,
    sourceSystem: "JURIDICO",
    origin: "juridico",
    loanIdBySourceId,
  });

  return { success: true, replicatedCount, clientsCount, paymentsCount };
});

exports.syncRendicionOutboundToFinanciero = onCall(async (request) => {
  await assertAdminCaller(request.auth);
  if (!hasFinancialCredentials()) {
    throw new HttpsError("failed-precondition", "Falta la credencial del Firebase financiero.");
  }

  const rendicionId = String(request.data?.rendicionId || "").trim();
  if (!rendicionId) {
    throw new HttpsError("invalid-argument", "Falta el rendicionId.");
  }

  const db = getDb();
  const rendicionSnap = await db.doc(`companies/${COMPANY_ID}/rendiciones/${rendicionId}`).get();

  if (!rendicionSnap.exists) {
    throw new HttpsError("not-found", "La rendicion no existe.");
  }

  const rendicion = rendicionSnap.data();
  const isApproved = rendicion.estado === "aprobada" || rendicion.approvalStatus === "APPROVED";

  if (!isApproved) {
    return { success: false, message: "La rendicion no esta aprobada." };
  }

  const financialDb = getFinancialDb();
  await ensureFinancialBranch(financialDb);

  const movementId = `RENDICION_${rendicionId}`;
  const now = Date.now();

  const movementData = {
    id: movementId,
    idempotencyKey: `sys-creditos:rendiciones:${rendicionId}:INGRESO`,
    branchId: FINANCIAL_BRANCH_ID,
    branchName: FINANCIAL_BRANCH_NAME,
    movementType: "INGRESO",
    tipo: "INGRESO",
    concept: `Rendicion aprobada ${rendicionId}`,
    concepto: `Rendicion aprobada ${rendicionId}`,
    monto: Math.round(rendicion.montoTotal || rendicion.amount || 0),
    amount: Math.round(rendicion.montoTotal || rendicion.amount || 0),
    origen: "creditos",
    sourceSystem: SYSTEM_NAME,
    sourceCollection: "rendiciones",
    sourceId: rendicionId,
    status: "CONFIRMED",
    fecha: now,
    timestamp: admin.firestore.Timestamp.fromMillis(now),
    updatedAt: now,
    createdAt: now,
  };

  await financialDb.runTransaction(async (transaction) => {
    const targetRef = financialDb.doc(`companies/${FINANCIAL_COMPANY_DOC_ID}/movements/${movementId}`);
    transaction.set(targetRef, movementData, { merge: true });
  });

  return { success: true, movementId };
});

