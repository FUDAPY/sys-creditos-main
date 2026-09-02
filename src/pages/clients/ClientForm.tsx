import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import { createClient } from '../../services/clientService';
import { useAuth } from '../../context/AuthContext';
import { db, COMPANY_ID } from '../../lib/firebase';
import { type Client, type User } from '../../types';
import MapPicker from '../../components/map/MapPicker';
import ClientFormPrint from '../../components/print/ClientFormPrint';

// Componentes memoizados para evitar recreación
interface InputFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'value' | 'onChange'> {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  error?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const InputField = memo(function InputField({
  label,
  name,
  required = false,
  type = 'text',
  error,
  value,
  onChange,
  ...props
}: InputFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className={`mt-1 block w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
        {...props}
      />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
});

interface SelectFieldProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'name' | 'value' | 'onChange'> {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

const SelectField = memo(function SelectField({
  label,
  name,
  options,
  required = false,
  error,
  value,
  onChange,
  ...props
}: SelectFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className={`mt-1 block w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
        {...props}
      >
        <option value="">Selecciona una opción</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
});

export default function ClientForm() {
  const { userData } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [collectors, setCollectors] = useState<User[]>([]);
  const [availableCompanies, setAvailableCompanies] = useState<
    Array<{
      name: string;
      address: string;
      city: string;
      neighborhood: string;
    }>
  >([]);
  const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [savedClient, setSavedClient] = useState<Client | null>(null);

  // Estado inicial con TODOS los campos requeridos
  const [formData, setFormData] = useState<Partial<Client>>({
    fullName: '',
    documentId: '',
    birthDate: '',
    nationality: '',
    phone: '',
    email: '',
    collectorId: '',
    collectorName: '',
    address: '',
    city: '',
    neighborhood: '',
    housingType: 'PROPIA',
    
    workplaceName: '',
    workplaceAddress: '',
    workplaceCity: '',
    workplaceNeighborhood: '',
    seniority: '',
    position: '',
    department: '',
    employmentStatus: 'EMPLEADO',
    workPhone: '',
    
    references: [
      { name: '', relationship: '', workplace: '', phone: '' },
      { name: '', relationship: '', workplace: '', phone: '' },
      { name: '', relationship: '', workplace: '', phone: '' }
    ],
    location: { latitude: 0, longitude: 0, googleMapsUrl: '' }
  });

  useEffect(() => {
    const loadCollectors = async () => {
      try {
        const clientsSnap = await getDocsFromServer(
          collection(db, `companies/${COMPANY_ID}/clients`)
        );
        const companiesByName = new Map<
          string,
          { name: string; address: string; city: string; neighborhood: string }
        >();

        clientsSnap.docs.forEach((docItem) => {
          const client = docItem.data() as Client;
          const companyName = (client.workplaceName || '').trim();
          if (!companyName) return;

          const normalizedName = companyName.toLocaleLowerCase('es');
          if (!companiesByName.has(normalizedName)) {
            companiesByName.set(normalizedName, {
              name: companyName,
              address: client.workplaceAddress || '',
              city: client.workplaceCity || '',
              neighborhood: client.workplaceNeighborhood || '',
            });
          }
        });

        setAvailableCompanies(
          Array.from(companiesByName.values()).sort((left, right) =>
            left.name.localeCompare(right.name, 'es')
          )
        );

        if (userData?.role === 'ADMIN') {
          const collectorsSnap = await getDocsFromServer(
            query(
              collection(db, `companies/${COMPANY_ID}/users`),
              where('isActive', '==', true)
            )
          );
          const availableCollectors = collectorsSnap.docs
            .map((doc) => ({ ...(doc.data() as User), uid: (doc.data() as User).uid || doc.id }))
            .filter((user) => user.role === 'COLLECTOR' || user.role === 'ADMIN')
            .sort((left, right) => left.name.localeCompare(right.name, 'es'));

          setCollectors(availableCollectors);
          return;
        }

        if (userData?.role === 'COLLECTOR') {
          const ownCollector: User = {
            ...userData,
            uid: userData.uid,
          };
          setCollectors([ownCollector]);
          setFormData((prev) => ({
            ...prev,
            collectorId: ownCollector.uid,
            collectorName: ownCollector.name,
          }));
        }
      } catch (error) {
        console.error('Error cargando cobradores:', error);
      }
    };

    void loadCollectors();
  }, [userData]);

  const filteredCompanies = useMemo(() => {
    const term = (formData.workplaceName || '').trim().toLocaleLowerCase('es');
    if (!term) return availableCompanies.slice(0, 8);

    return availableCompanies
      .filter((company) => company.name.toLocaleLowerCase('es').includes(term))
      .slice(0, 8);
  }, [availableCompanies, formData.workplaceName]);

  const hasExactCompanyMatch = useMemo(() => {
    const term = (formData.workplaceName || '').trim().toLocaleLowerCase('es');
    if (!term) return false;
    return availableCompanies.some((company) => company.name.toLocaleLowerCase('es') === term);
  }, [availableCompanies, formData.workplaceName]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.fullName?.trim()) newErrors.fullName = 'El nombre es requerido';
    if (!formData.documentId?.trim()) newErrors.documentId = 'El documento es requerido';
    if (!formData.phone?.trim()) newErrors.phone = 'El teléfono es requerido';
    if (!formData.collectorId?.trim()) newErrors.collectorId = 'Debes asignar un cobrador';
    if (!formData.address?.trim()) newErrors.address = 'La dirección es requerida';
    if (!formData.city?.trim()) newErrors.city = 'La ciudad es requerida';
    if (!formData.workplaceName?.trim()) newErrors.workplaceName = 'El nombre de la empresa es requerido';
    if (!formData.position?.trim()) newErrors.position = 'El cargo es requerido';
    if (!formData.workPhone?.trim()) newErrors.workPhone = 'El teléfono laboral es requerido';
    if (!formData.seniority?.trim()) newErrors.seniority = 'La antigüedad es requerida';

    // Validar referencias
    formData.references?.forEach((ref, idx) => {
      if (!ref.name.trim()) newErrors[`ref${idx}_name`] = 'El nombre es requerido';
      if (!ref.relationship.trim()) newErrors[`ref${idx}_relationship`] = 'La relación es requerida';
      if (!ref.phone.trim()) newErrors[`ref${idx}_phone`] = 'El teléfono es requerido';
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      if (name === 'collectorId') {
        const collector = collectors.find((item) => item.uid === value);
        return {
          ...prev,
          collectorId: value,
          collectorName: collector?.name || '',
        };
      }

      return { ...prev, [name]: value };
    });
    // Limpiar error del campo al escribir
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  }, [collectors, errors]);

