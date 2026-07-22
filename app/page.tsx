"use client";

import dynamic from "next/dynamic";
import InstallPrompt from "@/components/InstallPrompt";

const WeatherMap = dynamic(() => import("@/components/WeatherMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-gray-500">
      Cargando mapa…
    </div>
  ),
});

export default function Home() {
  return (
    <div className="h-dvh w-dvw">
      <WeatherMap />
      <InstallPrompt />
    </div>
  );
}
