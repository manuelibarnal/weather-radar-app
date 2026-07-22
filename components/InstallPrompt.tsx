"use client";

import { useEffect, useState } from "react";

// Evento no estándar de Chromium (aún no está en los tipos de TS): el navegador
// lo dispara cuando la web cumple los requisitos de PWA instalable, y permite
// mostrar el diálogo de instalación nativo cuando el usuario lo pida.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "pwa-install-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari en iOS no usa display-mode; expone navigator.standalone.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Ya instalada, o el usuario ya cerró el aviso: no molestar.
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === "1") return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(ios);

    // Android/Chrome/Edge: se captura el evento para poder lanzar el diálogo
    // nativo desde nuestro botón (en vez de dejar que el navegador decida).
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS no dispara ese evento: si es un iPhone/iPad sin instalar, se muestran
    // las instrucciones manuales (Compartir → Añadir a pantalla de inicio).
    if (ios) setVisible(true);

    // Si se instala, ocultar el aviso.
    const onInstalled = () => {
      setVisible(false);
      localStorage.setItem(DISMISS_KEY, "1");
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  }

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/2 z-[1100] flex -translate-y-1/2 justify-center p-2">
      <div className="pointer-events-auto flex w-[min(96vw,30rem)] items-center gap-3 rounded-lg border border-blue-200 bg-white/95 p-3 shadow-xl backdrop-blur">
        <span className="text-2xl leading-none">📲</span>
        <div className="flex-1 text-sm text-gray-800">
          {isIOS ? (
            <p>
              Instala la app: pulsa <span className="font-medium">Compartir</span> y luego{" "}
              <span className="font-medium">Añadir a pantalla de inicio</span>.
            </p>
          ) : (
            <p>Instala el radar como app en tu móvil para abrirlo a pantalla completa.</p>
          )}
        </div>
        {!isIOS && deferredPrompt && (
          <button
            onClick={install}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Instalar
          </button>
        )}
        <button
          onClick={dismiss}
          className="shrink-0 text-gray-500 hover:text-gray-900"
          aria-label="Cerrar aviso de instalación"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
