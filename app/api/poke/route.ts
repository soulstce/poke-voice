import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  input?: string;
  transcript?: string;
  history?: unknown[];
  sessionId?: string;
};

function pickEndpoint() {
  return (
    process.env.POKE_ORCHESTRATOR_URL?.trim() ||
    process.env.POKE_BACKEND_URL?.trim() ||
    process.env.POKE_API_URL?.trim() ||
    ""
  );
}

function pickToken() {
  return (
    process.env.POKE_ORCHESTRATOR_TOKEN?.trim() ||
    process.env.POKE_BACKEND_TOKEN?.trim() ||
    process.env.POKE_API_TOKEN?.trim() ||
    ""
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const input = String(body.input ?? body.transcript ?? "").trim();

  if (!input) {
    return NextResponse.json({ error: "Missing input." }, { status: 400 });
  }

  const endpoint = pickEndpoint();
  const token = pickToken();

  if (!endpoint) {
    return NextResponse.json(
      {
        reply:
          "I heard: " +
          input +
          ". Set POKE_ORCHESTRATOR_URL (or POKE_BACKEND_URL) to connect this app to Poke's backend.",
        source: "fallback"
      },
      { status: 200 }
    );
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {})
      },
      body: JSON.stringify({
        input,
        transcript: input,
        history: body.history ?? [],
        sessionId: body.sessionId ?? null
      }),
      cache: "no-store"
    });

    const contentType = upstream.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await upstream.json();
      return NextResponse.json(payload, { status: upstream.status });
    }

    if (contentType.startsWith("audio/")) {
      const audio = await upstream.arrayBuffer();
      return new NextResponse(audio, {
        status: upstream.status,
        headers: {
          "content-type": contentType
        }
      });
    }

    const text = await upstream.text();
    return NextResponse.json(
      {
        reply: text,
        source: "upstream-text"
      },
      { status: upstream.status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream error.";
    return NextResponse.json(
      {
        reply: "Poke bridge error: " + message,
        source: "proxy-error"
      },
      { status: 502 }
    );
  }
}
