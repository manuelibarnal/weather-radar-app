// Prueba local del comprobador SIN enviar nada: descarga los datos de radar y
// corre la detección para una ubicación, imprimiendo el veredicto. Sirve para
// comprobar que la misma lógica de la app funciona en Node.
//
// Uso:  npx tsx checker/dryrun.ts [lat] [lon]
//   (por defecto Madrid: 40.4168 -3.7038)
import { fetchRainviewerData } from "../lib/rainviewer";
import { buildAlertBody, buildAlertTitle } from "../lib/alertMessage";
import { detectRainApproachNode } from "./detect";

async function main() {
  const lat = process.argv[2] ? Number(process.argv[2]) : 40.4168;
  const lon = process.argv[3] ? Number(process.argv[3]) : -3.7038;
  console.log(`Ubicación: ${lat}, ${lon}`);

  const t0 = Date.now();
  const data = await fetchRainviewerData();
  console.log(`Radar: pasado=${data.past.length} frames, nowcast=${data.nowcast.length} frames`);

  const result = await detectRainApproachNode(data.host, data.past, data.nowcast, { lat, lon });
  console.log(`Tiempo: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log("Veredicto:", JSON.stringify(result, null, 2));

  const body = buildAlertBody(result);
  if (body) {
    console.log(`\nPush que se enviaría:\n  Título: ${buildAlertTitle(result)}\n  Texto:  ${body}`);
  } else {
    console.log("\n(No genera aviso: no se enviaría push.)");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
