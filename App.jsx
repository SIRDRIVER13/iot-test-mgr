import { useState, useEffect, useRef, useMemo } from "react";
import {
  Camera, Lock, Radar, Server, Thermometer, Wifi, Gauge, Tv,
  ShieldAlert, ShieldCheck, Zap, Skull, KeyRound, BookOpenCheck,
  ShieldX, ShieldBan, EyeOff, Check, X as XIcon, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  CartesianGrid, BarChart, Bar,
} from "recharts";

const T_MAX = 600;
const POST_SURVEY_URL = "https://form.jotform.com/263021837569059";
const EXPECTED_ALERTS = 6;
const REDIRECT_SECONDS = 15;
const idFromUrl = () => {
  try { return (new URLSearchParams(window.location.search).get("id") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20); } catch (e) { return ""; }
};
const FALSE_POSITIVE = [90, 130];
const DDOS = [150, 220];
const RANSOM_NAS = [300, 340];
const RANSOM_HUB = [320, 370];
const RANSOM_THERMO = [350, 390];
const BRUTE = [450, 480];

const inWin = (t, w) => t >= w[0] && t <= w[1];
const pulse = (t, w) => {
  if (t < w[0] || t > w[1]) return 0;
  const mid = (w[0] + w[1]) / 2, half = (w[1] - w[0]) / 2;
  return 1 - Math.abs(t - mid) / half;
};

const ROOMS = [
  { id: "salon",     label: "Salon",     x: 8,  y: 6,  w: 40, h: 36 },
  { id: "wejscie",   label: "Wejście",   x: 50, y: 6,  w: 20, h: 16 },
  { id: "kuchnia",   label: "Kuchnia",   x: 72, y: 6,  w: 20, h: 16 },
  { id: "gabinet",   label: "Gabinet",   x: 50, y: 24, w: 42, h: 18 },
  { id: "sypialnia", label: "Sypialnia", x: 8,  y: 44, w: 28, h: 34 },
  { id: "lazienka",  label: "Łazienka",  x: 38, y: 44, w: 20, h: 34 },
  { id: "kotlownia", label: "Kotłownia", x: 60, y: 44, w: 32, h: 34 },
];

const ANCHOR_CLASS = { tr: "top-1 right-1", br: "bottom-1 right-1", bl: "bottom-1 left-1", tl: "top-1 left-1" };

const DEVICES = [
  { id: "CAM-01", room: "salon",   icon: Camera,  label: "Kamera — salon",            anchor: "br" },
  { id: "TV-01",  room: "salon",   icon: Tv,      label: "Telewizor smart",           anchor: "tr" },
  { id: "CAM-02", room: "wejscie", icon: Camera,  label: "Kamera — wejście",          anchor: "tr" },
  { id: "LOCK-01", room: "wejscie", icon: Lock,    label: "Zamek — drzwi wejściowe",   anchor: "br" },
  { id: "SENSOR-MOTION-01", room: "kuchnia",   icon: Radar,       label: "Czujnik ruchu",              anchor: "br" },
  { id: "NAS-STORAGE", room: "gabinet",  icon: Server,      label: "Serwer NAS",                 anchor: "br" },
  { id: "SENSOR-TEMP-01", room: "sypialnia", icon: Thermometer, label: "Czujnik temperatury",       anchor: "br" },
  { id: "HUB-GATEWAY", room: "kotlownia", icon: Wifi,        label: "Router / gateway",           anchor: "tr" },
  { id: "THERMO-01", room: "kotlownia", icon: Gauge,       label: "Sterownik pompy ciepła",     anchor: "br" },
];

function statusFor(id, t) {
  if (id === "TV-01") return inWin(t, FALSE_POSITIVE) ? "info" : "green";
  if (id === "CAM-01" || id === "CAM-02") return inWin(t, DDOS) ? "red" : "green";
  if (id === "LOCK-01") return inWin(t, BRUTE) ? "red" : "green";
  if (id === "NAS-STORAGE") return inWin(t, RANSOM_NAS) ? "amber" : "green";
  if (id === "HUB-GATEWAY") return inWin(t, RANSOM_HUB) ? "amber" : "green";
  if (id === "THERMO-01") return inWin(t, RANSOM_THERMO) ? "amber" : "green";
  return "green";
}

