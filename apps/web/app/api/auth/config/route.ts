export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const valid = url?.startsWith("https://") && key?.startsWith("sb_publishable_");
  return Response.json(valid ? { url, key } : { configured: false }, {
    headers: { "Cache-Control": "no-store" },
  });
}
