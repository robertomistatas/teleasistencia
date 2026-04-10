# Teleasistencia

Base inicial del proyecto web con React, Vite, TypeScript, Tailwind CSS, Supabase JS y ESLint.

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

## Instalacion

```bash
npm install
```

## Variables de entorno

1. Copia `.env.example` a `.env`.
2. Completa las variables de Supabase:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Desarrollo local

```bash
npm run dev
```

La aplicacion queda disponible por defecto en `http://localhost:5173`.

## Comandos utiles

```bash
npm run lint
npm run typecheck
npm run build
npm run preview
```

## Estructura base

```text
docs/
src/
  app/
  components/
  lib/
  styles/
```

La pantalla inicial es minima y solo confirma que el frontend esta operativo y que el proyecto esta listo para conectar con Supabase.