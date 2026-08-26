"use client";

/* CSS to merge into globals.css: none — this module is a hook, it renders no UI. */

import { useCallback, useEffect, useRef, useState } from "react";

/* Web Speech API is prefixed in Chrome/Edge/Safari; absent in Firefox.
 * Resolved inside a function so importing this module never touches window
 * during SSR. */
function getRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechSupported() {
  return !!getRecognition();
}

/**
 * One-shot voice dictation. start() listens for a single utterance, streams
 * the interim transcript, calls onText(finalTranscript) exactly once when the
 * recognizer settles, then stops itself.
 *
 * @param {{ onText?: (text: string) => void, lang?: string }} opts
 * @returns {{ supported: boolean, listening: boolean, interim: string,
 *             start: () => void, stop: () => void, error: string|null }}
 */
export function useSpeechInput({ onText, lang = "en-US" } = {}) {
  /* supported starts false so SSR HTML and the first client paint agree;
   * the real check runs after mount (same hydration pattern as useStore). */
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => { setSupported(speechSupported()); }, []);
  /* abort (not stop) on unmount so no late onresult fires into dead state */
  useEffect(() => () => { recRef.current?.abort?.(); recRef.current = null; }, []);

  const start = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor || recRef.current) return; // unsupported, or already listening
    setError(null);
    setInterim("");
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let final = "", partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else partial += t;
      }
      if (partial) setInterim(partial);
      if (final.trim()) { setInterim(""); onTextRef.current?.(final.trim()); }
    };
    rec.onerror = (e) => {
      /* silence and our own abort are normal endings, not errors */
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Microphone is blocked — allow mic access for this site in your browser, then try again."
        : e.error === "network"
          ? "Speech service unreachable — check your connection and try again."
          : "Voice input failed — try again.");
    };
    rec.onend = () => { recRef.current = null; setListening(false); setInterim(""); };
    recRef.current = rec;
    try { rec.start(); setListening(true); }
    catch { recRef.current = null; } // double-start race inside the engine
  }, [lang]);

  const stop = useCallback(() => { recRef.current?.stop(); }, []);

  return { supported, listening, interim, start, stop, error };
}
