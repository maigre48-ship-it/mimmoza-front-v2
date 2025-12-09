// ------------------------------------------------------------
// cadastre-geojson-proxy
// Proxy pour contourner CORS et servir les GeoJSON Cadastre
// ------------------------------------------------------------
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// CORS local
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

// Base Etalab (latest, GeoJSON, communes)
const CADASTRE_BASE =
  "https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes";

serve(async (req) => {
  // Préflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const insee = url.searchParams.get("insee");
    const type = url.searchParams.get("type"); // "parcelles", "batiments", "sections"

    if (!insee || !type) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Missing parameters: ?insee=XXXXXX&type=parcelles|batiments|sections",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Département = 2 premiers caractères du code INSEE
    const dep = insee.slice(0, 2);

    // Exemple :
    // .../communes/64/64065/cadastre-64065-parcelles.json.gz
    const cadastreUrl = `${CADASTRE_BASE}/${dep}/${insee}/cadastre-${insee}-${type}.json.gz`;

    console.log("Proxy →", cadastreUrl);

    const response = await fetch(cadastreUrl);

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Cadastre returned ${response.status}`,
          url: cadastreUrl,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // --------- 🔽 NOUVEAU : décompression gzip + parse JSON ---------
    const compressedBuffer = await response.arrayBuffer();

    // On convertit l'ArrayBuffer en Stream lisible
    const compressedStream = new Response(
      new Blob([compressedBuffer]),
    ).body;

    if (!compressedStream) {
      throw new Error("No body stream from cadastre response");
    }

    // Décompression gzip via DecompressionStream
    const decompressedStream = compressedStream.pipeThrough(
      new DecompressionStream("gzip"),
    );

    const decompressedResponse = new Response(decompressedStream);
    const text = await decompressedResponse.text();

    let geojson: unknown;
    try {
      geojson = JSON.parse(text);
    } catch (err) {
      console.error("JSON parse error:", err);
      throw new Error(
        "Failed to parse GeoJSON after gzip decompression (invalid JSON)",
      );
    }
    // --------- 🔼 FIN décompression + parse ---------

    return new Response(JSON.stringify(geojson), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    console.error("Proxy error", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message ?? "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
