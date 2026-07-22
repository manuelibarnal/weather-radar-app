// Integración con OneSignal (Web Push) para la app estática. El SDK se carga
// por CDN y todo se encola en window.OneSignalDeferred, que el SDK vacía cuando
// termina de inicializarse (así da igual el orden en que se llame a estas
// funciones respecto a la carga del script).

// El App ID es PÚBLICO (identifica la app en OneSignal, no da acceso a nada).
// La clave secreta (REST API Key) NO va aquí: solo en el comprobador de la nube.
export const ONESIGNAL_APP_ID =
  process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID ?? "c795e54f-1c18-4eaf-aa8f-a3e5608c3f52";

// Tipos mínimos de las partes del SDK v16 que usamos (el SDK no trae tipos).
type PushSubscription = {
  optedIn?: boolean;
  optIn: () => Promise<void>;
  optOut: () => Promise<void>;
  addEventListener: (
    event: "change",
    cb: (e: { current?: { optedIn?: boolean } }) => void
  ) => void;
};
type OneSignalSDK = {
  init: (opts: { appId: string; allowLocalhostAsSecureOrigin?: boolean }) => Promise<void>;
  Notifications: {
    permission: boolean;
    isPushSupported?: () => boolean;
    requestPermission: () => Promise<void>;
  };
  User: {
    addTags: (tags: Record<string, string>) => void;
    PushSubscription: PushSubscription;
  };
};
type DeferredItem = (OneSignal: OneSignalSDK) => void | Promise<void>;

declare global {
  interface Window {
    OneSignalDeferred?: DeferredItem[];
  }
}

function enqueue(cb: DeferredItem) {
  if (typeof window === "undefined") return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(cb);
}

let started = false;

// Carga el SDK e inicializa OneSignal una sola vez. Idempotente.
export function initOneSignal() {
  if (typeof window === "undefined" || started) return;
  started = true;

  if (!document.querySelector("script[data-onesignal]")) {
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    script.setAttribute("data-onesignal", "true");
    document.head.appendChild(script);
  }

  enqueue(async (OneSignal) => {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      // Permite probar por http://localhost (en producción se ignora; exige https).
      allowLocalhostAsSecureOrigin: true,
    });
  });
}

// Lee si el push está soportado y si el usuario ya está suscrito.
export function readState(cb: (s: { supported: boolean; optedIn: boolean }) => void) {
  enqueue((OneSignal) => {
    const supported = OneSignal.Notifications.isPushSupported?.() ?? true;
    cb({ supported, optedIn: OneSignal.User.PushSubscription.optedIn === true });
  });
}

// Avisa cuando cambia el estado de suscripción (activó/desactivó, etc.).
export function onSubscriptionChange(cb: (optedIn: boolean) => void) {
  enqueue((OneSignal) => {
    OneSignal.User.PushSubscription.addEventListener("change", (e) => {
      cb(e.current?.optedIn === true);
    });
  });
}

// Activa los avisos: pide permiso (si hace falta) y suscribe al usuario.
export function enableNotifications() {
  enqueue(async (OneSignal) => {
    if (!OneSignal.Notifications.permission) {
      await OneSignal.Notifications.requestPermission();
    }
    await OneSignal.User.PushSubscription.optIn();
  });
}

// Desactiva los avisos (deja de recibir push, sin borrar permiso del navegador).
export function disableNotifications() {
  enqueue(async (OneSignal) => {
    await OneSignal.User.PushSubscription.optOut();
  });
}

// Guarda la ubicación del usuario como tags, para que el comprobador de la nube
// pueda enviarle avisos de SU zona (filtrando por estos tags en la API REST).
export function setLocationTags(lat: number, lon: number) {
  enqueue((OneSignal) => {
    OneSignal.User.addTags({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  });
}
