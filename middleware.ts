// middleware.ts (racine du repo, a cote de package.json)
export const config = { matcher: "/:path*" };

export default function middleware(req: Request) {
  // Production ouverte a tous les utilisateurs ; seules les previews restent protegees.
  if (process.env.VERCEL_ENV === "production") return;

  const BASIC_USER = process.env.PREVIEW_USER ?? "mimmoza";
  const BASIC_PASS = process.env.PREVIEW_PASS ?? "";

  const auth = req.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      let decoded = "";
      try {
        decoded = atob(encoded);
      } catch {
        decoded = ""; // base64 invalide : refuse sans exception
      }
      const idx = decoded.indexOf(":");
      if (idx >= 0) {
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        if (user === BASIC_USER && pass === BASIC_PASS) {
          return; // acces autorise
        }
      }
    }
  }
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Mimmoza Preview"' },
  });
}
