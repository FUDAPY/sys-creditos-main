import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix para los iconos de Leaflet en React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapPickerProps {
  onLocationSelect: (latitude: number, longitude: number, address: string) => void;
  address?: string;
  city?: string;
  initialLat?: number;
  initialLng?: number;
}

// Componente interno para manejar eventos del mapa
function MapClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Componente para buscar por dirección en OpenStreetMap Nominatim
function SearchBox({ onLocationSelect, address, city }: any) {
  const [searchQuery, setSearchQuery] = useState(`${address || ''} ${city || ''}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError('');
    try {
      // Intentar búsqueda directa primero (sin CORS proxy)
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&accept-language=es`;
      
      const response = await fetch(nominatimUrl, {
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}`);
      }
      
      const results = await response.json();
      if (results.length > 0) {
        const { lat, lon, display_name } = results[0];
        onLocationSelect(parseFloat(lat), parseFloat(lon), display_name);
        setSearchQuery('');
      } else {
        setError('No se encontraron resultados para esa dirección');
      }
    } catch (error) {
      console.error('Error en búsqueda:', error);
      setError('Error al buscar. Intenta hacer click en el mapa para seleccionar una ubicación.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSearch(e);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Busca una dirección..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={(e) => handleSearch(e as any)}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400"
        >
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        💡 Puedes hacer click directamente en el mapa para seleccionar una ubicación
      </p>
    </div>
  );
}

export default function MapPicker({
  onLocationSelect,
  address = '',
  city = '',
  initialLat = -25.5095,
  initialLng = -54.6129,
}: MapPickerProps) {
  const [position, setPosition] = useState<[number, number]>([initialLat, initialLng]);

  const handleMapClick = (lat: number, lng: number) => {
    setPosition([lat, lng]);
    // Obtener nombre de la dirección usando Nominatim (reverse geocoding)
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
      .then((res) => res.json())
      .then((data) => {
        onLocationSelect(lat, lng, data.address?.road || data.display_name || '');
      })
      .catch((error) => {
        console.error('Error al obtener dirección:', error);
        onLocationSelect(lat, lng, '');
      });
  };

  return (
    <div className="w-full">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          Ubicación en el Mapa
          <span className="text-red-500">*</span>
        </h3>
        <SearchBox onLocationSelect={handleMapClick} address={address} city={city} />
      </div>

      <div className="border border-gray-300 rounded-lg overflow-hidden" style={{ height: '400px' }}>
        <MapContainer
          center={position}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <MapClickHandler onLocationSelect={handleMapClick} />
          {position && (
            <Marker position={position}>
              <Popup>
                <div>
                  <p className="font-semibold">Ubicación seleccionada</p>
                  <p className="text-xs text-gray-600">
                    {position[0].toFixed(6)}, {position[1].toFixed(6)}
                  </p>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
        <p className="font-semibold mb-1">💡 Instrucciones:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Usa el buscador para encontrar una dirección</li>
          <li>O haz clic directamente en el mapa para seleccionar la ubicación</li>
          <li>Las coordenadas se guardarán automáticamente</li>
        </ul>
      </div>
    </div>
  );
}
