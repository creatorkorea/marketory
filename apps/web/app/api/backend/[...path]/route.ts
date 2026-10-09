import { relay } from "@/lib/api/relay";

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  const { path } = await context.params;
  return relay(request, path, process.env.API_BASE_URL);
}
export const GET = handle;
export const POST = handle;
