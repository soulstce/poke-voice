"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

type ChatMessage = {
  role: Role;
  text: string;
  time: string;
  source?: string;
};

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    SpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function VoicePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Tap to talk. Poke Voice will listen, send your request to the orchestrator, and read the reply back aloud.",
      time: nowLabel(),
      source: "system"
    }
  ]);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [supportsRecognition, setSupportsRecognition] = useState(true);
  const [supportsSpeech, setSupportsSpeech] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const [sessionId] = useState(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return "session-" + Date.now().toString(36);
  });

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupportsSpeech(Boolean(window.speechSynthesis));
    const SpeechCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechCtor) {
      setSupportsRecognition(false);
      setStatus("Speech recognition is not available in this browser.");
      return;
    }

    const recognition = new SpeechCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const value = result[0]?.transcript ?? "";
        interim += value;
        if (result.isFinal) {
          finalText += value;
        }
      }

      const trimmed = interim.trim();
      setTranscript(trimmed);

      const finalTrimmed = finalText.trim();
      if (finalTrimmed.length > 0) {
        recognition.stop();
        void submitTranscript(finalTrimmed);
      }
    };

    recognition.onend = () => {
      setListening(false);
      if (!busyRef.current && !speakingRef.current) {
        setStatus("Ready.");
      }
    };

    recognition.onerror = (event: any) => {
      setListening(false);
      setStatus("Speech error: " + event.error);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function speakReply(text: string, payload: any) {
    return new Promise<void>((resolve) => {
      const finish = () => {
        speakingRef.current = false;
        setSpeaking(false);
        if (!busyRef.current) {
          setStatus("Ready.");
        }
        resolve();
      };

      const audioUrl = typeof payload?.audioUrl === "string" ? payload.audioUrl : "";
      const audioBase64 = typeof payload?.audioBase64 === "string" ? payload.audioBase64 : "";
      const audioMimeType = typeof payload?.audioMimeType === "string" ? payload.audioMimeType : "audio/mpeg";
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

      if (audioUrl || audioBase64) {
        const source = audioUrl.length > 0 ? audioUrl : "data:" + audioMimeType + ";base64," + audioBase64;
        const audio = new Audio(source);
        speakingRef.current = true;
        setSpeaking(true);
        audio.onended = finish;
        audio.onerror = () => {
          if (!synth) {
            finish();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1;
          utterance.pitch = 1.08;
          utterance.onend = finish;
          utterance.onerror = finish;
          speakingRef.current = true;
          setSpeaking(true);
          synth.cancel();
          synth.speak(utterance);
        };
        void audio.play().catch(() => {
          if (!synth) {
            finish();
            return;
          }
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1;
          utterance.pitch = 1.08;
          utterance.onend = finish;
          utterance.onerror = finish;
          speakingRef.current = true;
          setSpeaking(true);
          synth.cancel();
          synth.speak(utterance);
        });
        return;
      }

      if (!synth) {
        finish();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1.08;
      utterance.onend = finish;
      utterance.onerror = finish;
      speakingRef.current = true;
      setSpeaking(true);
      synth.cancel();
      synth.speak(utterance);
    });
  }

  async function submitTranscript(spokenText: string) {
    const trimmed = spokenText.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      role: "user",
      text: trimmed,
      time: nowLabel()
    };

    setBusy(true);
    setStatus("Sending to Poke orchestrator...");
    setMessages((current) => [...current, userMessage]);

    try {
      const history = [...messages, userMessage];
      const response = await fetch("/api/poke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          transcript: trimmed,
          history,
          sessionId
        })
      });

      const payload = await response.json().catch(() => ({}));
      const reply =
        typeof payload.reply === "string"
          ? payload.reply
          : typeof payload.text === "string"
            ? payload.text
            : typeof payload.message === "string"
              ? payload.message
              : "Poke did not return a text reply.";

      const assistantMessage: ChatMessage = {
        role: "assistant",
        text: reply,
        time: nowLabel(),
        source: typeof payload.source === "string" ? payload.source : undefined
      };

      setMessages((current) => [...current, assistantMessage]);
      setStatus("Speaking response...");
      await speakReply(reply, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "Voice bridge error: " + message,
          time: nowLabel(),
          source: "client"
        }
      ]);
      setStatus("Voice bridge error.");
    } finally {
      setBusy(false);
      if (!speakingRef.current) {
        setStatus("Ready.");
      }
    }
  }

  function startListening() {
    const recognition = recognitionRef.current;
    if (!recognition || listening || busy) return;
    if (speaking && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      speakingRef.current = false;
      setSpeaking(false);
    }
    setTranscript("");
    setListening(true);
    setStatus("Listening...");
    try {
      recognition.start();
    } catch {
      recognition.abort();
      recognition.start();
    }
  }

  function stopListening() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.stop();
  }

  function toggleTalk() {
    if (listening) {
      stopListening();
      return;
    }
    startListening();
  }

  const latestMessages = messages.slice(-4);
  const readyLabel = supportsRecognition ? "Speech ready" : "Speech unavailable";

  return (
    <main className="voice-app">
      <section className="voice-panel">
        <header className="topline">
          <div className="brand">
            <div className="badge">PV</div>
            <div>
              <div className="kicker">Poke Voice</div>
              <h1>Real-time voice interface for Poke</h1>
              <p className="lead">
                Tap to talk, get a spoken reply, and keep the conversation moving without touching the keyboard.
              </p>
            </div>
          </div>
          <div className="status-pill">{status}</div>
        </header>

        <div className="hero-grid">
          <div className="mic-stage">
            <div className={listening || speaking ? "voice-orb active" : "voice-orb"}>
              <div className="orb-ring one" />
              <div className="orb-ring two" />
              <div className="orb-ring three" />
              <div className="voice-wave" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, index) => (
                  <span
                    key={index}
                    className={listening || speaking ? "wave-bar live" : "wave-bar"}
                    style={{ left: 16 + index * 12 + "%", animationDelay: index * 0.12 + "s" }}
                  />
                ))}
              </div>
              <button
                type="button"
                className={
                  listening
                    ? "talk-button listening"
                    : speaking
                      ? "talk-button speaking"
                      : "talk-button"
                }
                onClick={toggleTalk}
                aria-label="Tap to talk"
              >
                <div>
                  <strong>{listening ? "Listening" : speaking ? "Speaking" : "Tap to talk"}</strong>
                  <span>{listening ? "Release when you are done" : supportsRecognition ? "Voice first, hands free" : readyLabel}</span>
                </div>
              </button>
            </div>
          </div>

          <aside className="side-card">
            <div className="mini-stat">
              <label>Current transcript</label>
              <strong>{transcript.length > 0 ? transcript : "Waiting for speech input"}</strong>
              <p>Live transcription uses the browser Web Speech API before sending text to the orchestrator.</p>
            </div>
            <div className="chat-list" aria-live="polite">
              {latestMessages.map((message, index) => (
                <article key={index} className={message.role === "user" ? "message user" : "message assistant"}>
                  <div className="meta-row">
                    <span>{message.role === "user" ? "You" : "Poke"}</span>
                    <span>{message.time}</span>
                  </div>
                  <p>{message.text}</p>
                  {message.source ? <p className="source-line">{message.source}</p> : null}
                </article>
              ))}
            </div>
          </aside>
        </div>

        <footer className="footer-grid">
          <div className="mini-stat">
            <label>Speech recognition</label>
            <strong>{supportsRecognition ? "Enabled" : "Unavailable"}</strong>
            <p>The app listens with the browser SpeechRecognition API when the browser supports it.</p>
          </div>
          <div className="mini-stat">
            <label>Speech synthesis</label>
            <strong>{supportsSpeech ? "Enabled" : "Unavailable"}</strong>
            <p>Replies are played back with SpeechSynthesis, or via audio if the orchestrator sends a clip.</p>
          </div>
          <div className="mini-stat">
            <label>Session</label>
            <strong>{sessionId.slice(0, 8)}</strong>
            <p>Each tab gets a lightweight voice session to keep command history coherent.</p>
          </div>
        </footer>
      </section>
    </main>
  );
}
