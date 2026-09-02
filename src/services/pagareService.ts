import { collection, doc, getDocs, orderBy, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { COMPANY_ID, db } from '../lib/firebase';
import type { Pagare, PagareStatus, User } from '../types';

const PAGARES_PATH = `companies/${COMPANY_ID}/pagares`;

export async function getPagares(): Promise<Pagare[]> {
  const baseRef = collection(db, PAGARES_PATH);
  const q = query(baseRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data();
    // Normalizar estados antiguos a la nueva máquina de estados ('activo' | 'cancelado')
    let estadoNormalized: PagareStatus = 'activo';
    if (data.estado === 'cancelado' || data.estado === 'ENTREGADO') {
      estadoNormalized = 'cancelado';
    } else {
      estadoNormalized = 'activo';
    }
    return { id: docSnap.id, ...data, estado: estadoNormalized } as Pagare;
  });
}

export async function createPagare(pagareData: {
  loanId?: string;
  nombre: string;
  cedula: string;
  monto: number;
  tomo: string;
  cobrador?: string;
  createdBy: string;
}): Promise<Pagare> {
  const pagareRef = doc(collection(db, PAGARES_PATH));
  const now = Date.now();

  const newPagare: Pagare = {
    id: pagareRef.id,
    loanId: pagareData.loanId || '',
    companyId: COMPANY_ID,
    nombre: pagareData.nombre.trim(),
    nombreLower: pagareData.nombre.trim().toLowerCase(),
    cedula: pagareData.cedula.trim(),
    cedulaSearch: pagareData.cedula.trim().toLowerCase(),
    monto: pagareData.monto,
    tomo: String(pagareData.tomo).trim(),
    cobrador: pagareData.cobrador || '',
    estado: 'activo',
    createdAt: now,
    updatedAt: now,
    createdBy: pagareData.createdBy,
  };

  await setDoc(pagareRef, newPagare);
  return newPagare;
}

export async function togglePagareStatus(
  pagareId: string,
  newStatus: PagareStatus,
  user: User
): Promise<void> {
  const pagareRef = doc(db, PAGARES_PATH, pagareId);
  const now = Date.now();

  const updateData: Partial<Pagare> = {
    estado: newStatus,
    updatedAt: now,
  };

  if (newStatus === 'cancelado') {
    updateData.entregadoAt = now;
    updateData.entregadoBy = user.uid;
    updateData.entregadoByName = user.name;
  } else {
    updateData.entregadoAt = undefined;
    updateData.entregadoBy = undefined;
    updateData.entregadoByName = undefined;
  }

  await updateDoc(pagareRef, updateData as Record<string, unknown>);
}

export async function importPagaresFromCSV(
  csvText: string,
  createdBy: string
): Promise<{ importedCount: number; errorsCount: number }> {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return { importedCount: 0, errorsCount: 0 };
  }

  // Primera línea: cabeceras (nombre,cedula,monto,tomo,estado,cobrador)
  const rows = lines.slice(1);
  const batch = writeBatch(db);
  let count = 0;
  let errors = 0;

  for (const row of rows) {
    const columns = row.split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
    if (columns.length < 4) {
      errors++;
      continue;
    }

    const [nombre, cedula, montoStr, tomo, estadoRaw, cobrador] = columns;
    const monto = parseFloat(montoStr);
    if (!nombre || !cedula || isNaN(monto) || !tomo) {
      errors++;
      continue;
    }

    const estado: PagareStatus = estadoRaw?.toLowerCase() === 'cancelado' ? 'cancelado' : 'activo';
    const pagareRef = doc(collection(db, PAGARES_PATH));
    const now = Date.now();

    batch.set(pagareRef, {
      id: pagareRef.id,
      companyId: COMPANY_ID,
      nombre: nombre.trim(),
      nombreLower: nombre.trim().toLowerCase(),
      cedula: cedula.trim(),
      cedulaSearch: cedula.trim().toLowerCase(),
      monto,
      tomo: tomo.trim(),
      cobrador: cobrador || '',
      estado,
      createdAt: now,
      updatedAt: now,
      createdBy,
    });

    count++;
  }

  if (count > 0) {
    await batch.commit();
  }

  return { importedCount: count, errorsCount: errors };
}

export function exportPagaresToExcel(pagares: Pagare[], fileName = 'pagares.xlsx'): void {
  const exportData = pagares.map((p) => ({
    ID: p.id || '',
    Cliente: p.nombre,
    Cedula: p.cedula,
    Monto: p.monto,
    Tomo: p.tomo,
    Estado: p.estado,
    Cobrador: p.cobrador || '',
    Fecha_Creacion: new Date(p.createdAt).toLocaleDateString('es-PY'),
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Pagares');
  XLSX.writeFile(workbook, fileName);
}
