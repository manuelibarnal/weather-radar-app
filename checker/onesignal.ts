// Cliente mínimo de la API REST de OneSignal para el comprobador de la nube.
// La REST API Key es SECRETA: llega por variable de entorno (secret de GitHub),
// nunca escrita en el código.
const API_BASE = "https://api.onesignal.com";
// El listado de dispositivos sigue en el host clásico (v1). Si OneSignal lo
// tiene desactivado para tu app, habría que pasar a la exportación CSV de
// usuarios; para pocos suscriptores esto basta.
const LEGACY_BASE = "https://onesignal.com/api/v1";

export type Subscriber = { id: string; lat: number; lon: number };

// Lista los suscriptores con su ubicación (tags lat/lon que guarda la app).
export async function listSubscribers(
  appId: string,
  apiKey: string,
  maxSubs = 5000
): Promise<Subscriber[]> {
  const subs: Subscriber[] = [];
  const limit = 300;

  for (let offset = 0; offset < maxSubs; offset += limit) {
    const url = `${LEGACY_BASE}/players?app_id=${encodeURIComponent(appId)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Key ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`OneSignal (listar suscriptores) ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      players?: Array<{ id: string; invalid_identifier?: boolean; tags?: Record<string, string> }>;
    };
    const players = data.players ?? [];
    for (const p of players) {
      if (p.invalid_identifier) continue;
      const lat = Number(p.tags?.lat);
      const lon = Number(p.tags?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) subs.push({ id: p.id, lat, lon });
    }
    if (players.length < limit) break; // última página
  }
  return subs;
}

// Envía una notificación push a una lista concreta de dispositivos.
export async function sendToPlayers(
  appId: string,
  apiKey: string,
  playerIds: string[],
  title: string,
  body: string,
  // URL que abre la app al tocar la notificación. Lleva ?lat=&lon= de la zona
  // del aviso, para que la app abra centrada y analizando esa ubicación.
  url?: string
): Promise<void> {
  if (playerIds.length === 0) return;
  const res = await fetch(`${API_BASE}/notifications`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      target_channel: "push",
      // Si OneSignal rechazara este campo, la alternativa moderna es
      // "include_subscription_ids" con los mismos ids.
      include_player_ids: playerIds,
      headings: { en: title, es: title },
      contents: { en: body, es: body },
      ...(url ? { url } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`OneSignal (enviar) ${res.status}: ${await res.text()}`);
  }
}
