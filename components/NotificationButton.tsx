"use client";

import { useEffect, useState } from "react";
import {
  disableNotifications,
  enableNotifications,
  initOneSignal,
  onSubscriptionChange,
  readState,
} from "@/lib/onesignal";

type NotificationButtonProps = {
  // Si el usuario ya ha fijado una ubicación: los avisos por zona la necesitan,
  // así que si no la hay se sugiere activarla (en el título).
  hasLocation: boolean;
};

export default function NotificationButton({ hasLocation }: NotificationButtonProps) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on">("loading");

  useEffect(() => {
    initOneSignal();
    readState(({ supported, optedIn }) =>
      setState(!supported ? "unsupported" : optedIn ? "on" : "off")
    );
    onSubscriptionChange((optedIn) =>
      setState((prev) => (prev === "unsupported" ? prev : optedIn ? "on" : "off"))
    );
  }, []);

  // En navegadores sin push (p. ej. iPhone con la web SIN instalar) no se
  // muestra el botón: no funcionaría y solo confundiría.
  if (state === "unsupported") return null;

  const on = state === "on";

  function toggle() {
    if (on) disableNotifications();
    else enableNotifications();
  }

  const title = on
    ? hasLocation
      ? "Avisos de lluvia activados. Pulsa para desactivar."
      : "Avisos activados. Fija tu ubicación (📍) para recibir avisos de tu zona."
    : "Activar avisos de lluvia por notificación";

  return (
    <button
      onClick={toggle}
      disabled={state === "loading"}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium shadow-md disabled:opacity-60 ${
        on ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-white text-gray-800 hover:bg-gray-100"
      }`}
      title={title}
      aria-label={on ? "Desactivar avisos de lluvia" : "Activar avisos de lluvia"}
      aria-pressed={on}
    >
      <span className="text-base leading-none">{on ? "🔔" : "🔕"}</span>
      <span className="hidden sm:inline">{on ? "Avisos" : "Avisos"}</span>
    </button>
  );
}