function alertsAt(t) {
  const list = [];
  if (inWin(t, FALSE_POSITIVE)) list.push({ key: "tv-update", dev: "TV-01", type: "Możliwy fałszywy alarm", reason: "Duży, ale jednorazowy transfer danych — typowy dla aktualizacji oprogramowania.", sev: "info", confidence: 34, correct: ["ignoruj"] });
  if (inWin(t, DDOS)) list.push({ key: "ddos", dev: "CAM-01 / CAM-02", type: "DDoS", reason: "flood pakietów z kamer IP — ruch 18x powyżej normy", sev: "red", confidence: 99, correct: ["izoluj", "blokuj"] });
  if (inWin(t, RANSOM_NAS)) list.push({ key: "ransom-nas", dev: "NAS-STORAGE", type: "Ransomware", reason: "masowe szyfrowanie plików — transfer danych 20x powyżej normy", sev: "amber", confidence: 82, correct: ["izoluj", "blokuj"] });
  if (inWin(t, RANSOM_HUB)) list.push({ key: "ransom-hub", dev: "HUB-GATEWAY", type: "Ransomware — propagacja", reason: "lateral movement przez gateway, 15 nowych połączeń", sev: "amber", confidence: 78, correct: ["izoluj", "blokuj"] });
  if (inWin(t, RANSOM_THERMO)) list.push({ key: "ransom-thermo", dev: "THERMO-01", type: "Ransomware — dotarcie", reason: "atak dotarł do sterownika pompy ciepła", sev: "amber", confidence: 75, correct: ["izoluj", "blokuj"] });
  if (inWin(t, BRUTE)) list.push({ key: "brute", dev: "LOCK-01", type: "Brute-force", reason: "masa nieudanych prób logowania do zamka", sev: "red", confidence: 91, correct: ["izoluj", "blokuj"] });
  return list;
}

const STATUS_STYLE = {
  green: { ring: "border-emerald-400/40", glow: "", icon: "text-emerald-500", badge: "bg-emerald-400" },
  info:  { ring: "border-sky-400", glow: "shadow-[0_0_16px_rgba(56,189,248,0.5)]", icon: "text-sky-600", badge: "bg-sky-400" },
  amber: { ring: "border-amber-400", glow: "shadow-[0_0_16px_rgba(251,191,36,0.55)]", icon: "text-amber-600", badge: "bg-amber-400 animate-pulse" },
  red:   { ring: "border-red-500", glow: "shadow-[0_0_16px_rgba(239,68,68,0.6)]", icon: "text-red-600", badge: "bg-red-500 animate-pulse" },
};

const ATTACKS = [
  { key: "falsepositive", label: "Fałszywy alarm", icon: Tv, win: [FALSE_POSITIVE[0] - 10, FALSE_POSITIVE[1] + 10], accent: "text-sky-400", btn: "bg-sky-400/15 border-sky-400/40 hover:bg-sky-400/25 text-sky-300",
    desc: "Telewizor smart pobiera dużą aktualizację oprogramowania — chwilowy skok transferu danych, bez sygnałów ataku.",
    defense: ["To NIE jest realny atak", "Zalecana akcja: Ignoruj, zweryfikuj log producenta", "Nie izoluj automatycznie tylko na podstawie wolumenu"] },
  { key: "ddos", label: "DDoS", icon: Zap, win: [DDOS[0] - 15, DDOS[1] + 15], accent: "text-red-400", btn: "bg-red-500/15 border-red-500/40 hover:bg-red-500/25 text-red-300",
    desc: "Zalew pakietów z przejętych kamer IP przeciąża pasmo sieci.",
    defense: ["Rate limiting / QoS na porcie kamer", "Segmentacja VLAN dla IoT", "Wyłączenie UPnP", "Alert przy skoku pakietów/s"] },
  { key: "ransomware", label: "Ransomware", icon: Skull, win: [RANSOM_NAS[0] - 15, RANSOM_THERMO[1] + 15], accent: "text-amber-400", btn: "bg-amber-400/15 border-amber-400/40 hover:bg-amber-400/25 text-amber-300",
    desc: "Ransomware szyfruje dane na NAS i przemieszcza się przez gateway do kolejnych urządzeń.",
    defense: ["Segmentacja sieci — VLAN per typ urządzenia", "Kopie zapasowe offline", "Aktualizacje firmware", "Zero trust", "Wykrywanie lateral movement"] },
  { key: "bruteforce", label: "Brute-force", icon: KeyRound, win: [BRUTE[0] - 15, BRUTE[1] + 15], accent: "text-red-400", btn: "bg-red-500/15 border-red-500/40 hover:bg-red-500/25 text-red-300",
    desc: "Automatyczne próby odgadnięcia kodu do elektronicznego zamka.",
    defense: ["Blokada po N nieudanych próbach", "2FA do aplikacji zamka", "Rotowane kody dostępu", "Powiadomienie push przy próbie"] },
];

