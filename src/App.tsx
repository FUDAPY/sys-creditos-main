import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './pages/auth/Login';
import { MainLayout } from './components/layout/MainLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import ClientForm from './pages/clients/ClientForm';
import ClientDetail from './pages/clients/ClientDetail';
import ClientsList from './pages/clients/ClientsList';
import LoanForm from './pages/loans/LoanForm';
import LoansList from './pages/loans/LoansList';
import Dashboard from './pages/Dashboard';
import PaymentForm from './pages/collections/PaymentForm';
import { LoanCalendar } from './pages/collections/LoanCalendar';
import DailySummary from './pages/collections/DailySummary';
import SlotMachinesPage from './pages/companies/SlotMachinesPage';
import UserManagement from './pages/users/UserManagement';
import ConsultorRecaudador from './pages/reports/ConsultorRecaudador';
import LoanApprovals from './pages/admin/LoanApprovals';
import PaymentApprovals from './pages/admin/PaymentApprovals';
import PagaresPage from './pages/admin/PagaresPage';
import { CreditApplicationPrint } from './components/print/CreditApplicationPrint';
import { ThermalTicketPrint } from './components/print/ThermalTicketPrint';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Rutas Públicas */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />

          {/* Rutas Protegidas - Dashboard y Sistema */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
          </Route>

          {/* Rutas de Clientes */}
          <Route
            path="/clientes"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ClientsList />} />
          </Route>

          <Route
            path="/clientes/:clientId"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ClientDetail />} />
          </Route>

          <Route
            path="/clientes/nuevo"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ClientForm />} />
          </Route>

          {/* Rutas de Créditos */}
          <Route
            path="/creditos"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/cartera-activa"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/tragamonedas"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<SlotMachinesPage />} />
            
          </Route>

          <Route
            path="/pos"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/alquileres"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/prestacion-servicios"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/empenos"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/juridico"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoansList />} />
          </Route>

          <Route
            path="/creditos/nuevo"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoanForm />} />
          </Route>

          {/* Rutas de Usuarios */}
          <Route
            path="/usuarios"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<UserManagement />} />
          </Route>

          <Route
            path="/aprobaciones/creditos"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoanApprovals />} />
          </Route>

          <Route
            path="/aprobaciones/pagos"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<PaymentApprovals />} />
          </Route>

          <Route
            path="/pagares"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<PagaresPage />} />
          </Route>

          {/* Rutas de Reportes */}
          <Route
            path="/reportes/recaudador"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ConsultorRecaudador />} />
          </Route>

          {/* Rutas de Cobranza */}
          <Route
            path="/calendario"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<LoanCalendar />} />
          </Route>

          <Route
            path="/resumen-dia"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DailySummary />} />
          </Route>

          <Route
            path="/cobro/:loanId"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<PaymentForm />} />
          </Route>

          {/* Rutas de Impresión */}
          <Route
            path="/imprimir/solicitud/:loanId"
            element={
              <ProtectedRoute>
                <CreditApplicationPrint />
              </ProtectedRoute>
            }
          />

          <Route
            path="/imprimir/ticket/:paymentId"
            element={
              <ProtectedRoute>
                <ThermalTicketPrint />
              </ProtectedRoute>
            }
          />

          {/* Si escriben cualquier otra cosa, los devuelve al login */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