  const handleReferenceChange = useCallback((index: number, field: string, value: string) => {
    setFormData(prev => {
      const newRefs = [...(prev.references || [])];
      newRefs[index] = { ...newRefs[index], [field]: value };
      return { ...prev, references: newRefs };
    });
    // Limpiar error
    if (errors[`ref${index}_${field}`]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[`ref${index}_${field}`];
        return newErrors;
      });
    }
  }, [errors]);

  const handleLocationSelect = useCallback((latitude: number, longitude: number, address: string) => {
    setFormData(prev => ({
      ...prev,
      address: prev.address || address,
      location: {
        latitude,
        longitude,
        googleMapsUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=15`
      }
    }));
  }, []);

  const handleCompanySelect = useCallback((company: {
    name: string;
    address: string;
    city: string;
    neighborhood: string;
  }) => {
    setFormData((prev) => ({
      ...prev,
      workplaceName: company.name,
      workplaceAddress: prev.workplaceAddress || company.address,
      workplaceCity: prev.workplaceCity || company.city,
      workplaceNeighborhood: prev.workplaceNeighborhood || company.neighborhood,
    }));
    setShowCompanySuggestions(false);
    if (errors.workplaceName) {
      setErrors((prev) => ({ ...prev, workplaceName: '' }));
    }
  }, [errors.workplaceName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      alert('Por favor completa todos los campos requeridos.');
      return;
    }

    if (!userData) return;
    
    setLoading(true);
    try {
      const result = await createClient(
        formData as Omit<Client, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'createdBy'>,
        userData.uid
      );
      
      // Actualizar los datos del cliente guardado para el formulario de impresión
      const clientWithData: Client = {
        ...(formData as Client),
        id: result.id || '',
        companyId: COMPANY_ID,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: userData.uid
      };
      
      setSavedClient(clientWithData);
      setShowPrintPreview(true);
    } catch (error) {
      console.error(error);
      alert('Error al registrar cliente. Revisa los permisos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showPrintPreview && savedClient && (
        <ClientFormPrint
          client={savedClient}
          companyLogo="/logo.png"
          onClose={() => {
            setShowPrintPreview(false);
            navigate('/clientes');
          }}
        />
      )}
      
      <div className="max-w-4xl mx-auto bg-white p-8 shadow rounded-lg">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">Registrar Nuevo Cliente</h2>
        
        <form onSubmit={handleSubmit} className="space-y-8">
        
        {/* SECCIÓN 1: Datos Personales */}
        <section>
          <h3 className="text-lg font-semibold border-b pb-2 mb-4 text-gray-700">1. Datos Personales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              label="Nombre Completo"
              name="fullName"
              value={formData.fullName || ''}
              onChange={handleChange}
              required
              error={errors.fullName}
            />
            <InputField
              label="C.I. / Documento"
              name="documentId"
              value={formData.documentId || ''}
              onChange={handleChange}
              required
              error={errors.documentId}
            />
            <InputField
              label="Teléfono"
              name="phone"
              value={formData.phone || ''}
              onChange={handleChange}
              type="tel"
              required
              error={errors.phone}
            />
            <InputField
              label="Email"
              name="email"
              value={formData.email || ''}
              onChange={handleChange}
              type="email"
            />
            <SelectField
              label="Cobrador Asignado"
              name="collectorId"
              value={formData.collectorId || ''}
              onChange={handleChange}
              required
              error={errors.collectorId}
              disabled={userData?.role === 'COLLECTOR'}
              options={collectors.map((collector) => ({
                value: collector.uid,
                label: collector.name,
              }))}
            />
            <InputField
              label="Fecha de Nacimiento"
              name="birthDate"
              value={formData.birthDate || ''}
              onChange={handleChange}
              type="date"
            />
            <InputField
              label="Nacionalidad"
              name="nationality"
              value={formData.nationality || ''}
              onChange={handleChange}
            />
            <InputField
              label="Dirección"
              name="address"
              value={formData.address || ''}
              onChange={handleChange}
              required
              error={errors.address}
            />
            <InputField
              label="Ciudad"
              name="city"
              value={formData.city || ''}
              onChange={handleChange}
              required
              error={errors.city}
            />
            <InputField
              label="Barrio/Zona"
              name="neighborhood"
              value={formData.neighborhood || ''}
              onChange={handleChange}
            />
            <SelectField
              label="Tipo de Vivienda"
              name="housingType"
              value={formData.housingType || 'PROPIA'}
              onChange={handleChange}
              required
              options={[
                { value: 'PROPIA', label: 'Propia' },
                { value: 'ALQUILADA', label: 'Alquilada' },
                { value: 'FAMILIAR', label: 'Familiar' }
              ]}
            />
          </div>
        </section>

        {/* SECCIÓN 2: Datos Laborales */}
        <section>
          <h3 className="text-lg font-semibold border-b pb-2 mb-4 text-gray-700">2. Datos Laborales</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700">
                Empresa <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="workplaceName"
                value={formData.workplaceName || ''}
                onChange={(event) => {
                  handleChange(event);
                  setShowCompanySuggestions(true);
                }}
                onFocus={() => setShowCompanySuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowCompanySuggestions(false), 150)}
                placeholder="Buscar o crear empresa"
                autoComplete="off"
                className={`mt-1 block w-full rounded-md border p-2 focus:border-blue-500 focus:ring-blue-500 ${
                  errors.workplaceName ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.workplaceName && (
                <p className="mt-1 text-xs text-red-500">{errors.workplaceName}</p>
              )}
              {showCompanySuggestions && (
                <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {filteredCompanies.map((company) => (
                    <button
                      key={company.name}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleCompanySelect(company)}
                      className="block w-full border-b border-gray-100 px-4 py-3 text-left text-sm hover:bg-blue-50"
                    >
                      <span className="font-semibold text-gray-900">{company.name}</span>
                      {[company.city, company.neighborhood].filter(Boolean).length > 0 && (
                        <span className="mt-1 block text-xs text-gray-500">
                          {[company.city, company.neighborhood].filter(Boolean).join(' - ')}
                        </span>
                      )}
                    </button>
                  ))}
                  {(formData.workplaceName || '').trim() && !hasExactCompanyMatch && (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowCompanySuggestions(false)}
                      className="block w-full px-4 py-3 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      Crear empresa "{(formData.workplaceName || '').trim()}"
                    </button>
                  )}
                  {filteredCompanies.length === 0 && !(formData.workplaceName || '').trim() && (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      Escribe el nombre de la empresa.
                    </div>
                  )}
                </div>
              )}
            </div>
            <InputField
              label="Cargo"
              name="position"
              value={formData.position || ''}
              onChange={handleChange}
              required
              error={errors.position}
            />
            <InputField
              label="Departamento"
              name="department"
              value={formData.department || ''}
              onChange={handleChange}
            />
            <InputField
              label="Antigüedad (Ej: 5 años)"
              name="seniority"
              value={formData.seniority || ''}
              onChange={handleChange}
              required
              error={errors.seniority}
            />
            <InputField
              label="Teléfono Laboral"
              name="workPhone"
              value={formData.workPhone || ''}
              onChange={handleChange}
              type="tel"
              required
              error={errors.workPhone}
            />
            <SelectField
              label="Situación Laboral"
              name="employmentStatus"
              value={formData.employmentStatus || 'EMPLEADO'}
              onChange={handleChange}
              required
              options={[
                { value: 'EMPLEADO', label: 'Empleado' },
                { value: 'PROPIETARIO', label: 'Propietario' },
                { value: 'INDEPENDIENTE', label: 'Independiente' }
              ]}
            />
            <InputField
              label="Dirección Laboral"
              name="workplaceAddress"
              value={formData.workplaceAddress || ''}
              onChange={handleChange}
            />
            <InputField
              label="Ciudad Laboral"
              name="workplaceCity"
              value={formData.workplaceCity || ''}
              onChange={handleChange}
            />
            <InputField
              label="Barrio Laboral"
              name="workplaceNeighborhood"
              value={formData.workplaceNeighborhood || ''}
              onChange={handleChange}
            />
          </div>
        </section>

        {/* SECCIÓN 3: Referencias Personales */}
        <section>
          <h3 className="text-lg font-semibold border-b pb-2 mb-4 text-gray-700">3. Referencias Personales (3 Requeridas)</h3>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
              <h4 className="font-semibold mb-3 text-gray-700">Referencia {i + 1}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Nombre <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Nombre Completo"
                    value={formData.references?.[i]?.name || ''}
                    onChange={(e) => handleReferenceChange(i, 'name', e.target.value)}
                    className={`mt-1 block w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${
                      errors[`ref${i}_name`] ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors[`ref${i}_name`] && <p className="text-red-500 text-xs mt-1">{errors[`ref${i}_name`]}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Relación <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Amigo, Familiar"
                    value={formData.references?.[i]?.relationship || ''}
                    onChange={(e) => handleReferenceChange(i, 'relationship', e.target.value)}
                    className={`mt-1 block w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${
                      errors[`ref${i}_relationship`] ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors[`ref${i}_relationship`] && <p className="text-red-500 text-xs mt-1">{errors[`ref${i}_relationship`]}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Teléfono <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    placeholder="Teléfono"
                    value={formData.references?.[i]?.phone || ''}
                    onChange={(e) => handleReferenceChange(i, 'phone', e.target.value)}
                    className={`mt-1 block w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${
                      errors[`ref${i}_phone`] ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors[`ref${i}_phone`] && <p className="text-red-500 text-xs mt-1">{errors[`ref${i}_phone`]}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Lugar de Trabajo</label>
                  <input
                    type="text"
                    placeholder="Empresa o lugar"
                    value={formData.references?.[i]?.workplace || ''}
                    onChange={(e) => handleReferenceChange(i, 'workplace', e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* SECCIÓN 4: Ubicación en Mapa */}
        <section>
          <h3 className="text-lg font-semibold border-b pb-2 mb-4 text-gray-700">4. Ubicación del Cliente</h3>
          <MapPicker
            onLocationSelect={handleLocationSelect}
            address={formData.address}
            city={formData.city}
            initialLat={formData.location?.latitude || -25.5095}
            initialLng={formData.location?.longitude || -54.6129}
          />
        </section>

        <div className="flex justify-between pt-4">
          <button
            type="button"
            onClick={() => navigate('/clientes')}
            className="bg-gray-300 text-gray-800 px-6 py-2 rounded-md hover:bg-gray-400 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Registrar Cliente'}
          </button>
        </div>
      </form>
    </div>
    </>
  );
}
