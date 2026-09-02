# Sys Creditos

Este es un sistema de gestion de creditos, clientes, cobros y cartera. Lo
desarrollo para centralizar el trabajo diario de administradores y cobradores,
mantener el historial de cada operacion y controlar los saldos pendientes.

## Como funciona

Primero registro al cliente con sus datos personales, laborales, referencias y
ubicacion. Luego creo el credito, defino el tipo de operacion, el capital, la
moneda, los intereses, las fechas y el cobrador responsable. El credito puede
quedar pendiente de aprobacion o aprobarse directamente cuando corresponde.

Desde la aplicacion puedo revisar cada cuenta y trabajar con creditos,
empeños, alquileres, prestacion de servicios, POS, juridico y tragamonedas sin
mezclar sus operaciones.

En Cartera Activa se muestran las operaciones que todavia tienen deuda. Para
cobrar selecciono capital, interes o ambos, ingreso el monto y la fecha real
del cobro. El sistema calcula la distribucion y guarda el capital aplicado,
el interes, la mora, el saldo anterior y el saldo nuevo.

## Monedas

El sistema trabaja con dos monedas:

- Guaranies de Paraguay (PY/PYG).
- Dolares estadounidenses (USD).

Los cobros se registran en la moneda original de la operacion. Cuando un
movimiento en USD se sincroniza con el sistema Financiero, se convierte a
guaranies utilizando la cotizacion configurada para ese entorno. Tambien se
conservan el monto original y la cotizacion aplicada.

Los cobros pasan por Aprobar Rendicion, tanto si los registra un administrador
como si los registra un cobrador. Tambien se conserva el historial cuando se
anula un credito o un cobro: se guarda el usuario, la fecha y el motivo.

El sistema incluye pagarés, calendario de cobranzas, resumen del día, fichas
de clientes y dos copias del ticket térmico, una para el cliente y otra para
administración.

## Como esta organizado

La aplicacion web esta dentro de `src`. Las pantallas estan en `src/pages`,
los accesos a Firestore y las reglas de negocio en `src/services`, los tipos
en `src/types` y los calculos compartidos en `src/utils`.

Las funciones de Firebase estan en `functions`. Desde ahi se pueden sincronizar
clientes, deudas y pagos de sistemas externos, y enviar movimientos a un
sistema financiero. Las credenciales Admin SDK se guardan en
`functions/secrets/` y no deben subirse a GitHub.

Trabajo principalmente con estas colecciones:

- `companies/{companyId}/clients`
- `companies/{companyId}/loans`
- `companies/{companyId}/payments`
- `companies/{companyId}/pagares`
- `companies/{companyId}/collectionManagements`
- `companies/{companyId}/auditLogs`

El identificador de empresa se configura en el entorno de cada instalacion.

## Lenguajes y herramientas

El repositorio utiliza aproximadamente 96.2% de TypeScript y 3.6% de
JavaScript, segun GitHub Linguist. El porcentaje restante corresponde a CSS,
HTML y archivos de configuracion. Estos porcentajes pueden variar cuando se
agregan nuevos modulos.

Tambien uso React 19, Vite 8, Firebase Auth, Firestore, Cloud Functions,
Storage, Tailwind CSS y React Router.

## Requisitos e instalacion

Necesitas Node.js 22, npm y Firebase CLI.

```powershell
npm install
npm --prefix functions install
```

Las variables del frontend van en `.env`. En cada instalacion se deben definir
la empresa, los proyectos Firebase y las credenciales necesarias. Los archivos
de cuentas de servicio deben permanecer fuera del control de versiones.

## Desarrollo

Para iniciar la aplicacion local ejecuto:

```powershell
npm run dev
```

Vite muestra la direccion local en la terminal.

## Compilacion

Para comprobar que el frontend compila ejecuto:

```powershell
npm run build
```

TypeScript revisa el proyecto y Vite genera la carpeta `dist`.

## Validaciones

```powershell
npm run lint
node --check functions/index.js
```

## Despliegue

Cuando ya probe los cambios, despliego la instalacion correspondiente con:

```powershell
npm run build
npm --prefix functions install
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only functions
```

Antes de publicar reviso las variables de entorno, las credenciales locales y
realizo un respaldo de Firestore. Cuando no quiero tocar todas las funciones,
despliego solamente las funciones que modifique.

## Licencia original

OTELAX DEV PRIVATE SOFTWARE LICENSE
Version 1.0

Copyright (c) 2026
Otelax Dev
Giuliano Emanuel Maria Catella Riveros

Todos los derechos reservados.

Este software, código fuente, documentación, archivos asociados y cualquier
material relacionado son propiedad exclusiva de Otelax Dev y de Giuliano Emanuel
Maria Catella Riveros.

NO se concede ningún permiso para:

- Usar este software sin autorización expresa y por escrito.
- Copiar total o parcialmente el código fuente.
- Modificar el software.
- Crear trabajos derivados.
- Distribuir el software.
- Publicar el código fuente.
- Comercializar el software.
- Revender el software.
- Compartir el software con terceros.

Salvo autorización expresa y por escrito del titular de los derechos,
ninguna persona física o jurídica podrá utilizar este software para
ningún fin.

EL SOFTWARE SE PROPORCIONA "TAL CUAL", SIN GARANTÍAS DE NINGÚN TIPO.
