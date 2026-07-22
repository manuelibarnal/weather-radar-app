# Comprobador de lluvia (push con la app cerrada)

Este directorio contiene el "comprobador" que corre **en la nube** (GitHub
Actions), revisa el radar por la zona de cada suscriptor y envía un aviso
**push** por OneSignal cuando llueve o se acerca lluvia. Es lo que permite que
el aviso llegue al móvil **aunque la app esté cerrada** (la app, cerrada, no
puede vigilar el radar por sí misma).

Reutiliza exactamente la misma lógica de detección y el mismo texto que la app
(`lib/rainDetection.ts` y `lib/alertMessage.ts`); aquí solo cambia de dónde
salen los píxeles del radar (se decodifican los PNG con `pngjs` en vez de usar
el canvas del navegador).

## Archivos

- `tiles.ts` — descarga y compone las teselas del radar en Node (con caché y
  reintento ante el error 429 de RainViewer).
- `detect.ts` — `detectRainApproachNode`: la detección, sin navegador.
- `onesignal.ts` — cliente REST de OneSignal (listar suscriptores, enviar push).
- `index.ts` — orquestador: suscriptores → detección por zona → push.
- `state.json` — recuerda qué se ha avisado ya, para no repetir (lo actualiza
  el propio workflow).
- `dryrun.ts`, `diag.ts` — herramientas de prueba manual.

## Puesta en marcha

1. **Configura OneSignal** (una vez): en el panel, activa el Web Push y anota tu
   App ID y tu REST API Key (Settings → Keys & IDs).
2. **Secretos de GitHub** (repo → Settings → Secrets and variables → Actions):
   - `ONESIGNAL_REST_API_KEY` — la clave secreta (obligatoria).
   - `ONESIGNAL_APP_ID` — opcional (si no, usa el App ID por defecto del código).
3. Sube el repo a GitHub. El workflow `.github/workflows/rain-check.yml` se
   ejecuta solo cada ~15 min (o a mano desde la pestaña **Actions**).

## Probar en local sin enviar nada

```bash
# Solo detección para una ubicación:
npx tsx checker/dryrun.ts 40.4168 -3.7038

# Flujo completo en seco (lista suscriptores y dice qué enviaría, sin enviar).
# Requiere la REST key en el entorno:
ONESIGNAL_REST_API_KEY=... npx tsx checker/index.ts --dry
```

## Notas / límites

- **RainViewer limita por ráfaga** (error 429). El comprobador pide las teselas
  despacio, con caché y reintentos. Aun así, cuantos más suscriptores en zonas
  distintas, más teselas por pasada: ajusta `MAX_CELLS` y `CELL_DECIMALS` si
  hace falta (variables de entorno).
- **Listado de suscriptores**: usa el endpoint `/players`. Si OneSignal lo
  tuviera desactivado para tu app, habría que migrar a la exportación de
  usuarios (CSV). Para pocos suscriptores, `/players` es suficiente.
- **Frecuencia**: GitHub Actions no garantiza el minuto exacto del cron y su
  mínimo real ronda los 5 min; por eso 15 min. Para "lluvia inminente" al
  segundo esto no basta, pero para "va a llover en tu zona" cumple.

## Variables de entorno

| Variable | Por defecto | Qué hace |
|----------|-------------|----------|
| `ONESIGNAL_REST_API_KEY` | — | Clave secreta de OneSignal (obligatoria) |
| `ONESIGNAL_APP_ID` | App ID público del código | Identifica la app |
| `CELL_DECIMALS` | `1` | Agrupa ubicaciones (1 ≈ 11 km) |
| `MAX_CELLS` | `40` | Máximo de zonas por pasada |
