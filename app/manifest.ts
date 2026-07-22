import type { MetadataRoute } from "next";

// Con "output: export" (sitio estático) las rutas de metadatos deben marcarse
// como estáticas explícitamente para que se generen como fichero en el build.
export const dynamic = "force-static";

// Manifest de la PWA (Next lo genera como /manifest.webmanifest y añade el
// <link rel="manifest"> automáticamente). Es lo que permite "instalar" la app
// en el móvil y que se abra a pantalla completa, sin la barra del navegador.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Radar Meteorológico en Directo",
    short_name: "Radar Lluvia",
    description:
      "Mapa en directo con radar de precipitación, geolocalización y avisos de lluvia acercándose.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#12579f",
    theme_color: "#12579f",
    lang: "es",
    categories: ["weather", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
