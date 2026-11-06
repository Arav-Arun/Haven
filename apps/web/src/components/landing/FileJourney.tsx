"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, KeyRound, LockKeyhole, Pause, Play, UserRound } from "lucide-react";
import Image from "next/image";

const STAGES = [
  { label: "Your identity", title: "Your name. Your keys.", text: "A wallet signature creates your keys on your device. Your ENS name points to your public key, so people can share with you.", node: 0 },
  { label: "Encrypt", title: "Lock the file before it leaves.", text: "Your device encrypts each file with its own AES-256 key and pads it to a size bucket. Only encrypted bytes leave your device.", node: 1 },
  { label: "Store", title: "The bytes and the index live separately.", text: "Swarm stores the encrypted file. Arkiv stores a sealed record with its reference, name, and key. The app checks each writer against onchain access history.", node: 2 },
  { label: "Share", title: "An ENS name in. A private invitation out.", text: "The recipient gets a fresh random address and a sealed invitation. Their device recovers the key and opens the file while their access permits it.", node: 3 },
  { label: "Access ends", title: "After the deadline, new files lock.", text: "The recipient’s keys stop at the access deadline. They cannot open files added after that. Files they already opened can still be kept.", node: 3 },
] as const;

/** An illustrative explanation of the protocol, never a simulated live upload. */
export function FileJourney() {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!reduced.matches);
    const onChange = () => setPlaying(!reduced.matches);
    reduced.addEventListener("change", onChange);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.25 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); reduced.removeEventListener("change", onChange); };
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setStage((current) => (current + 1) % STAGES.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [playing, visible]);

  const current = STAGES[stage] ?? STAGES[0];
  const choose = (index: number) => { setStage(index); setPlaying(false); };

  return (
    <div ref={root} className="file-journey overflow-hidden rounded-[24px] border border-[#cbd9ec] bg-white">
      <div className="flex items-center justify-end gap-4 border-b border-[#e3eaf4] px-5 py-3 sm:px-7">
        <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause file journey" : "Play file journey"} className="flex size-8 items-center justify-center rounded-full border border-[#d4dfed] text-[#2563eb] hover:bg-[#edf4fd]">
          {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
        </button>
      </div>

      <div className="journey-map px-5 py-10 sm:px-8 sm:py-14" data-stage={stage} data-playing={playing && visible}>
        <div className="journey-route" aria-hidden><span className="journey-packet"><FileText size={15} /></span></div>
        <div className="journey-nodes">
          <button type="button" onClick={() => choose(0)} aria-label="Explain your identity" className="journey-node" data-active={current.node === 0}>
            <div className="journey-symbol"><UserRound size={29} strokeWidth={1.5} /></div>
            <span className="journey-node-title">Your device</span>
            <span className="journey-node-detail inline-flex items-center gap-1.5"><KeyRound size={12} aria-hidden /> Keys stay here</span>
          </button>
          <button type="button" onClick={() => choose(1)} aria-label="Explain file encryption" className="journey-node" data-active={current.node === 1}>
            <div className="journey-symbol"><LockKeyhole size={29} strokeWidth={1.5} /></div>
            <span className="journey-node-title">Encrypted file</span>
            <span className="journey-node-detail">AES-256 · padded</span>
          </button>
          <button type="button" onClick={() => choose(2)} aria-label="Explain Swarm and Arkiv storage" className="journey-node" data-active={current.node === 2}>
            <div className="journey-symbol journey-storage"><Image src="/swarm.png" width={29} height={29} alt="Swarm" /><span>+</span><Image src="/arkive.png" width={29} height={29} alt="Arkiv" /></div>
            <span className="journey-node-title">Open networks</span>
            <span className="journey-node-detail">Swarm file · Arkiv record</span>
          </button>
          <button type="button" onClick={() => choose(stage === 4 ? 4 : 3)} aria-label="Explain recipient access" className="journey-node" data-active={current.node === 3}>
            <div className={`journey-symbol${stage === 4 ? " journey-ended" : ""}`}>{stage === 4 ? <LockKeyhole size={29} strokeWidth={1.5} /> : <FileText size={29} strokeWidth={1.5} />}</div>
            <span className="journey-node-title">Their device</span>
            <span className="journey-node-detail">{stage === 4 ? "New files are locked" : "Opens with their key"}</span>
          </button>
        </div>
      </div>

      <div className="border-t border-[#e3eaf4] bg-[#f8fafd] px-5 py-6 sm:px-8 sm:py-7">
        <div className="mb-6 flex gap-1.5" aria-label="File journey stages">
          {STAGES.map(({ label }, index) => <button key={label} type="button" onClick={() => choose(index)} aria-current={stage === index ? "step" : undefined} aria-label={`Step ${index + 1}: ${label}`} className={`journey-stage flex-1 rounded-md border px-2 py-2 text-xs font-medium ${stage === index ? "border-[#2563eb] bg-[#2563eb] text-white" : "border-transparent text-[#60718d] hover:border-[#cbd9ec]"}`}><span className="sm:hidden">0{index + 1}</span><span className="hidden sm:inline">{label}</span></button>)}
        </div>
        <div className="flex items-start gap-4 sm:gap-6">
          <div className="min-h-[130px] flex-1 sm:min-h-[100px]">
            <h3 className="text-xl font-semibold tracking-tight text-[#0d1b33] sm:text-2xl">{current.title}</h3>
            <p className="mt-2 max-w-3xl text-base leading-relaxed text-[#4c5d78]">{current.text}</p>
          </div>
          <button type="button" aria-label="Next stage" onClick={() => choose((stage + 1) % STAGES.length)} className="mt-0.5 rounded-full border border-[#cbd9ec] bg-white p-2 text-[#2563eb] hover:bg-[#edf4fd]"><ArrowRight size={16} aria-hidden /></button>
        </div>
      </div>
    </div>
  );
}
