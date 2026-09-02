import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { AppFooter } from '../../components/layout/AppFooter';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const navigate = useNavigate();
  const { userData, loading: authLoading } = useAuth();

  // Redirigir si ya está autenticado
  useEffect(() => {
    if (userData && !authLoading) {
      navigate('/dashboard', { replace: true });
    }
  }, [userData, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      // No necesitamos navegar aquí, useEffect lo hará
    } catch (err: any) {
      console.error('Login error:', err);
      
      // Mensajes amigables para cada error
      if (err.code === 'auth/user-not-found') {
        setError('Usuario no encontrado. Verifica tu email.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Contraseña incorrecta.');
      } else if (err.code === 'auth/invalid-email') {
        setError('El email no es válido.');
      } else if (err.code === 'auth/invalid-credential') {
        setError('Credenciales inválidas. Intenta nuevamente.');
      } else {
        setError('Error al iniciar sesión. Verifica tus datos o intenta más tarde.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decoración de fondo */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo superior */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-2xl mb-4">
            <span className="text-4xl">💰</span>
          </div>
          <h1 className="text-4xl font-bold text-white">LIN GROUP</h1>
          <p className="text-gray-400 mt-1 text-sm tracking-wide">SISTEMA DE CRÉDITOS</p>
        </div>

        {/* Tarjeta de Login */}
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 py-10">
            {/* Mensaje de error */}
            {error && (
              <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl flex items-start space-x-3 backdrop-blur-sm">
                <span className="text-red-400 text-xl mt-0.5">⚠️</span>
                <div>
                  <p className="text-red-300 font-medium text-sm">{error}</p>
                </div>
              </div>
            )}

            {authLoading && (
              <div className="mb-6 p-4 bg-blue-500/20 border border-blue-500/50 rounded-xl text-center backdrop-blur-sm">
                <div className="flex items-center justify-center space-x-2">
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></span>
                  <p className="text-blue-300 text-sm">Verificando acceso...</p>
                </div>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              {/* Email */}
              <div>
                <input
                  type="email"
                  required
                  placeholder="admin@lingroup.com"
                  disabled={loading || authLoading}
                  autoComplete="email"
                  className="w-full px-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {/* Contraseña */}
              <div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Contraseña"
                    disabled={loading || authLoading}
                    autoComplete="current-password"
                    className="w-full px-4 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed pr-12"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300 transition"
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </div>

              {/* Botón de Login */}
              <button
                type="submit"
                disabled={loading || authLoading}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold rounded-xl hover:from-blue-700 hover:to-blue-600 transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center space-x-2 mt-6"
              >
                {loading || authLoading ? (
                  <>
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                    <span>Ingresando...</span>
                  </>
                ) : (
                  <>
                    <span>Acceder</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </form>

            {/* Info */}
            <div className="mt-8 pt-6 border-t border-white/10 text-center">
              <p className="text-gray-400 text-xs">
                Ingresa con tu usuario de administrador
              </p>
              <p className="text-gray-500 text-xs mt-3">
                Creado por <span className="font-semibold text-gray-400">Giuliano Catella</span> • <span className="font-semibold text-gray-400">Otelax Tech</span> • 2026
              </p>
              <div className="text-gray-600 mt-1">
                <AppFooter textClassName="text-gray-600 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
