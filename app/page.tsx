"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

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

function getRecognitionHelp(errorCode: string) {
  switch (errorCode) {
    case "service-not-allowed":
      return "Voice recognition is blocked on this device or browser. Use typing below, or try Chrome on a supported desktop browser.";
    case "not-allowed":
      return "Microphone or speech permission was denied. Enable access and try again.";
    case "audio-capture":
      return "No microphone input was detected. Check your microphone and try again.";
    case "network":
      return "Speech recognition could not reach its service. You can still type a request below.";
    case "no-speech":
      return "No speech was detected. Try again and speak a little closer to the microphone.";
    default:
      return "Speech recognition paused. You can use the text composer below instead.";
  }
}

export default function VoicePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Tap to talk. Poke Voice listens, routes your request, and reads the reply back aloud.",
      time: nowLabel(),
      source: "system"
    }
  ]);
  const [transcript, setTranscript] = useState("");
  const [composer, setComposer] = useState("");
  const [status, setStatus] = useState("Ready.");
  const [recognitionHelp, setRecognitionHelp] = useState<string | null>(null);
  const [supportsRecognition, setSupportsRecognition] = useState(true);
  const [supportsSpeech, setSupportsSpeech] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState("session-pending");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "session-" + Math.random().toString(36).slice(2, 10);
    setSessionId(id);
  }, []);

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
      setRecognitionHelp("Speech recognition is not available in this browser. Use the composer below or switch browsers.");
      setStatus("Voice input unavailable.");
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

      setTranscript(interim.trim());

      const completed = finalText.trim();
      if (completed.length > 0) {
        recognition.stop();
        void submitMessage(completed);
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
      const message = getRecognitionHelp(event.error);
      setRecognitionHelp(message);
      if (event.error === "service-not-allowed" || event.error === "not-allowed") {
        setSupportsRecognition(false);
      }
      setStatus("Speech input paused.");
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  async function speakReply(text: string, payload: any) {
    return new Promise<void>((resolve) => {
      const finish = () => {
        speakingRef.current = false;
        setSpeaking(false);
        if (!busyRef.current) setStatus("Ready.");
        resolve();
      };

      const audioUrl = typeof payload?.audioUrl === "string" ? payload.audioUrl : "";
      const audioBase64 = typeof payload?.audioBase64 === "string" ? payload.audioBase64 : "";
      const audioMimeType = typeof payload?.audioMimeType === "string" ? payload.audioMimeType : "audio/mpeg";
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

      if (audioUrl || audioBase64) {
        const source = audioUrl.length > 0 ? audioUrl : `data:${audioMimeType};base64,${audioBase64}`;
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
          utterance.pitch = 1.05;
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
          utterance.pitch = 1.05;
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
      utterance.pitch = 1.05;
      utterance.onend = finish;
      utterance.onerror = finish;
      speakingRef.current = true;
      setSpeaking(true);
      synth.cancel();
      synth.speak(utterance);
    });
  }

  async function submitMessage(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      role: "user",
      text: trimmed,
      time: nowLabel()
    };

    setBusy(true);
    setStatus("Sending to Poke...");
    setMessages((current) => [...current, userMessage]);

    try {
      const response = await fetch("/api/poke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          transcript: trimmed,
          history: [...messagesRef.current, userMessage],
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
          text: `Voice bridge error: ${message}`,
          time: nowLabel(),
          source: "client"
        }
      ]);
      setStatus("Voice bridge error.");
    } finally {
      setBusy(false);
      if (!speakingRef.current) setStatus("Ready.");
    }
  }

  function startListening() {
    const recognition = recognitionRef.current;
    if (!recognition || listening || busy || !supportsRecognition) {
      if (!supportsRecognition && !recognitionHelp) {
        setRecognitionHelp("Speech recognition is not available in this browser. Use the composer below or switch browsers.");
      }
      return;
    }

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
    recognitionRef.current?.stop();
  }

  function toggleTalk() {
    if (listening) {
      stopListening();
      return;
    }
    startListening();
  }

  function onComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(composer);
    setComposer("");
  }

  const latestMessages = messages.slice(-5);
  const recognitionStatus = supportsRecognition ? (listening ? "Listening" : "Available") : "Unavailable";
  const speechStatus = supportsSpeech ? (speaking ? "Speaking" : "Enabled") : "Unavailable";

  return (
    <main className="voice-shell">
      <section className="voice-frame glass-panel">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">PV</div>
            <div>
              <div className="eyebrow">Poke Voice</div>
              <h1>Professional voice control for Poke</h1>
              <p className="lede">
                A dark, glassy tap-to-talk workspace with resilient speech fallbacks for iOS and browsers that block the Web Speech API.
              </p>
            </div>
          </div>
          <div className="status-chip">{status}</div>
        </header>

        <div className="workspace-grid">
          <section className="hero-stage glass-card">
            <div className={listening || speaking ? "voice-orb active" : "voice-orb"}>
              <span className="orb-ring ring-a" />
              <span className="orb-ring ring-b" />
              <span className="orb-ring ring-c" />
              <span className="orb-glow" />
              <button
                type="button"
                className={listening ? "talk-button listening" : speaking ? "talk-button speaking" : "talk-button"}
                onClick={toggleTalk}
                aria-label="Tap to talk"
              >
                <span className="talk-label">TAP TO TALK</span>
                <span className="talk-subtitle">Voice first, keyboard ready when needed</span>
              </button>
            </div>

            <div className="stage-note-row">
              <span className="stage-note">Session {sessionId.slice(0, 8)}</span>
              <span className="stage-note">{recognitionStatus}</span>
              <span className="stage-note">{speechStatus}</span>
            </div>

            {recognitionHelp ? <div className="notice">{recognitionHelp}</div> : null}
          </section>

          <aside className="sidebar stack-lg">
            <section className="glass-card stack-md">
              <div className="card-head">
                <div>
                  <div className="section-label">Transcript</div>
                  <h2>Live speech capture</h2>
                </div>
                <div className={transcript ? "mini-pill live" : "mini-pill"}>{transcript ? "Live" : "Idle"}</div>
              </div>
              <p className="transcript-text">{transcript.length > 0 ? transcript : "Waiting for speech input."}</p>
            </section>

            <section className="glass-card stack-md">
              <div className="card-head">
                <div>
                  <div className="section-label">Text fallback</div>
                  <h2>Type if speech is blocked</h2>
                </div>
              </div>
              <form className="composer" onSubmit={onComposerSubmit}>
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder="Type a message to Poke"
                  rows={4}
                />
                <button className="send-button" type="submit" disabled={busy || composer.trim().length === 0}>
                  Send
                </button>
              </form>
            </section>

            <section className="glass-card stack-md">
              <div className="card-head">
                <div>
                  <div className="section-label">Conversation</div>
                  <h2>Recent messages</h2>
                </div>
              </div>
              <div className="message-list" aria-live="polite">
                {latestMessages.map((message, index) => (
                  <article key={index} className={message.role === "user" ? "message user" : "message assistant"}>
                    <div className="message-meta">
                      <span>{message.role === "user" ? "You" : "Poke"}</span>
                      <span>{message.time}</span>
                    </div>
                    <p>{message.text}</p>
                    {message.source ? <div className="message-source">{message.source}</div> : null}
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <footer className="footer-grid">
          <div className="glass-card stat-card">
            <span className="section-label">Recognition</span>
            <strong>{recognitionStatus}</strong>
            <p>Uses SpeechRecognition when the browser allows it, and cleanly falls back when it does not.</p>
          </div>
          <div className="glass-card stat-card">
            <span className="section-label">Playback</span>
            <strong>{speechStatus}</strong>
            <p>Replies are spoken with SpeechSynthesis when available, with audio URL/base64 fallback support.</p>
          </div>
          <div className="glass-card stat-card">
            <span className="section-label">Route</span>
            <strong>/api/poke</strong>
            <p>Messages are sent to the Poke orchestrator through the server bridge for a live response.</p>
          </div>
        </footer>
      </section>
    </main>
  );
}
