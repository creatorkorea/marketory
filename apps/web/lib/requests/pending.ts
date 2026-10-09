export const pendingStorageName = (actor: string) => `marketory:auth.bootstrap:${actor}`;
export function pendingKey(storage: Pick<Storage, "getItem" | "setItem">, actor: string): string {
  const name = pendingStorageName(actor);
  const existing = storage.getItem(name);
  if (existing) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) throw new Error("Invalid recovery record");
    return existing;
  }
  const key = crypto.randomUUID();
  storage.setItem(name, key);
  return key;
}
