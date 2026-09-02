import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import PagoRapido from '../PagoRapido';
import { AppFooter } from './AppFooter';

export const MainLayout = () => {
  const { userData, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPagoRapido, setShowPagoRapido] = useState(false);
  const [showEmpresas, setShowEmpresas] = useState(false);
  const [showClasificacion, setShowClasificacion] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const isCategoryActive = (category: string) =>
    location.pathname === '/creditos' &&
    new URLSearchParams(location.search).get('categoria') === category;

  const linkClasses = (path: string) =>
    `block px-4 py-2 rounded transition-colors ${
      isActive(path) ? 'bg-blue-600 text-white font-semibold' : 'text-gray-300 hover:bg-gray-800'
    }`;

  const queryLinkClasses = (active: boolean) =>
    `block px-4 py-2 rounded transition-colors ${
      active ? 'bg-blue-600 text-white font-semibold' : 'text-gray-300 hover:bg-gray-800'
    }`;

  const sectionLabelClasses =
    'px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500';

  const isEmpresasSection =
    isActive('/tragamonedas') ||
    isActive('/pos') ||
    isActive('/alquileres') ||
    isActive('/prestacion-servicios') ||
    isActive('/empenos') ||
    isActive('/juridico');

  const isClasificacionSection =
    isCategoryActive('BUENO') ||
    isCategoryActive('INFORCONF') ||
    isCategoryActive('PREJUDICIAL') ||
    isCategoryActive('JUDICIAL');

  const title = (() => {
    if (location.pathname === '/dashboard') return 'Dashboard';
    if (location.pathname === '/clientes') return 'Gestion de Clientes';
    if (location.pathname === '/clientes/nuevo') return 'Nuevo Cliente';
    if (location.pathname.startsWith('/clientes/') && location.pathname !== '/clientes/nuevo') {
      return 'Ficha del Cliente';
    }
    if (location.pathname === '/creditos') return 'Creditos';
    if (location.pathname === '/cartera-activa') return 'Cartera Activa';
    if (location.pathname === '/tragamonedas') return 'Tragamonedas';
    if (location.pathname === '/pos') return 'POS';
    if (location.pathname === '/alquileres') return 'Alquileres';
    if (location.pathname === '/prestacion-servicios') return 'Prestacion de Servicios';
    if (location.pathname === '/empenos') return 'Empeños';
    if (location.pathname === '/juridico') return 'Juridico';
    if (location.pathname === '/creditos/nuevo') return 'Nuevo Credito';
    if (location.pathname === '/calendario') return 'Calendario de Cobranzas';
    if (location.pathname === '/resumen-dia') return 'Resumen del Dia';
    if (location.pathname === '/pagares') return 'Inventario de Pagares';
    if (location.pathname === '/usuarios') return 'Gestion de Usuarios';
    if (location.pathname === '/aprobaciones/creditos') return 'Aprobar Creditos';
    if (location.pathname === '/aprobaciones/pagos') return 'Aprobar Rendiciones';
    if (location.pathname === '/reportes/recaudador') return 'Consultor de Recaudador';
    if (location.pathname.startsWith('/cobro')) return 'Registrar Pago';
    if (location.pathname.startsWith('/imprimir')) return 'Impresion';
    return 'Sistema de Creditos';
  })();

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-64 bg-gray-900 text-white flex flex-col shadow-lg">
        <div className="p-4 border-b border-gray-800">
          <h2 className="text-xl font-bold">LIN GROUP S.A.</h2>
          <p className="text-xs text-gray-400 mt-2">
            {userData?.role === 'ADMIN' ? 'Administrador' : 'Cobrador'}
          </p>
          <p className="text-xs text-gray-400 truncate">{userData?.name}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <Link to="/dashboard" className={linkClasses('/dashboard')}>
            Dashboard
          </Link>

          <button
            onClick={() => setShowPagoRapido(true)}
            className="w-full text-left block px-4 py-2 rounded transition-colors text-green-400 hover:bg-gray-800 bg-gradient-to-r from-green-600/30 to-green-500/30 border border-green-500/50 font-semibold"
          >
            Pago Rapido
          </button>

          <Link to="/resumen-dia" className={linkClasses('/resumen-dia')}>
            Resumen del Dia
          </Link>

          <Link to="/calendario" className={linkClasses('/calendario')}>
            Calendario
          </Link>

          <div className="border-t border-gray-700 my-3"></div>
          <div className={sectionLabelClasses}>Cobros</div>

          <Link to="/cartera-activa" className={linkClasses('/cartera-activa')}>
            Cartera Activa
          </Link>

          <div className="border-t border-gray-700 my-3"></div>
          <div className={sectionLabelClasses}>Clientes</div>

          <Link to="/clientes" className={linkClasses('/clientes')}>
            Gestion de Clientes
          </Link>
          <Link to="/clientes/nuevo" className={linkClasses('/clientes/nuevo')}>
            Nuevo Cliente
          </Link>
          <Link to="/creditos/nuevo" className={linkClasses('/creditos/nuevo')}>
            {userData?.role === 'ADMIN' ? 'Nuevo Credito' : 'Cargar Credito'}
          </Link>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setShowEmpresas((previous) => !previous)}
              className={`w-full flex items-center justify-between px-4 py-2 rounded transition-colors ${
                isEmpresasSection
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span>Empresas</span>
              <span className="text-xs">{showEmpresas ? '▲' : '▼'}</span>
            </button>

            {showEmpresas && (
              <div className="ml-3 space-y-1 border-l border-gray-700 pl-3">
                <Link to="/creditos" className={linkClasses('/creditos')}>
                  Creditos
                </Link>
                <Link to="/tragamonedas" className={linkClasses('/tragamonedas')}>
                  Tragamonedas
                </Link>
                <Link to="/pos" className={linkClasses('/pos')}>
                  POS
                </Link>
                <Link to="/empenos" className={linkClasses('/empenos')}>
                  Empeños
                </Link>
                <Link to="/prestacion-servicios" className={linkClasses('/prestacion-servicios')}>
                  Prestacion de Servicios
                </Link>
                <Link to="/alquileres" className={linkClasses('/alquileres')}>
                  Alquileres
                </Link>
                <Link to="/juridico" className={linkClasses('/juridico')}>
                  Juridico
                </Link>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setShowClasificacion((previous) => !previous)}
              className={`w-full flex items-center justify-between px-4 py-2 rounded transition-colors ${
                isClasificacionSection
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span>Clasif. de Cartera</span>
              <span className="text-xs">{showClasificacion ? '▲' : '▼'}</span>
            </button>

            {showClasificacion && (
              <div className="ml-3 space-y-1 border-l border-gray-700 pl-3">
                <Link
                  to="/creditos?categoria=BUENO"
                  className={queryLinkClasses(isCategoryActive('BUENO'))}
                >
                  Bueno
                </Link>
                <Link
                  to="/creditos?categoria=INFORCONF"
                  className={queryLinkClasses(isCategoryActive('INFORCONF'))}
                >
                  Inforconf
                </Link>
                <Link
                  to="/creditos?categoria=PREJUDICIAL"
                  className={queryLinkClasses(isCategoryActive('PREJUDICIAL'))}
                >
                  Prejudicial
                </Link>
                <Link
                  to="/creditos?categoria=JUDICIAL"
                  className={queryLinkClasses(isCategoryActive('JUDICIAL'))}
                >
                  Judicial
                </Link>
              </div>
            )}
          </div>

          <div className="border-t border-gray-700 my-3"></div>
          <div className={sectionLabelClasses}>Administracion</div>

          <Link to="/pagares" className={linkClasses('/pagares')}>
            Pagares
          </Link>

          {userData?.role === 'ADMIN' && (
            <>
              <Link to="/aprobaciones/creditos" className={linkClasses('/aprobaciones/creditos')}>
                Aprobar Credito
              </Link>
              <Link to="/aprobaciones/pagos" className={linkClasses('/aprobaciones/pagos')}>
                Aprobar Rendicion
              </Link>
              <Link to="/usuarios" className={linkClasses('/usuarios')}>
                Gestion de Usuario
              </Link>
              <Link to="/reportes/recaudador" className={linkClasses('/reportes/recaudador')}>
                Consultor de Recaudador
              </Link>
            </>
          )}

          <div className="border-t border-gray-700 my-3"></div>
          <div className="px-4 py-2 text-xs text-gray-400">
            <p className="font-semibold mb-1">Sistema de Creditos</p>
            <p>Version 1.0</p>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-800 space-y-2">
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-red-900/20 rounded transition-colors"
          >
            Cerrar Sesion
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto flex flex-col">
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
        </div>
        <div className="p-8 flex-1">
          <Outlet />
        </div>
        <footer className="border-t border-gray-200 bg-white px-8 py-4">
          <AppFooter />
        </footer>
      </main>

      {showPagoRapido && <PagoRapido onClose={() => setShowPagoRapido(false)} />}
    </div>
  );
};
