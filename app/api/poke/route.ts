import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  input?: string;
  transcript?: string;
  history?: unknown[];
  sessionId?: string;
};

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/poke", method: "GET" });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const input = String(body.input ?? body.transcript ?? "").trim();

  if (!input) {
    return NextResponse.json({ error: "Missing input." }, { status: 400 });
  }

  const endpoint = process.env.POKE_ORCHESTRATOR_URL?.trim();
  const token = process.env.POKE_ORCHESTRATOR_TOKEN?.trim();

  if (!endpoint) {
    return NextResponse.json({
      reply: "I heard: " + input + ". Set POKE_ORCHESTRATOR_URL to connect this app to the live Poke orchestrator.",
      source: "fallback"
    });
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
      })
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
