import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El indicador de modo desarrollo de Next.js se solapaba con el panel de
  // controles del mapa en pantallas estrechas; se mueve a la esquina libre.
  devIndicators: {
    position: "top-right",
  },
  // Toda la app funciona en el cliente (sin rutas API ni server actions), así
  // que se puede exportar como HTML/CSS/JS estático y subir por FTP a
  // cualquier hosting, sin necesitar un servidor Node.js.
  output: "export",
};

export default nextConfig;
