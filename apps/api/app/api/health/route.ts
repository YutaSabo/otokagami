export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    service: "api",
    status: "ok"
  });
}
