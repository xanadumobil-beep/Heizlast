// Dauerhafter Speicher: bittet den Browser, die Daten nicht automatisch zu löschen.
// Safari gewährt das nicht immer. Deshalb zeigt die App den echten Status an
// und erinnert an die Sicherungsdatei.

export async function fordereDauerhaftenSpeicherAn() {
  if (!navigator.storage?.persist) return { unterstuetzt: false, gewaehrt: false };
  try {
    let gewaehrt = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (!gewaehrt) gewaehrt = await navigator.storage.persist();
    return { unterstuetzt: true, gewaehrt };
  } catch {
    return { unterstuetzt: true, gewaehrt: false };
  }
}

// Aktueller Status samt Speicherbelegung, falls der Browser sie meldet.
export async function speicherStatus() {
  const status = { unterstuetzt: Boolean(navigator.storage?.persisted), gewaehrt: false, belegt: null, kontingent: null };
  try {
    if (navigator.storage?.persisted) status.gewaehrt = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const schaetzung = await navigator.storage.estimate();
      status.belegt = schaetzung.usage ?? null;
      status.kontingent = schaetzung.quota ?? null;
    }
  } catch {
    // Status bleibt auf den Vorgabewerten.
  }
  return status;
}
