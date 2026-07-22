// Texto de los avisos de lluvia. Vive aparte (y sin nada de navegador) para que
// lo compartan la app (banner + notificación del sistema) y el comprobador de
// la nube (push): así el mensaje que llega al móvil es idéntico al de la app.
import { intensityCategory } from "./rainColorScale";
import { MAX_ETA_MINUTES, type RainApproachResult, type RainTrend } from "./rainDetection";

function formatMmPerHour(value: number | null): string | null {
  if (value === null) return null;
  return value < 1 ? value.toFixed(1) : Math.round(value).toString();
}

// Nombre de la intensidad con su cifra: "lluvia moderada (6 l/m²/h)". La
// categoría va por delante para que se entienda de un vistazo la magnitud real.
export function intensityPhrase(mmPerHour: number): string {
  const mmText = formatMmPerHour(mmPerHour);
  const label = intensityCategory(mmPerHour);
  return mmText ? `${label} (${mmText} l/m²/h)` : label;
}

// Con el horizonte de aviso ampliado a 60 min, una ETA ya puede valer una hora
// entera: por debajo se muestra en minutos, en esa frontera (o por encima) en
// horas.
export function formatEtaDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = hours === 1 ? "1 hora" : `${hours} horas`;
  return rest === 0 ? hoursText : `${hoursText} ${rest} min`;
}

// "en unos 1 min" suena mal y, tan cerca, el dato no da para precisar: por
// debajo de 3 minutos se habla de algo inminente.
function formatEtaSoon(minutes: number): string {
  if (minutes <= 2) return "de forma inminente";
  return `en unos ${formatEtaDuration(minutes)}`;
}

export function formatHorizonPhrase(minutes: number): string {
  if (minutes % 60 === 0 && minutes > 0) {
    const hours = minutes / 60;
    return hours === 1 ? "en la próxima hora" : `en las próximas ${hours} horas`;
  }
  return `en los próximos ${minutes} min`;
}

function formatTrend(trend: RainTrend | null): string {
  if (!trend) return "";
  switch (trend.kind) {
    case "increasing": {
      const target = trend.mmPerHour ? ` a ${intensityPhrase(trend.mmPerHour)}` : "";
      return trend.etaMinutes
        ? ` Es probable que aumente${target} ${formatEtaSoon(trend.etaMinutes)}.`
        : ` Es probable que vaya aumentando${target} en los próximos minutos.`;
    }
    case "ending":
      return ` Es probable que deje de llover ${formatEtaSoon(trend.etaMinutes)}.`;
    case "steady":
      return ` Se mantendrá una intensidad parecida durante al menos ${formatEtaDuration(trend.forMinutes)}.`;
    case "decreasing":
      return trend.etaMinutes
        ? ` Es probable que remita ${formatEtaSoon(trend.etaMinutes)}.`
        : " Es probable que vaya remitiendo en los próximos minutos.";
  }
}

// Título corto del aviso (encabezado de la notificación / del banner).
export function buildAlertTitle(rainAlert: RainApproachResult): string {
  return rainAlert.status === "raining" ? "Está lloviendo en tu zona" : "Se acerca lluvia";
}

// Cuerpo del aviso (mismo texto en app y push). Devuelve null si el estado no es
// de aviso (clear/analyzing/unknown).
export function buildAlertBody(rainAlert: RainApproachResult): string | null {
  if (rainAlert.status === "raining") {
    const clause = rainAlert.mmPerHour !== null ? `: ${intensityPhrase(rainAlert.mmPerHour)}` : "";
    return `Está lloviendo ahora mismo en tu ubicación${clause}.${formatTrend(rainAlert.trend)}`;
  }
  if (rainAlert.status === "approaching") {
    const onsetEta = formatEtaDuration(rainAlert.etaMinutes);
    const peak = rainAlert.intensification;
    // Solo se habla de dos fases si el núcleo que viene detrás sube de categoría
    // respecto a lo primero que llega; si no, un único mensaje simple.
    if (peak && rainAlert.mmPerHour !== null) {
      return `Se acerca lluvia a tu ubicación: empieza con ${intensityPhrase(
        rainAlert.mmPerHour
      )} ${formatEtaSoon(rainAlert.etaMinutes)}, y puede intensificarse a ${intensityPhrase(
        peak.mmPerHour
      )} hacia los ${formatEtaDuration(peak.etaMinutes)}.`;
    }
    const what = rainAlert.mmPerHour !== null ? intensityPhrase(rainAlert.mmPerHour) : "lluvia";
    return `Se acerca ${what} a tu ubicación. Llegada estimada: ${onsetEta}.`;
  }
  return null;
}
