"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import LocateButton, { LOCATE_ZOOM } from "./LocateButton";
import LocationSearch from "./LocationSearch";
import RainLegend from "./RainLegend";
import NotificationButton from "./NotificationButton";
import { setLocationTags } from "@/lib/onesignal";
import {
  buildTileUrl,
  fetchRainviewerData,
  formatFrameTime,
  RADAR_MAX_ZOOM,
  RADAR_MIN_ZOOM,
  type RadarFrame,
  type RainviewerData,
} from "@/lib/rainviewer";
import {
  detectRainApproach,
  MAX_ETA_MINUTES,
  type RainApproachResult,
} from "@/lib/rainDetection";
import { lightenTowardWhite, mmPerHourToColor } from "@/lib/rainColorScale";
import { buildAlertBody, buildAlertTitle, formatHorizonPhrase } from "@/lib/alertMessage";
// Si no hay una intensidad concreta (p. ej. previsión sin dato de color),
// se colorea el aviso como una lluvia ligera en vez de con un color fijo.
const DEFAULT_ALERT_MM_PER_HOUR = 2;

// Los iconos por defecto de Leaflet apuntan a rutas locales que el bundler
// de Next no resuelve; se sustituyen por los del CDN.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const ANIMATION_INTERVAL_MS = 700;
// Espera antes de reintentar una tesela que falla (p. ej. por el límite de
// ráfaga de RainViewer), en vez de dejarla en blanco para siempre. Tiene que
// ser generosa y con azar: RainViewer devuelve 429 (Too Many Requests) real
// durante un rato una vez que se dispara el límite, así que reintentar rápido
// solo añade más peticiones al mismo atasco y lo alimenta (comprobado: con un
// retardo corto, los reintentos de varios frames que fallan a la vez acaban
// chocando entre sí y el 429 no para de repetirse).
const TILE_RETRY_DELAY_MS = 2000;
// Cuántos frames se mantienen como capas de Leaflet activas a la vez. Cada
// capa montada vuelve a pedir su cuadrícula de teselas en cualquier zoom o
// desplazamiento del mapa; con los 13 frames montados a la vez, cualquier
// zoom multiplicaba por 13 las peticiones simultáneas y disparaba el límite
// de ráfaga de RainViewer incluso para el frame que se estaba viendo. Con
// una ventana pequeña, el frame más antiguo se descarta al añadir uno nuevo
// y se recarga solo (con calma) si la animación vuelve a necesitarlo. Con
// ventanas de navegador grandes o zooms muy alejados hay bastantes más
// teselas por capa, así que se deja un margen extra pequeño.
const MAX_LIVE_FRAMES = 2;
// Si un frame lleva más de esto sin terminar de cargar (p. ej. porque su
// zona quedó atrapada en el límite de ráfaga tras un zoom), se avanza igual
// en vez de congelar la animación esperando algo que puede tardar mucho.
const MAX_FRAME_WAIT_MS = 6000;
// El mapa en sí puede acercarse mucho más que el radar (para ver calles y
// detalle del callejero). Cuando se supera RADAR_MAX_ZOOM, Leaflet no pide
// teselas de radar inexistentes: usa "maxNativeZoom" para estirar la última
// tesela real (zoom 7) en vez de fallar con "zoom not supported".
const MAP_MAX_ZOOM = 18;
const MADRID: [number, number] = [40.4168, -3.7038];

