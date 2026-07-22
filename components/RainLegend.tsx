"use client";

import { LEGEND_GRADIENT_STOPS, LEGEND_LABELS } from "@/lib/rainColorScale";

function formatMmPerHour(value: number): string {
  if (value < 1) return value.toFixed(1);
  return Math.round(value).toString();
}

export default function RainLegend() {
  const gradient = `linear-gradient(to right, ${LEGEND_GRADIENT_STOPS.map(
    (s) => `${s.hex} ${s.percent}%`
  ).join(", ")})`;

  return (
    <div className="w-full rounded-lg bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur sm:py-2.5">
      {/* El título ocupa sitio y en móvil estorba: ahí basta con la barra de
          color y sus cifras (la unidad se sobreentiende). En pantallas grandes
          sí se muestra el rótulo completo. */}
      <p className="mb-1.5 hidden text-xs font-medium text-gray-700 sm:block">
        Intensidad de lluvia (l/m²/h)
      </p>
      {/* La barra y las etiquetas deben tener exactamente el mismo ancho y
          origen para que los porcentajes de cada una coincidan en vertical. */}
      <div className="h-3 w-full rounded-full" style={{ background: gradient }} />
      <div className="relative mt-1 h-4 w-full text-[10px] text-gray-600">
        {LEGEND_LABELS.map((label, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{ left: `${label.percent}%` }}
          >
            {formatMmPerHour(label.mmPerHour)}
          </span>
        ))}
      </div>
    </div>
  );
}
