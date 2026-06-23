// middleware.ts (racine du repo, a cote de package.json)
export const config = { matcher: "/:path*" };

export default function middleware(req: Request) {
  const BASIC_USER = process.env.PREVIEW_USER ?? "mimmoza";
  const BASIC_PASS = process.env.PREVIEW_PASS ?? "";

  const auth = req.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const idx = decoded.indexOf(":");
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (user === BASIC_USER && pass === BASIC_PASS) {
        return; // acces autorise
      }
    }
  }
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Mimmoza Preview"' },
  });
}