export default function WeatherMap() {
  const [radar, setRadar] = useState<RainviewerData | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  // Solo afecta a móvil: si están desplegados los ajustes (fotograma y
  // opacidad) bajo la barra compacta. En pantallas grandes se ven siempre.
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // En estado (no en ref): react-leaflet rellena la ref del MapContainer en
  // un render posterior al montaje, así que un efecto con deps [] la vería
  // siempre null. Con estado, los efectos que dependen del mapa se re-ejecutan
  // cuando la instancia existe de verdad.
  const [map, setMap] = useState<L.Map | null>(null);
  // Frames cuya capa ya terminó de cargar sus teselas al menos una vez.
  const loadedPathsRef = useRef<Set<string>>(new Set());
  // Orden de uso de los frames con capa activa (el más reciente al final);
  // define la ventana móvil de MAX_LIVE_FRAMES y qué se restaura tras un
  // zoom (independiente de cuáles se ocultan temporalmente durante este).
  const liveOrderRef = useRef<string[]>([]);
  // Path del frame visible ahora mismo, legible desde los handlers de zoom
  // sin tener que añadir "currentFrame" a sus dependencias.
  const currentFramePathRef = useRef<string | null>(null);

  function addToLiveWindow(path: string) {
    const order = liveOrderRef.current;
    const idx = order.indexOf(path);
    if (idx !== -1) order.splice(idx, 1);
    order.push(path);
    while (order.length > MAX_LIVE_FRAMES) {
      const evicted = order.shift();
      if (evicted) loadedPathsRef.current.delete(evicted);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchRainviewerData();
        if (cancelled) return;
        setRadar(data);
        setFrameIndex(data.past.length - 1); // empezar mostrando el frame más reciente
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      }
    }

    load();
    const refreshTimer = setInterval(load, 5 * 60 * 1000); // refrescar metadatos cada 5 min

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, []);

  const frames: RadarFrame[] = useMemo(
    () => (radar ? [...radar.past, ...radar.nowcast] : []),
    [radar]
  );

  // Se pausa el avance automático de frames mientras el usuario está
  // haciendo zoom (y un momento después) para no sumar carga de red a la
  // que ya provoca el propio zoom. Además, mientras dura el zoom se ocultan
  // (desmontan) las capas de radar que no sean la que se está mostrando: al
  // ser pocas (ventana móvil) el impacto ya es pequeño, pero se evita
  // sumarlas del todo a la ráfaga del propio zoom. Al ocultarlas no pasa
  // nada visible (estaban a opacidad 0) y la visible recarga sola. Pasado un
  // margen se devuelven en segundo plano, sin afectar a la animación.
  const [zooming, setZooming] = useState(false);
  useEffect(() => {
    if (!map) return;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    const onZoomStart = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      if (restoreTimer) clearTimeout(restoreTimer);
      setZooming(true);
      const current = currentFramePathRef.current;
      setShownPaths((prev) => (prev.size <= 1 ? prev : new Set(current ? [current] : [])));
    };
    const onZoomEnd = () => {
      resumeTimer = setTimeout(() => setZooming(false), 1000);
      restoreTimer = setTimeout(() => {
        setShownPaths(new Set(liveOrderRef.current));
      }, 2500);
    };
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      if (restoreTimer) clearTimeout(restoreTimer);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
    };
  }, [map]);

  // Path del frame en el que la animación lleva esperando a que cargue, y
  // desde cuándo, para poder forzar el avance si tarda demasiado.
  const stuckSinceRef = useRef<{ path: string; since: number } | null>(null);

  useEffect(() => {
    if (!playing || zooming || frames.length === 0) return;

    timerRef.current = setInterval(() => {
      setFrameIndex((prev) => {
        // No avanzar hasta que el frame actual haya cargado: así la primera
        // pasada va al ritmo que el servidor permite en vez de lanzar todas
        // las peticiones de golpe (lo que dispara su límite de ráfaga). Pero
        // si lleva demasiado tiempo sin cargar (p. ej. tras un zoom que la
        // dejó atrapada en el límite de ráfaga), se avanza igualmente para
        // no congelar la animación indefinidamente.
        const current = frames[prev];
        if (current && !loadedPathsRef.current.has(current.path)) {
          const now = Date.now();
          if (stuckSinceRef.current?.path !== current.path) {
            stuckSinceRef.current = { path: current.path, since: now };
          }
          if (now - stuckSinceRef.current.since < MAX_FRAME_WAIT_MS) return prev;
        }
        stuckSinceRef.current = null;
        return (prev + 1) % frames.length;
      });
    }, ANIMATION_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, zooming, frames]);

  const currentFrame = frames[frameIndex];

  // Cada frame se monta como capa propia la primera vez que se muestra (en
  // vez de reutilizar una única capa cambiándole la url, que provoca que
  // Leaflet borre y vuelva a pedir todas las teselas en cada tick). Solo se
  // mantienen activas las últimas MAX_LIVE_FRAMES; al superar ese número se
  // descarta la más antigua y se recargará sola si la animación vuelve a
  // pasar por ella.
  const [shownPaths, setShownPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!currentFrame) return;
    currentFramePathRef.current = currentFrame.path;
    addToLiveWindow(currentFrame.path);
    setShownPaths(new Set(liveOrderRef.current));
  }, [currentFrame]);

  // Detección de lluvia acercándose: se repite cada vez que llega ubicación
  // nueva o se refrescan los metadatos del radar (cada 5 min), analizando
  // teselas alrededor de la ubicación del usuario (ver lib/rainDetection.ts).
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [rainAlert, setRainAlert] = useState<RainApproachResult>({ status: "unknown" });
  const rainCheckRunIdRef = useRef(0);
  // Marcador de la última población buscada a mano (se sustituye si se busca
  // otra), independiente del marcador de "mi ubicación" que pinta LocateButton.
  const searchMarkerRef = useRef<L.Marker | null>(null);

  // Fija una ubicación a analizar y pinta su marcador. "recenter" solo se usa
  // para la búsqueda por nombre (mueve el mapa hasta ella); al proponer una
  // ubicación con Shift+clic no se recentra, porque ya se ve dónde se pincha.
  function selectLocation(
    location: { lat: number; lon: number },
    { recenter, popupText }: { recenter: boolean; popupText: string }
  ) {
    setUserLocation(location);
    if (!map) return;
    if (searchMarkerRef.current) map.removeLayer(searchMarkerRef.current);
    searchMarkerRef.current = L.marker([location.lat, location.lon])
      .addTo(map)
      .bindPopup(popupText)
      .openPopup();
    if (recenter) map.setView([location.lat, location.lon], LOCATE_ZOOM);
  }

  function handleManualLocation(location: { lat: number; lon: number }) {
    selectLocation(location, { recenter: true, popupText: "Ubicación buscada" });
  }

  // selectLocation en una ref para poder llamarla desde el handler de clic del
  // mapa sin re-suscribir el evento en cada render (patrón usado también en
  // LocateButton). La ref se actualiza cada render con la versión que cierra
  // sobre el "map" actual.
  const selectLocationRef = useRef(selectLocation);
  selectLocationRef.current = selectLocation;

  // Shift + clic izquierdo en el mapa: propone esa ubicación para analizarla.
  useEffect(() => {
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (!e.originalEvent?.shiftKey) return;
      selectLocationRef.current(
        { lat: e.latlng.lat, lon: e.latlng.lng },
        { recenter: false, popupText: "Ubicación seleccionada" }
      );
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  // Al abrir la app desde una notificación push, la URL trae ?lat=&lon= de la
  // zona del aviso: se centra el mapa ahí y se analiza esa ubicación, para que
  // el usuario vea directamente de qué le estamos avisando. Se hace una sola vez
  // y se limpia la URL para que un refresco manual no lo repita.
  const appliedUrlLocationRef = useRef(false);
  useEffect(() => {
    if (!map || appliedUrlLocationRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("lat") || !params.has("lon")) return;
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    appliedUrlLocationRef.current = true;
    selectLocationRef.current({ lat, lon }, { recenter: true, popupText: "Zona del aviso" });
    window.history.replaceState(null, "", window.location.pathname);
  }, [map]);

  // Al CAMBIAR de ubicación, se muestra "Analizando…" en vez de mantener el
  // mensaje de la ubicación anterior mientras se procesan los frames. No se
  // hace en el refresco periódico del radar (misma ubicación): ahí se conserva
  // el mensaje actual y se actualiza sin parpadeo cuando termina el análisis.
  useEffect(() => {
    if (userLocation) setRainAlert({ status: "analyzing" });
  }, [userLocation]);

  useEffect(() => {
    if (!radar || !userLocation) return;
    const runId = ++rainCheckRunIdRef.current;

    detectRainApproach(radar.host, radar.past, radar.nowcast, userLocation)
      .then((result) => {
        if (rainCheckRunIdRef.current === runId) setRainAlert(result);
      })
      .catch(() => {
        if (rainCheckRunIdRef.current === runId) setRainAlert({ status: "unknown" });
      });
  }, [radar, userLocation]);

  // Guarda la ubicación en OneSignal cada vez que cambie, para que el
  // comprobador de la nube pueda enviar avisos push de la zona del usuario.
  useEffect(() => {
    if (userLocation) setLocationTags(userLocation.lat, userLocation.lon);
  }, [userLocation]);

  const alertKey =
    rainAlert.status === "raining"
      ? `raining-${rainAlert.time}`
      : rainAlert.status === "approaching"
        ? `approaching-${rainAlert.etaMinutes}`
        : null;
  const [dismissedAlertKey, setDismissedAlertKey] = useState<string | null>(null);
  const showRainAlert = alertKey !== null && alertKey !== dismissedAlertKey;

  // El aviso se colorea con el color real de la escala de intensidad (el
  // mismo de la leyenda) y parpadea cada segundo virando hacia una versión
  // más clara, para llamar la atención de forma proporcional a la gravedad.
  // Se usa la intensidad MÁS FUERTE que se acerca (si dentro del frente viene
  // un núcleo más activo, manda ese, no la llovizna del borde).
  const alertMmPerHour = (() => {
    if (rainAlert.status !== "raining" && rainAlert.status !== "approaching") {
      return DEFAULT_ALERT_MM_PER_HOUR;
    }
    const base = rainAlert.mmPerHour ?? 0;
    const peak =
      rainAlert.status === "approaching" && rainAlert.intensification
        ? rainAlert.intensification.mmPerHour
        : 0;
    const strongest = Math.max(base, peak);
    return strongest > 0 ? strongest : DEFAULT_ALERT_MM_PER_HOUR;
  })();
  const alertBaseColor = mmPerHourToColor(alertMmPerHour);
  const alertPulseColor = lightenTowardWhite(alertBaseColor, 0.6);

  const alertMessage = buildAlertBody(rainAlert);

  // Notificación del sistema cuando salta un aviso nuevo (mismo mensaje que el
  // banner en pantalla). Solo si hay permiso y la pestaña NO está en primer
  // plano: con la app a la vista ya se ve el banner; esto es para cuando está
  // en segundo plano. (Con la app CERRADA el aviso llega por el comprobador de
  // la nube, paso 3, para no depender de que el navegador esté abierto.)
  const lastNotifiedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !alertKey || !alertMessage) return;
    if (lastNotifiedKeyRef.current === alertKey) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    lastNotifiedKeyRef.current = alertKey;

    const title = buildAlertTitle(rainAlert);
    (async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const options: NotificationOptions = {
          body: alertMessage,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "rain-alert",
        };
        if (reg) reg.showNotification(title, options);
        else new Notification(title, options);
      } catch {
        // Notificaciones no disponibles: se ignora (el banner en pantalla sigue).
      }
    })();
  }, [alertKey, alertMessage, rainAlert.status]);

  function retryFailedTile(e: L.TileErrorEvent) {
    const tile = e.tile as HTMLImageElement;
    const url = new URL(tile.src);
    // Parámetro anti-caché: reasignar el mismo src no fuerza al navegador a
    // reintentar la descarga. Retardo con azar para que los reintentos no
    // formen otra ráfaga sincronizada contra el servidor de RainViewer.
    url.searchParams.set("retry", String(Date.now()));
    const delay = TILE_RETRY_DELAY_MS + Math.random() * 3000;
    setTimeout(() => {
      tile.src = url.toString();
    }, delay);
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={setMap}
        center={MADRID}
        zoom={6}
        minZoom={RADAR_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        zoomAnimation={false}
        className="h-full w-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={MAP_MAX_ZOOM}
        />
        {radar &&
          frames
            .filter((frame) => shownPaths.has(frame.path))
            .map((frame) => (
              <TileLayer
                key={frame.path}
                className="radar-frame-layer"
                url={buildTileUrl(radar.host, frame)}
                opacity={frame.path === currentFrame?.path ? opacity : 0}
                zIndex={10}
                maxNativeZoom={RADAR_MAX_ZOOM}
                minNativeZoom={RADAR_MIN_ZOOM}
                // Sin margen extra de teselas fuera de la pantalla visible (a
                // diferencia del mapa base, aquí cada tesela de más cuenta
                // para el límite de ráfaga de RainViewer) y sin pedir teselas
                // nuevas hasta que el arrastre del mapa termina, en vez de ir
                // pidiéndolas sobre la marcha durante el propio arrastre.
                keepBuffer={0}
                updateWhenIdle={true}
                eventHandlers={{
                  load: () => loadedPathsRef.current.add(frame.path),
                  tileerror: retryFailedTile,
                }}
              />
            ))}
      </MapContainer>

      {/* Controles de zoom propios (en vez del de Leaflet) en el borde derecho,
          centrados en vertical: así no compiten con la barra inferior ni con la
          búsqueda, que era lo que se solapaba en móvil. Se mantienen los +/− por
          petición; el pellizco sigue funcionando igual. */}
      <div className="pointer-events-auto absolute top-1/2 right-2 z-[1000] flex -translate-y-1/2 flex-col overflow-hidden rounded-md shadow-md">
        <button
          onClick={() => map?.zoomIn()}
          className="border-b border-gray-200 bg-white px-3 py-2 text-lg leading-none text-gray-800 hover:bg-gray-100"
          aria-label="Acercar"
        >
          +
        </button>
        <button
          onClick={() => map?.zoomOut()}
          className="bg-white px-3 py-2 text-lg leading-none text-gray-800 hover:bg-gray-100"
          aria-label="Alejar"
        >
          −
        </button>
      </div>

      {/* Franja superior: búsqueda + mi ubicación y, debajo, los avisos. La
          búsqueda estaba antes abajo a la izquierda y en móvil tapaba al resto;
          aquí ocupa su propia franja. El contenedor deja pasar los gestos al
          mapa (pointer-events-none) salvo en los propios controles. */}
      <div className="pointer-events-none absolute top-2 left-1/2 z-[1000] flex w-[min(96vw,42rem)] -translate-x-1/2 flex-col gap-2">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <LocationSearch onLocationFound={handleManualLocation} />
          <LocateButton map={map} onLocationFound={setUserLocation} />
          <NotificationButton hasLocation={!!userLocation} />
        </div>

        {showRainAlert && (
          <div
            className="rain-alert-pulse pointer-events-auto flex items-start gap-2 rounded-lg p-3 shadow-lg"
            style={
              {
                "--alert-color-a": alertBaseColor,
                "--alert-color-b": alertPulseColor,
              } as CSSProperties
            }
          >
            <span className="text-xl leading-none">
              {rainAlert.status === "raining" ? "🌧️" : "⛈️"}
            </span>
            <p className="flex-1 text-sm font-medium text-gray-900">{alertMessage}</p>
            <button
              onClick={() => setDismissedAlertKey(alertKey)}
              className="text-gray-500 hover:text-gray-900"
              aria-label="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        )}

        {!showRainAlert && rainAlert.status === "clear" && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/95 p-2.5 shadow-lg backdrop-blur">
            <span className="text-lg leading-none">✅</span>
            <p className="flex-1 text-sm text-emerald-900">
              No se esperan lluvias en tu zona {formatHorizonPhrase(MAX_ETA_MINUTES)}.
            </p>
          </div>
        )}

        {rainAlert.status === "analyzing" && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow-lg backdrop-blur">
            <span className="text-lg leading-none">⏳</span>
            <p className="flex-1 text-sm text-slate-700">Analizando tu zona…</p>
          </div>
        )}
      </div>

      {/* Franja inferior: leyenda fina (siempre visible) + barra de
          reproducción, apiladas y centradas. Nada más ocupa esta zona: el zoom
          va al borde derecho y la búsqueda arriba. */}
      <div className="pointer-events-none absolute bottom-2 left-1/2 z-[1000] flex w-[min(96vw,32rem)] -translate-x-1/2 flex-col gap-2 sm:bottom-4">
        {radar && (
          <div className="pointer-events-auto">
            <RainLegend />
          </div>
        )}

        <div className="pointer-events-auto rounded-lg bg-white/95 p-2 shadow-lg backdrop-blur sm:p-3">
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          {!radar && !error && <p className="text-sm text-gray-600">Cargando radar en directo…</p>}

          {radar && frames.length > 0 && (
            <>
            {/* Fila siempre visible: lo mínimo para saber qué se está viendo.
                En móvil ocupa una sola franja y deja el mapa despejado. */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                aria-label={playing ? "Pausar" : "Reproducir"}
              >
                {playing ? "⏸" : "▶"}
                <span className="hidden sm:inline">{playing ? " Pausa" : " Reproducir"}</span>
              </button>
              <span className="text-sm font-medium tabular-nums text-gray-800">
                {formatFrameTime(currentFrame.time)}
              </span>
              <span className="text-xs text-gray-600">
                {currentFrame.time > (radar.past.at(-1)?.time ?? 0) ? "Previsión" : "Pasado"}
              </span>
              <div className="flex-1" />
              {/* Solo en móvil: despliega los ajustes que ahí no caben. */}
              <button
                onClick={() => setControlsExpanded((v) => !v)}
                className="rounded-md px-2 py-1 text-base text-gray-600 hover:bg-gray-100 sm:hidden"
                aria-label="Ajustes de reproducción"
                aria-expanded={controlsExpanded}
              >
                ⚙
              </button>
            </div>

            {/* Ajustes: ocultos en móvil hasta pulsar ⚙; en pantallas grandes
                siempre visibles, porque ahí sí hay sitio. */}
            <div className={`${controlsExpanded ? "block" : "hidden"} sm:block`}>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                <span className="w-20 shrink-0">Fotograma</span>
                <input
                  type="range"
                  min={0}
                  max={frames.length - 1}
                  value={frameIndex}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrameIndex(Number(e.target.value));
                  }}
                  className="flex-1"
                />
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                <span className="w-20 shrink-0">Opacidad</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.1}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="flex-1"
                />
              </div>
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