const ACTIONS = [
  { key: "izoluj",  label: "Izoluj", icon: ShieldX },
  { key: "blokuj",  label: "Blokuj IP", icon: ShieldBan },
  { key: "ignoruj", label: "Ignoruj", icon: EyeOff },
];

export default function IotAttackFloorplan() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bounds, setBounds] = useState([0, T_MAX]);
  const [completed, setCompleted] = useState(new Set());
  const [resolved, setResolved] = useState({});
  const [page, setPage] = useState(0);
  const intervalRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef({ startX: 0, dragging: false, dx: 0 });
  const alertShownAt = useRef({});

  const [showIntro, setShowIntro] = useState(true);
  const [participantId, setParticipantId] = useState(idFromUrl());
  const [countdown, setCountdown] = useState(null);
  const [sessionLog, setSessionLog] = useState([]);

  // Playback: advances slowly, and AUTO-PAUSES the instant a new alert becomes
  // active, so there is always time to read it and click a response action.
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setT((prev) => {
          if (prev >= bounds[1]) { setPlaying(false); return prev; }
          const prevAlertKeys = new Set(alertsAt(prev).map((a) => a.key));
          const next = Math.min(bounds[1], prev + 1);
          const nextAlerts = alertsAt(next);
          const newlyAppeared = nextAlerts.some((a) => !prevAlertKeys.has(a.key));
          if (newlyAppeared) setPlaying(false); // auto-pause so the user can act
          return next;
        });
      }, 80);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, bounds]);

  useEffect(() => {
    if (trackRef.current) trackRef.current.style.transform = `translateX(-${page * 50}%)`;
  }, [page]);

  const runAttack = (atk) => {
    setBounds(atk ? atk.win : [0, T_MAX]);
    setT(atk ? atk.win[0] : 0);
    setPlaying(true);
    setCompleted((prev) => {
      const next = new Set(prev);
      if (atk) next.add(atk.key); else ATTACKS.forEach((a) => next.add(a.key));
      return next;
    });
  };

  const chartData = useMemo(() => {
    const pts = [];
    for (let tt = 0; tt <= T_MAX; tt += 5) {
      const level = pulse(tt, DDOS) + pulse(tt, RANSOM_NAS) + pulse(tt, RANSOM_HUB) + pulse(tt, RANSOM_THERMO) + pulse(tt, BRUTE) + 0.3 * pulse(tt, FALSE_POSITIVE);
      pts.push({ t: tt, level: Math.round(level * 100) / 100 });
    }
    return pts;
  }, []);

  const barData = [
    { name: "DDoS", val: DDOS[1] - DDOS[0] },
    { name: "Ransom.", val: RANSOM_THERMO[1] - RANSOM_NAS[0] },
    { name: "Brute", val: BRUTE[1] - BRUTE[0] },
    { name: "F.Pos.", val: FALSE_POSITIVE[1] - FALSE_POSITIVE[0] },
  ];

  const alerts = alertsAt(t);
  useEffect(() => {
    alerts.forEach((a) => { if (!alertShownAt.current[a.key]) alertShownAt.current[a.key] = Date.now(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const activeAttackCount = alerts.filter((a) => a.sev !== "info").length;
  const allDone = ATTACKS.every((a) => completed.has(a.key));

  const saveSession = async (log) => {
    try { await window.storage?.set(`session:${participantId}`, JSON.stringify(log), false); } catch (e) {}
  };

  const resolveAlert = (alert, actionKey) => {
    const now = Date.now();
    const shown = alertShownAt.current[alert.key] || now;
    const reactionSec = Math.max(0, (now - shown) / 1000).toFixed(2);
    const isCorrect = alert.correct.includes(actionKey);
    setResolved((prev) => ({ ...prev, [alert.key]: actionKey }));
    const entry = { participant: participantId, device: alert.dev, scenario: alert.type, action: actionKey, correct: isCorrect ? "tak" : "nie", reaction_s: reactionSec, confidence: alert.confidence, timestamp: new Date().toISOString() };
    setSessionLog((prev) => { const next = [...prev, entry]; saveSession(next); return next; });
  };

  const allResolved = Object.keys(resolved).length >= EXPECTED_ALERTS;
  const surveyUrl = () => {
    const ok = sessionLog.filter((e) => e.correct === "tak").length;
    const avg = sessionLog.length ? (sessionLog.reduce((a, e) => a + Number(e.reaction_s), 0) / sessionLog.length).toFixed(2) : "";
    const q = new URLSearchParams({ q3_textbox1: participantId, q4_textbox2: `${ok}/${sessionLog.length}`, q5_textbox3: avg });
    return `${POST_SURVEY_URL}?${q.toString()}`;
  };
  useEffect(() => {
    if (!(allDone && allResolved && !playing)) return;
    setCountdown((c) => (c === null ? REDIRECT_SECONDS : c));
  }, [allDone, allResolved, playing]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { downloadCSV(); setTimeout(() => { window.location.href = surveyUrl(); }, 600); return; }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const downloadCSV = () => {
    const headers = ["participant", "device", "scenario", "action", "correct", "reaction_s", "confidence", "timestamp"];
    const rows = sessionLog.map((e) => headers.map((h) => `"${e[h]}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `sesja_${participantId || "anon"}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  const onPointerDown = (e) => { drag.current = { startX: e.clientX, dragging: true, dx: 0 }; if (trackRef.current) trackRef.current.style.transition = "none"; };
  const onPointerMove = (e) => {
    if (!drag.current.dragging || !trackRef.current) return;
    const dx = e.clientX - drag.current.startX;
    drag.current.dx = dx;
    const pct = (dx / trackRef.current.offsetWidth) * 100;
    trackRef.current.style.transform = `translateX(calc(-${page * 50}% + ${pct}%))`;
  };
  const onPointerUp = () => {
    if (!drag.current.dragging || !trackRef.current) return;
    drag.current.dragging = false;
    trackRef.current.style.transition = "transform 300ms ease";
    const dx = drag.current.dx;
    let newPage = page;
    if (dx < -60 && page < 1) newPage = page + 1;
    else if (dx > 60 && page > 0) newPage = page - 1;
    setPage(newPage);
    trackRef.current.style.transform = `translateX(-${newPage * 50}%)`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <div ref={trackRef} className="flex" style={{ width: "200%", transform: "translateX(0%)" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>

        {/* PAGE 1 */}
        <div style={{ width: "50%", flexShrink: 0 }} className="p-6 md:p-10 select-none">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-slate-500 text-sm tracking-wide">Cyfrowy Bliźniak — symulacja</p>
                <h1 className="text-3xl font-semibold text-white mt-1">Dom pod atakiem: sieć IoT</h1>
              </div>
              <div className={`flex items-center gap-2 rounded-full px-4 py-2 border ${activeAttackCount ? "bg-red-500/10 border-red-500/40 text-red-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"}`}>
                {activeAttackCount ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                <span className="text-sm font-medium">{activeAttackCount ? `${activeAttackCount} aktywnych alertów` : "Sieć bezpieczna"}</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4 mb-6">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Wybierz scenariusz do symulacji</p>
              <div className="flex flex-wrap gap-2">
                {ATTACKS.map((a) => {
                  const Icon = a.icon; const done = completed.has(a.key);
                  return (
                    <button key={a.key} onClick={() => runAttack(a)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${a.btn}`}>
                      <Icon size={15} />{a.label}{done && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
                    </button>
                  );
                })}
                <button onClick={() => runAttack(null)} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm font-medium text-slate-300">Wszystkie</button>
                {!playing && activeAttackCount === 0 && t > 0 && t < bounds[1] && (
                  <button onClick={() => setPlaying(true)} className="flex items-center gap-2 rounded-lg border border-sky-700 bg-sky-900/40 hover:bg-sky-900/60 px-3 py-2 text-sm font-medium text-sky-300">Wznów ▶</button>
                )}
              </div>
            </div>

            {/* Floor plan — flat, readable, side-anchored badges (no 3D) */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-4 px-1">Rzut domu — status urządzeń</p>
                <div className="relative w-full rounded-xl border border-slate-800 overflow-hidden" style={{ paddingBottom: "78%", background: "#efe3d8" }}>
                  <div className="absolute inset-0">
                    {ROOMS.map((r) => (
                      <div key={r.id} className="absolute rounded-lg" style={{ left: `${r.x}%`, top: `${(r.y / 78) * 100}%`, width: `${r.w}%`, height: `${(r.h / 78) * 100}%`, background: "#e2cfc0", border: "1px solid #b98d78" }}>
                        <span className="absolute top-1 left-1.5 text-[10px] font-medium text-[#5b4638]">{r.label}</span>
                        {DEVICES.filter((d) => d.room === r.id).map((d) => {
                          const st = statusFor(d.id, t); const style = STATUS_STYLE[st]; const Icon = d.icon;
                          return (
                            <div key={d.id} title={d.label} className={`absolute flex flex-col items-center justify-center gap-0.5 rounded-md border-2 ${style.ring} ${style.glow} bg-white/95 px-1.5 py-1 transition-all duration-300 ${ANCHOR_CLASS[d.anchor]}`}>
                              <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-white ${style.badge}`} />
                              <Icon size={13} className={style.icon} strokeWidth={2} />
                              <span className="text-[7.5px] font-medium text-slate-700 leading-none whitespace-nowrap">{d.id}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-5 mt-4 px-1 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> normalny</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-400" /> fałszywy alarm</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> propagacja</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> atak krytyczny</span>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-3 px-1">Alerty — centrum reagowania</p>
                <div className="space-y-3">
                  {alerts.length === 0 && <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-6 text-center text-sm text-slate-500">Brak aktywnych zagrożeń</div>}
                  {alerts.map((a) => {
                    const sevBg = a.sev === "red" ? "bg-red-500/10 border-red-500/30" : a.sev === "amber" ? "bg-amber-400/10 border-amber-400/30" : "bg-sky-400/10 border-sky-400/30";
                    const sevText = a.sev === "red" ? "text-red-300" : a.sev === "amber" ? "text-amber-300" : "text-sky-300";
                    const chosen = resolved[a.key]; const isCorrect = chosen ? a.correct.includes(chosen) : null;
                    return (
                      <div key={a.key} className={`rounded-xl border px-4 py-3 ${sevBg}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-100">{a.dev}</span>
                          <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500">pewność</span><span className={`text-xs font-bold ${sevText}`}>{a.confidence}%</span></div>
                        </div>
                        <p className={`text-xs font-medium mt-0.5 ${sevText}`}>{a.type}</p>
                        <p className="text-xs text-slate-400 mt-1">{a.reason}</p>
                        <div className="flex gap-1.5 mt-3">
                          {ACTIONS.map((act) => {
                            const ActIcon = act.icon; const isChosen = chosen === act.key;
                            return (
                              <button key={act.key} onClick={() => resolveAlert(a, act.key)} className={`flex-1 flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[10px] font-medium transition-colors ${isChosen ? (isCorrect ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" : "bg-red-500/20 border-red-500/50 text-red-300") : "bg-slate-950/40 border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                                <ActIcon size={12} />{act.label}
                              </button>
                            );
                          })}
                        </div>
                        {chosen && <p className={`text-[10px] mt-1.5 flex items-center gap-1 ${isCorrect ? "text-emerald-400" : "text-red-400"}`}>{isCorrect ? <Check size={11} /> : <XIcon size={11} />}{isCorrect ? "Trafna decyzja" : "Zalecana byłaby inna akcja"}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {allDone && allResolved && (
              <div className="mt-8 bg-sky-500/10 border border-sky-500/40 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-sky-200">Ostatni krok: krótka ankieta końcowa</p>
                  <p className="text-xs text-slate-400 mt-1">{countdown !== null && countdown > 0 ? `Za ${countdown} s zostaniesz przekierowany/a automatycznie. Możesz też przejść od razu.` : "Przekierowanie do ankiety…"}</p>
                </div>
                <button onClick={() => { setCountdown(null); downloadCSV(); setTimeout(() => { window.location.href = surveyUrl(); }, 600); }} className="text-sm font-medium px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950">Przejdź do ankiety</button>
              </div>
            )}
            {allDone ? (
              <div className="mt-8 bg-slate-900 border border-emerald-500/30 rounded-2xl p-6">
                <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
                  <div className="flex items-center gap-2"><BookOpenCheck size={18} className="text-emerald-400" /><h2 className="text-lg font-semibold text-white">Raport bezpieczeństwa</h2></div>
                  <button onClick={downloadCSV} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25">Pobierz CSV z sesji</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {ATTACKS.map((a) => {
                    const Icon = a.icon;
                    return (
                      <div key={a.key} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                        <div className={`flex items-center gap-2 mb-2 ${a.accent}`}><Icon size={16} /><span className="text-sm font-semibold">{a.label}</span></div>
                        <p className="text-xs text-slate-400 mb-3">{a.desc}</p>
                        <ul className="space-y-1.5">{a.defense.map((d, i) => <li key={i} className="text-xs text-slate-300 flex gap-1.5"><span className={a.accent}>›</span>{d}</li>)}</ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-8 bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-5 text-center text-sm text-slate-500">
                Uruchom wszystkie 4 scenariusze, aby odblokować raport bezpieczeństwa ({completed.size}/4)
              </div>
            )}
          </div>
        </div>

        {/* PAGE 2 — analytics dashboard */}
        <div style={{ width: "50%", flexShrink: 0 }} className="p-6 md:p-10 select-none bg-gradient-to-b from-slate-950 to-indigo-950/40 min-h-screen">
          <div className="max-w-5xl mx-auto">
            <p className="text-slate-500 text-sm tracking-wide">Panel analityczny</p>
            <h1 className="text-2xl font-semibold text-white mt-1 mb-6">Kondycja modelu i sieci — przegląd</h1>
            <div className="bg-slate-900/80 border border-cyan-900/40 rounded-2xl p-6 mb-6 flex flex-wrap gap-6 justify-around">
              {[["Precyzja", 0.899, "#22d3ee"], ["Recall", 0.993, "#2dd4bf"], ["F1-score", 0.944, "#38bdf8"], ["Accuracy", 0.993, "#67e8f9"]].map(([label, value, color]) => {
                const pct = Math.round(value * 100), r = 30, c = 2 * Math.PI * r;
                return (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <svg width="76" height="76" viewBox="0 0 76 76">
                      <circle cx="38" cy="38" r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
                      <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} strokeLinecap="round" transform="rotate(-90 38 38)" />
                      <text x="38" y="43" textAnchor="middle" fontSize="15" fontWeight="700" fill={color}>{pct}%</text>
                    </svg>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
                  </div>
                );
              })}
            </div>
            <div className="bg-slate-900/80 border border-cyan-900/40 rounded-2xl p-6 mb-6">
              <p className="text-xs uppercase tracking-wider text-cyan-500/70 mb-3">Poziom zagrożenia w czasie</p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="lvl2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="t" stroke="#475569" fontSize={10} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} width={24} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #164e63", fontSize: 12 }} />
                    <Area type="monotone" dataKey="level" stroke="#22d3ee" fill="url(#lvl2)" strokeWidth={1.5} />
                    <ReferenceLine x={t} stroke="#a78bfa" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-slate-900/80 border border-cyan-900/40 rounded-2xl p-6">
              <p className="text-xs uppercase tracking-wider text-cyan-500/70 mb-3">Czas trwania scenariuszy (próbki)</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#475569" fontSize={11} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} width={24} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #164e63", fontSize: 12 }} />
                    <Bar dataKey="val" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-full px-3 py-2">
        <button onClick={() => setPage(0)} className="p-1"><ChevronLeft size={16} className={page === 0 ? "text-slate-700" : "text-slate-300"} /></button>
        <button onClick={() => setPage(0)} className={`w-2 h-2 rounded-full ${page === 0 ? "bg-sky-400" : "bg-slate-700"}`} />
        <button onClick={() => setPage(1)} className={`w-2 h-2 rounded-full ${page === 1 ? "bg-cyan-400" : "bg-slate-700"}`} />
        <button onClick={() => setPage(1)} className="p-1"><ChevronRight size={16} className={page === 1 ? "text-slate-700" : "text-slate-300"} /></button>
      </div>

      {showIntro && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-7 max-w-md w-full">
            <h2 className="text-xl font-semibold text-white mb-3">Badanie: reakcja na alerty bezpieczeństwa IoT</h2>
            <p className="text-sm text-slate-400 mb-4">Zobaczysz symulację 4 zdarzeń w sieci domowej (w tym jeden fałszywy alarm). Symulacja zatrzyma się automatycznie przy każdym alercie — wybierz akcję: Izoluj, Blokuj IP lub Ignoruj.</p>
            <label className="text-xs uppercase tracking-wider text-slate-500 mb-1.5 block">ID uczestnika</label>
            <input value={participantId} onChange={(e) => setParticipantId(e.target.value)} placeholder="np. U01" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 mb-5 outline-none focus:border-sky-500" />
            <button disabled={!participantId.trim()} onClick={() => setShowIntro(false)} className="w-full bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 hover:bg-sky-400 text-slate-950 font-medium rounded-lg py-2.5 transition-colors">Rozpocznij</button>
          </div>
        </div>
      )}

    </div>
  );
}
