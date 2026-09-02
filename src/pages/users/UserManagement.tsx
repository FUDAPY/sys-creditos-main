import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  adminSetUserPassword,
  createUser,
  deactivateUser,
  getActiveUsers,
  updateUserProfile,
} from '../../services/userService';
import type { User } from '../../types';

interface UserWithId extends User {
  uid: string;
}

interface EditingUser {
  uid: string;
  name: string;
  email: string;
  newPassword: string;
  confirmPassword: string;
}

export default function UserManagement() {
  const { userData } = useAuth();
  const [users, setUsers] = useState<UserWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<EditingUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'COLLECTOR' as const,
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    if (userData && userData.role !== 'ADMIN') {
      setError('No tienes permiso para acceder a esta pagina.');
      setLoading(false);
      return;
    }

    void loadUsers();
  }, [userData]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const activeUsers = await getActiveUsers();
      setUsers(activeUsers as UserWithId[]);
    } catch (err) {
      console.error('Error al cargar usuarios:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar los usuarios.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError('El nombre es requerido.');
      return;
    }
    if (!formData.email.trim()) {
      setFormError('El email es requerido.');
      return;
    }
    if (formData.password.length < 6) {
      setFormError('La contrasena debe tener al menos 6 caracteres.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setFormError('Las contrasenas no coinciden.');
      return;
    }
    if (!userData?.uid) {
      setFormError('Usuario actual no disponible.');
      return;
    }

    setFormLoading(true);
    try {
      await createUser(
        {
          email: formData.email,
          password: formData.password,
          name: formData.name,
          role: formData.role,
        },
        userData.uid
      );

      setFormData({
        name: '',
        email: '',
        role: 'COLLECTOR',
        password: '',
        confirmPassword: '',
      });
      setShowForm(false);
      await loadUsers();
    } catch (err) {
      console.error('Error al crear usuario:', err);
      setFormError(err instanceof Error ? err.message : 'Error al crear el usuario.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleEditUser = (user: UserWithId) => {
    setFormError(null);
    setEditingUser({
      uid: user.uid,
      name: user.name,
      email: user.email,
      newPassword: '',
      confirmPassword: '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;

    setFormError(null);
    const normalizedPassword = editingUser.newPassword.trim();

    if (!editingUser.name.trim()) {
      setFormError('El nombre es requerido.');
      return;
    }
    if (normalizedPassword && normalizedPassword.length < 6) {
      setFormError('La contrasena debe tener al menos 6 caracteres.');
      return;
    }
    if (normalizedPassword !== editingUser.confirmPassword.trim()) {
      setFormError('Las contrasenas no coinciden.');
      return;
    }

    setFormLoading(true);
    try {
      await updateUserProfile(editingUser.uid, editingUser.name);

      if (normalizedPassword) {
        await adminSetUserPassword(editingUser.uid, normalizedPassword);
      }

      const shouldNotifyReset = Boolean(normalizedPassword);

      setEditingUser(null);
      await loadUsers();

      if (shouldNotifyReset) {
        alert('La contrasena del usuario fue actualizada correctamente.');
      }
    } catch (err) {
      console.error('Error al guardar cambios:', err);
      setFormError(err instanceof Error ? err.message : 'Error al guardar los cambios.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivateUser = async (userToDeactivate: UserWithId) => {
    if (
      !window.confirm(
        `Estas seguro de que deseas desactivar a ${userToDeactivate.name}? Sus creditos y datos permaneceran intactos.`
      )
    ) {
      return;
    }

    setFormLoading(true);
    try {
      await deactivateUser(userToDeactivate.uid);
      await loadUsers();
    } catch (err) {
      console.error('Error al desactivar usuario:', err);
      setError(err instanceof Error ? err.message : 'Error al desactivar el usuario.');
    } finally {
      setFormLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error && !userData) {
    return (
      <div className="p-6">
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Gestion de Usuarios</h1>
        <button
          type="button"
          onClick={() => setShowForm((previous) => !previous)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
        >
          <span>+</span>
          {showForm ? 'Cancelar' : 'Nuevo Usuario'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border-l-4 border-blue-600 bg-white p-6 shadow">
          <h2 className="mb-4 text-xl font-bold text-gray-900">Crear Nuevo Usuario</h2>

          {formError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              {formError}
            </div>
          )}

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Nombre Completo">
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Ej: Juan Garcia"
                />
              </Field>

              <Field label="Email">
                <input
                  type="email"
                  value={formData.email}
                  onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Ej: juan@lingroup.com"
                />
              </Field>

              <Field label="Contrasena">
                <input
                  type="password"
                  value={formData.password}
                  onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Minimo 6 caracteres"
                />
              </Field>

              <Field label="Confirmar Contrasena">
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(event) =>
                    setFormData({ ...formData, confirmPassword: event.target.value })
                  }
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Repite la contrasena"
                />
              </Field>

              <Field label="Rol">
                <select
                  value={formData.role}
                  onChange={(event) =>
                    setFormData({ ...formData, role: event.target.value as 'COLLECTOR' })
                  }
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="COLLECTOR">Cobrador</option>
                </select>
              </Field>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="submit"
                disabled={formLoading}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {formLoading ? 'Creando...' : 'Crear Usuario'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg bg-gray-300 px-4 py-2 font-medium text-gray-700 transition hover:bg-gray-400"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Usuarios Vigentes ({users.length})</h2>
        </div>

        {users.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <p>No hay usuarios configurados. Crea el primer usuario.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Nombre</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">Rol</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Creado</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.uid} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{user.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                    <td className="px-6 py-4 text-center text-sm">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                          user.role === 'ADMIN'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {user.role === 'ADMIN' ? 'Admin' : 'Cobrador'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(user.createdAt).toLocaleDateString('es-PY')}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditUser(user)}
                          className="rounded bg-blue-500 px-3 py-1 text-xs text-white transition hover:bg-blue-600"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeactivateUser(user)}
                          disabled={formLoading}
                          className="rounded bg-red-500 px-3 py-1 text-xs text-white transition hover:bg-red-600 disabled:opacity-50"
                        >
                          Desactivar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-4 text-xl font-bold text-gray-900">Editar Usuario</h2>

            {formError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                {formError}
              </div>
            )}

            <div className="space-y-4">
              <Field label="Nombre Completo">
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(event) =>
                    setEditingUser({ ...editingUser, name: event.target.value })
                  }
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </Field>

              <Field label="Email">
                <input
                  type="email"
                  value={editingUser.email}
                  disabled
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 opacity-60"
                />
                <p className="mt-1 text-xs text-gray-500">El email no puede modificarse.</p>
              </Field>

              <Field label="Nueva Contrasena (opcional)">
                <input
                  type="password"
                  value={editingUser.newPassword}
                  onChange={(event) =>
                    setEditingUser({ ...editingUser, newPassword: event.target.value })
                  }
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Ingresa aqui la nueva contrasena"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Como ahora tienes backend administrativo en Firebase, esta clave se guardara directamente en Auth.
                </p>
              </Field>

              <Field label="Confirmar Contrasena">
                <input
                  type="password"
                  value={editingUser.confirmPassword}
                  onChange={(event) =>
                    setEditingUser({ ...editingUser, confirmPassword: event.target.value })
                  }
                  disabled={formLoading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  placeholder="Repite la contrasena"
                />
              </Field>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={formLoading}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {formLoading ? 'Guardando...' : 'Guardar Cambios'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingUser(null);
                  setFormError(null);
                }}
                disabled={formLoading}
                className="flex-1 rounded-lg bg-gray-300 px-4 py-2 font-medium text-gray-700 transition hover:bg-gray-400 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
