/**
 * FocusPanel — 집중도 모니터 전체.
 *
 * Study 페이지 안에 840줄로 눌러 담겨 있던 것을 그대로 옮겼다. 측정 소스는
 * 세 가지(PC 연결 · 태블릿 네이티브 · 브라우저 웹캠)지만, 화면에 보이는 것은
 * 하나이므로 `FocusEngine` 인터페이스 뒤에서 소스만 갈아끼운다.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '@iconify/react';
import Pressable from '../ui/Pressable';
import { Metric } from '../ui/Stat';
import Segmented from '../ui/Segmented';
import { HelpButton } from '../HelpButton';
import { TabletCamera } from '../TabletCamera';
import { materialize } from '../../lib/motion';
import { mmss } from '../../lib/format';
import { useFocusSync, type FocusFeatures } from '../../lib/focusSync';
import { useFocusNative } from '../../lib/useFocusNative';
import { useFocusWeb } from '../../lib/useFocusWeb';
import { useDrowsiness } from '../../lib/useDrowsiness';
import { NativeBridge, type RingerMode } from '../../lib/NativeBridge';
import { startDrowsyAlarm, type AlarmModality } from '../../lib/alarm';
import { incrementSessionDrowsyCount } from '../../lib/drowsyCounter';

// ── 공통 조각 ────────────────────────────────────────────────────────────────

/** 점수 구간 색 — 게이지·숫자·차트 기준선이 모두 이 규칙 하나를 따른다. */
const scoreColor = (score: number | null): string =>
    score === null ? 'rgba(255,255,255,0.2)' : score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';

function CircleGauge({ score }: { score: number }) {
    const r = 44;
    const circ = 2 * Math.PI * r;
    const color = scoreColor(score);
    return (
        <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle
                cx="60" cy="60" r={r}
                fill="none"
                stroke={color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(score / 100) * circ} ${circ}`}
                strokeDashoffset={circ * 0.25}
                style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.6s ease', filter: `drop-shadow(0 0 6px ${color}88)` }}
            />
            <text x="60" y="65" textAnchor="middle" fill="white" fontSize="22" fontWeight="800" fontFamily="inherit">
                {Math.round(score)}
            </text>
        </svg>
    );
}

interface ScorePoint { t: number; score: number }

/**
 * 점수 이력을 최근 60개까지만 들고 있는 훅.
 * PC/로컬 패널이 각자 같은 코드를 갖고 있었다.
 */
function useScoreHistory(score: number | null, onSample?: (s: number) => void) {
    const [history, setHistory] = useState<ScorePoint[]>([]);
    const startedAt = useRef(Date.now());
    const onSampleRef = useRef(onSample);
    onSampleRef.current = onSample;

    useEffect(() => {
        // 라이트 모드(점수 없음)와 NaN 은 이력·평점 산정에서 제외한다.
        if (score === null || !Number.isFinite(score)) return;
        onSampleRef.current?.(score);
        setHistory((prev) => [...prev, { t: (Date.now() - startedAt.current) / 1000, score }].slice(-60));
    }, [score]);

    return history;
}

// ── Tab 1: 집중도 ─────────────────────────────────────────────────────────────

function FocusTab({ score, etaS, scoreHistory }: { score: number | null; etaS: number | null; scoreHistory: ScorePoint[] }) {
    // 최근 구간의 기울기를 그대로 연장해 예측 곡선을 만든다 (8점 × 10초).
    const chartData = useMemo(() => {
        const hist = scoreHistory.map((p) => ({ t: p.t, score: p.score, proj: undefined as number | undefined }));
        if (scoreHistory.length < 3) return hist;
        const last = scoreHistory[scoreHistory.length - 1];
        const prev = scoreHistory[Math.max(0, scoreHistory.length - 6)];
        const dt = last.t - prev.t;
        if (dt <= 0) return hist;
        const slope = (last.score - prev.score) / dt;
        const proj = Array.from({ length: 8 }, (_, i) => ({
            t: last.t + (i + 1) * 10,
            score: undefined as undefined,
            proj: Math.max(0, Math.min(100, last.score + slope * (i + 1) * 10)),
        }));
        return [...hist, ...proj];
    }, [scoreHistory]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={{ flexShrink: 0 }}>
                    {score !== null ? <CircleGauge score={score} /> : (
                        <div style={{ width: '120px', height: '120px', borderRadius: '50%', border: '8px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="text-[10px] font-bold opacity-30">--</span>
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-0.5">집중 점수</span>
                        <span className="text-4xl font-black tabular-nums" style={{ color: scoreColor(score) }}>
                            {score !== null ? score.toFixed(1) : '--'}
                            <span className="text-lg font-bold opacity-40"> / 100</span>
                        </span>
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-0.5">집중 유지 ETA</span>
                        <span className="text-xl font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.7)' }}>
                            {etaS !== null ? mmss(etaS) : '측정 중...'}
                        </span>
                    </div>
                </div>
            </div>

            {chartData.length > 1 && (
                <div>
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2">집중도 추이 + 예측 곡선</span>
                    <div style={{ width: '100%', height: '120px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                                <XAxis dataKey="t" hide />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} />
                                <Tooltip
                                    contentStyle={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
                                    labelFormatter={() => ''}
                                    formatter={(val) => [typeof val === 'number' ? val.toFixed(1) : '--', '']}
                                />
                                <ReferenceLine y={70} stroke="rgba(34,197,94,0.3)" strokeDasharray="3 3" />
                                <ReferenceLine y={40} stroke="rgba(245,158,11,0.3)" strokeDasharray="3 3" />
                                <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot={false} connectNulls={false} />
                                <Line type="monotone" dataKey="proj" stroke="#818cf8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Tab 2: 시선 ──────────────────────────────────────────────────────────────

/** 시선 지표 — 기본 노출 */
const GAZE_METRICS = [
    { key: 'saccade_rate', label: '새카드율 (시선 점프)', unit: '/s', decimals: 2, color: '#f472b6' },
    { key: 'fixation_ratio', label: '고정 비율 (응시 유지)', unit: '', decimals: 2, color: '#22c55e' },
    { key: 'mean_fix_duration', label: '평균 고정 시간', unit: 's', decimals: 3, color: '#60a5fa' },
    { key: 'mean_velocity', label: '평균 시선 속도', unit: 'px/s', decimals: 0, color: '#a78bfa' },
    { key: 'std_velocity', label: '속도 분산', unit: 'px/s', decimals: 0, color: '#fb923c' },
    { key: 'mean_ear', label: 'EAR (눈 감은 정도)', unit: '', decimals: 3, color: '#facc15' },
    { key: 'min_ear', label: 'EAR 최솟값 (순간 졸음)', unit: '', decimals: 3, color: '#f97316' },
    { key: 'valid_ratio', label: '유효 프레임 비율', unit: '', decimals: 2, color: '#34d399' },
] as const satisfies readonly MetricSpec[];

/** 졸음·자세 지표 — 고급 모드에서만 */
const ADVANCED_METRICS = [
    { key: 'perclos', label: 'PERCLOS (눈 감은 비율)', unit: '%', decimals: 1, scale: 100, color: '#f97316' },
    { key: 'blink_rate_hz', label: '깜빡임 빈도', unit: '/s', decimals: 2, color: '#facc15' },
    { key: 'mean_blink_dur_s', label: '평균 깜빡임 시간', unit: 's', decimals: 2, color: '#fb923c' },
    { key: 'ear_norm', label: 'EAR 정규화', unit: '', decimals: 3, color: '#fbbf24' },
    { key: 'disp_norm', label: '시선 분산 정규화', unit: '', decimals: 3, color: '#a78bfa' },
    { key: 'head_pitch_deg', label: '고개 상하 각도', unit: '°', decimals: 1, color: '#60a5fa' },
    { key: 'head_yaw_deg', label: '고개 좌우 각도', unit: '°', decimals: 1, color: '#22d3ee' },
    { key: 'head_move_std_deg', label: '고개 움직임 표준편차', unit: '°', decimals: 2, color: '#34d399' },
    { key: 'ear_slope_60s', label: 'EAR 추세 (60초)', unit: '', decimals: 3, color: '#f472b6' },
    { key: 'fix_ratio_slope_60s', label: '고정비율 추세 (60초)', unit: '', decimals: 3, color: '#818cf8' },
] as const satisfies readonly MetricSpec[];

/** 생체신호 지표 */
const BIO_METRICS = [
    { key: 'bpm', label: 'BPM (심박수)', unit: '', decimals: 0, color: '#f472b6' },
    { key: 'rmssd', label: 'RMSSD (심박 변동)', unit: 'ms', decimals: 1, color: '#fb923c' },
    { key: 'sdnn', label: 'SDNN (전체 변동성)', unit: 'ms', decimals: 1, color: '#facc15' },
    { key: 'lf_hf', label: 'LF/HF (교감/부교감)', unit: '', decimals: 2, color: '#60a5fa' },
    { key: 'dispersion_x', label: 'X 분산 (좌우 시선)', unit: 'px', decimals: 0, color: '#a78bfa' },
    { key: 'dispersion_y', label: 'Y 분산 (상하 시선)', unit: 'px', decimals: 0, color: '#34d399' },
] as const satisfies readonly MetricSpec[];

interface MetricSpec {
    key: keyof FocusFeatures;
    label: string;
    unit: string;
    decimals: number;
    scale?: number;
    color: string;
}

/** 지표 표를 2열 그리드로 낸다 — 카드 하나하나를 손으로 쓰던 30여 줄을 대체한다. */
function MetricGrid({ specs, features, placeholder }: {
    specs: readonly MetricSpec[];
    features: FocusFeatures | null;
    placeholder?: string;
}) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {specs.map((m) => (
                <Metric
                    key={m.key}
                    label={m.label}
                    value={features?.[m.key] as number | undefined}
                    unit={m.unit}
                    decimals={m.decimals}
                    scale={m.scale}
                    color={m.color}
                    placeholder={placeholder}
                />
            ))}
        </div>
    );
}

const ADVANCED_FEATURES_KEY = 'sm_advanced_features';

function GazeTab({ features, gazeX, gazeY }: {
    features: FocusFeatures | null;
    /** 캘리브레이션된 실제 시선 좌표 (0-1 정규화). 네이티브에서만 온다. */
    gazeX?: number | null;
    gazeY?: number | null;
}) {
    const [dot, setDot] = useState({ x: 0.5, y: 0.5 });
    const hasGaze = gazeX != null && gazeY != null;

    useEffect(() => {
        if (!hasGaze) return;
        // 가벼운 EMA 로 떨림만 눌러준다 (원본 좌표를 그대로 쓰면 점이 튄다).
        const clamp = (v: number) => Math.min(1, Math.max(0, v));
        setDot((p) => ({ x: p.x * 0.6 + clamp(gazeX!) * 0.4, y: p.y * 0.6 + clamp(gazeY!) * 0.4 }));
    }, [gazeX, gazeY, hasGaze]);

    const dotColor = (features?.saccade_rate ?? 0) > 2 ? '#f472b6' : '#22c55e';
    const advanced = localStorage.getItem(ADVANCED_FEATURES_KEY) === 'true';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
                <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2">
                    {hasGaze ? '캘리브레이션 기반 실시간 시선 위치' : '시선 위치 (캘리브레이션 후 정확도 향상)'}
                </span>
                <div style={{ position: 'relative', width: '100%', paddingTop: '50%', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: `1px solid ${hasGaze ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0 }}>
                        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.06)' }} />
                        <div style={{ position: 'absolute', top: '33%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                        <div style={{ position: 'absolute', top: '66%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                    </div>
                    {hasGaze ? (
                        <motion.div
                            animate={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
                            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                            style={{ position: 'absolute', width: '18px', height: '18px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 14px 5px ${dotColor}66`, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
                        />
                    ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="text-[10px] opacity-30">캘리브레이션 필요</span>
                        </div>
                    )}
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.12, pointerEvents: 'none' }}>
                        <div style={{ width: '20px', height: '1px', background: 'white', position: 'absolute', top: 0, left: '-10px' }} />
                        <div style={{ width: '1px', height: '20px', background: 'white', position: 'absolute', top: '-10px', left: 0 }} />
                    </div>
                </div>
            </div>

            <MetricGrid specs={GAZE_METRICS} features={features} />

            {advanced && (
                <div>
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2 mt-2">졸음·자세 (고급 모드)</span>
                    <MetricGrid specs={ADVANCED_METRICS} features={features} placeholder="—" />
                </div>
            )}
        </div>
    );
}

// ── Tab 3: 생체신호 ───────────────────────────────────────────────────────────

function BioTab({ features, roiColors }: {
    features: FocusFeatures | null;
    roiColors?: { forehead?: string; rightCheek?: string; leftCheek?: string } | null;
}) {
    const bpm = features?.bpm;
    const pulsePeriodMs = bpm && isFinite(bpm) && bpm > 0 ? 60000 / bpm : 1000;
    const [pulse, setPulse] = useState(false);
    const hasActualColors = !!roiColors?.forehead;

    useEffect(() => {
        const id = setInterval(() => setPulse((p) => !p), pulsePeriodMs / 2);
        return () => clearInterval(id);
    }, [pulsePeriodMs]);

    // 실측 ROI 색이 없으면 LF/HF(교감 우위)로 혈색을 추정해 보여준다.
    const lf_hf = features?.lf_hf;
    const stress = lf_hf && isFinite(lf_hf) ? Math.min(1, lf_hf / 4) : 0.5;
    const estimated = `rgb(${Math.round(200 + stress * 40)},${Math.round(120 - stress * 30)},${Math.round(120 - stress * 20)})`;

    const forehead = roiColors?.forehead ?? estimated;
    const rCheek = roiColors?.rightCheek ?? forehead;
    const lCheek = roiColors?.leftCheek ?? forehead;
    const pulseBright = pulse && forehead.startsWith('#') ? `${forehead}cc` : forehead;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
                <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2">
                    rPPG 얼굴 ROI 색상 {hasActualColors ? '(실시간 측정값)' : '(추정값)'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: `1px solid ${hasActualColors ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <motion.div
                            animate={{ scale: pulse ? 1.06 : 1.0, background: pulseBright }}
                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                            style={{ width: '44px', height: '22px', borderRadius: '8px 8px 4px 4px', boxShadow: `0 0 12px 3px ${forehead}88` }}
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <div style={{ width: '14px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                            <div style={{ width: '14px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                            <motion.div animate={{ background: rCheek }} transition={{ duration: 0.3 }}
                                style={{ width: '16px', height: '12px', borderRadius: '50%', boxShadow: `0 0 6px ${rCheek}88` }} />
                            <div style={{ width: '12px', height: '22px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }} />
                            <motion.div animate={{ background: lCheek }} transition={{ duration: 0.3 }}
                                style={{ width: '16px', height: '12px', borderRadius: '50%', boxShadow: `0 0 6px ${lCheek}88` }} />
                        </div>
                    </div>

                    <div style={{ flex: 1 }}>
                        <p className="text-[10px] opacity-50 leading-relaxed">
                            <span style={{ color: '#00dcff' }}>이마</span> + <span style={{ color: '#ffa040' }}>양쪽 볼</span> 3곳 ROI의<br />
                            평균 RGB 색상을 실시간으로 추출합니다.<br />
                            미세한 <span style={{ color: '#f472b6' }}>혈류 변화</span>로 심박수를 계산합니다.
                        </p>
                        {hasActualColors && (
                            <>
                                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                                    {([['이마', forehead], ['오른볼', rCheek], ['왼볼', lCheek]] as const).map(([label, color]) => (
                                        <span key={label} style={{ display: 'contents' }}>
                                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: color, border: '1px solid rgba(255,255,255,0.2)' }} />
                                            <span className="text-[9px] opacity-40">{label}</span>
                                        </span>
                                    ))}
                                </div>
                                <p className="text-[9px] opacity-25 mt-1 font-mono">{roiColors?.forehead} · {roiColors?.rightCheek} · {roiColors?.leftCheek}</p>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <MetricGrid specs={BIO_METRICS} features={features} />
        </div>
    );
}

// ── 패널 껍데기 ──────────────────────────────────────────────────────────────

const FOCUS_TABS = [
    { value: '집중도', label: '집중도' },
    { value: '시선', label: '시선' },
    { value: '생체신호', label: '생체신호' },
] as const;
type FocusTabName = (typeof FOCUS_TABS)[number]['value'];

/** 세 탭의 전환 애니메이션 — PC/로컬 패널이 똑같이 쓴다. */
function FocusTabs({ score, etaS, features, scoreHistory, gazeX, gazeY, roiColors, layoutId }: {
    score: number | null;
    etaS: number | null;
    features: FocusFeatures | null;
    scoreHistory: ScorePoint[];
    gazeX?: number | null;
    gazeY?: number | null;
    roiColors?: { forehead?: string; rightCheek?: string; leftCheek?: string } | null;
    layoutId: string;
}) {
    const [tab, setTab] = useState<FocusTabName>('집중도');
    return (
        <>
            <Segmented layoutId={layoutId} options={FOCUS_TABS} value={tab} onChange={setTab} size="tab" tone="glass" />
            <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                    {tab === '집중도' && <FocusTab score={score} etaS={etaS} scoreHistory={scoreHistory} />}
                    {tab === '시선' && <GazeTab features={features} gazeX={gazeX} gazeY={gazeY} />}
                    {tab === '생체신호' && <BioTab features={features} roiColors={roiColors} />}
                </motion.div>
            </AnimatePresence>
        </>
    );
}

function PanelShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mt-6 w-full max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/[0.06] p-5"
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {children}
        </div>
    );
}

function PanelHeader({ label, dot, dotColor, dotLabel, onSwitchMode, switchLabel }: {
    label: string; dot: boolean; dotColor?: string; dotLabel: string; onSwitchMode: () => void; switchLabel: string;
}) {
    const color = dotColor ?? (dot ? '#22c55e' : '#ef4444');
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">집중도 모니터</span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc', border: '1px solid rgba(129,140,248,0.2)' }}>{label}</span>
                <HelpButton dark title="집중도 모니터란?" items={[
                    { description: '카메라로 얼굴을 분석해 집중 점수(0–100)를 실시간으로 측정합니다.' },
                    { title: '집중도 탭', description: '전체 집중 점수와 트렌드 그래프, 집중 유지 예상 시간(ETA)을 보여줍니다.' },
                    { title: '시선 탭', description: '눈 움직임(새카드율·고정 비율)을 분석해 시선이 분산되는지 추적합니다.' },
                    { title: '생체신호 탭', description: 'rPPG 기술로 카메라에서 심박수·심박 변동성 등 생체 신호를 비접촉으로 측정합니다.' },
                    { title: '측정 모드', description: '브라우저 자체 측정(웹캠) 또는 PC 연결 측정(별도 서버)을 지원합니다.' },
                ]} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, boxShadow: dot ? `0 0 5px ${color}` : 'none', transition: 'all 0.4s ease' }} />
                    <span className="text-[10px] font-bold opacity-40">{dotLabel}</span>
                </div>
                <button onClick={onSwitchMode} style={{
                    fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px',
                    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'all 0.2s ease',
                }}>
                    {switchLabel} ↕
                </button>
            </div>
        </div>
    );
}

// ── 측정 소스 ────────────────────────────────────────────────────────────────

type MeasureMode = 'pc' | 'native' | 'web';
const MODE_KEY = 'focus_measure_mode';

/** 태블릿(네이티브) / 브라우저(웹) 자체 측정 엔진의 공통 인터페이스. */
export interface FocusEngine {
    score: number | null;
    etaS: number | null;
    features: FocusFeatures | null;
    running: boolean;
    status: string;
    cameraJpeg: string | null;
    gazeX: number | null;
    gazeY: number | null;
    roiColors: { forehead?: string; rightCheek?: string; leftCheek?: string } | null;
    trainingState: { session_count: number; is_calibrated: boolean } | null;
    start: (opts?: { lightMode?: boolean }) => void | Promise<void>;
    stop: () => void | Promise<void>;
    startCalibration: (scenario?: 'book' | 'monitor') => Promise<boolean | void>;
    setDebugMode: (enabled: boolean) => void | Promise<void>;
    addSessionRating: (mean: number, rating: number) => void | Promise<void>;
}

const FocusPanel = memo(function FocusPanel({ drowsinessThresholdSec }: { drowsinessThresholdSec: number }) {
    const isApp = NativeBridge.isNative();
    const localMode: MeasureMode = isApp ? 'native' : 'web';
    const [mode, setMode] = useState<MeasureMode>(() =>
        localStorage.getItem(MODE_KEY) === 'pc' ? 'pc' : localMode,
    );
    const saveMode = (m: MeasureMode) => {
        setMode(m);
        localStorage.setItem(MODE_KEY, m);
    };

    if (mode === 'pc') return <PcPanel onSwitchMode={() => saveMode(localMode)} />;
    // 엔진 훅은 카메라 파이프라인을 잡으므로 쓰는 쪽 하나만 마운트한다.
    const Panel = isApp ? NativePanel : WebPanel;
    return <Panel onSwitchMode={() => saveMode('pc')} drowsinessThresholdSec={drowsinessThresholdSec} />;
});

export default FocusPanel;

type LocalPanelProps = { onSwitchMode: () => void; drowsinessThresholdSec: number };

function NativePanel(props: LocalPanelProps) {
    const engine = useFocusNative();
    return <LocalPanel {...props} engine={engine} available={engine.isNative} label="태블릿 자체 측정" calibration />;
}

function WebPanel(props: LocalPanelProps) {
    const engine = useFocusWeb();
    return <LocalPanel {...props} engine={engine} available label="브라우저 자체 측정" />;
}

function PcPanel({ onSwitchMode }: { onSwitchMode: () => void }) {
    const serverUrl = useMemo(() => localStorage.getItem('focus_server_url') ?? '', []);
    const { score, etaS, features, connected, sendVideoFrame } = useFocusSync(serverUrl);
    const scoreHistory = useScoreHistory(score);

    return (
        <PanelShell>
            <PanelHeader
                label="PC 연결 측정"
                dot={connected}
                dotLabel={connected ? 'Connected' : 'Disconnected'}
                onSwitchMode={onSwitchMode}
                switchLabel="태블릿 자체 측정으로"
            />
            <FocusTabs layoutId="focus-tab-pc" score={score} etaS={etaS} features={features} scoreHistory={scoreHistory} gazeX={null} gazeY={null} roiColors={null} />
            <TabletCamera sendVideoFrame={sendVideoFrame} connected={connected} fps={10} />
        </PanelShell>
    );
}

const STATUS_LABEL: Record<string, string> = {
    unavailable: '앱에서만 사용 가능',
    starting: '시작 중...',
    running: '측정 중',
    error: '오류',
};
const STATUS_COLOR: Record<string, string> = {
    running: '#22c55e',
    error: '#ef4444',
    unavailable: '#6b7280',
};

/**
 * 태블릿·브라우저 자체 측정 패널.
 * 두 소스는 엔진 훅만 다르고 화면이 같아, 이전의 두 래퍼 컴포넌트를 하나로 합쳤다.
 */
function LocalPanel({ engine, available, label, calibration = false, onSwitchMode, drowsinessThresholdSec }: LocalPanelProps & {
    engine: FocusEngine;
    available: boolean;
    label: string;
    /** 캘리브레이션 버튼 노출 (네이티브 전용) */
    calibration?: boolean;
}) {
    const { score, etaS, features, running, status, cameraJpeg, gazeX, gazeY, roiColors,
        trainingState, addSessionRating, start, stop, startCalibration, setDebugMode } = engine;

    const [cameraOpen, setCameraOpen] = useState(false);
    const [showRating, setShowRating] = useState(false);
    const [ratingHover, setRatingHover] = useState(0);
    /** false = 집중도+졸음(풀), true = 졸음만(라이트). 측정 중에는 바꿀 수 없다. */
    const [lightMode, setLightMode] = useState(false);
    const sessionScores = useRef<number[]>([]);

    const scoreHistory = useScoreHistory(score, (s) => sessionScores.current.push(s));

    useEffect(() => {
        if (running) {
            setShowRating(false);
            sessionScores.current = [];
            return;
        }
        if (scoreHistory.length > 5) setShowRating(true);
        if (cameraOpen) {
            setCameraOpen(false);
            setDebugMode(false);
        }
        // 측정 시작/중지 순간에만 반응한다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running]);

    const handleRating = async (rating: number) => {
        const scores = sessionScores.current;
        if (!scores.length) return;
        await addSessionRating(scores.reduce((a, b) => a + b, 0) / scores.length, rating);
        setShowRating(false);
        sessionScores.current = [];
    };

    const busy = status === 'starting' || status === 'unavailable';

    return (
        <PanelShell>
            <PanelHeader
                label={label}
                dot={status === 'running'}
                dotColor={STATUS_COLOR[status] ?? '#f59e0b'}
                dotLabel={STATUS_LABEL[status] ?? '대기 중'}
                onSwitchMode={onSwitchMode}
                switchLabel="PC 연결로"
            />

            {/* 측정 모드는 시작 전에만 고를 수 있다 */}
            {available && !running && (
                <Segmented
                    layoutId="focus-measure-mode"
                    size="mode"
                    tone="glass"
                    disabled={status === 'starting'}
                    value={lightMode ? 'light' : 'full'}
                    onChange={(v) => setLightMode(v === 'light')}
                    options={[
                        { value: 'full', label: <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span>집중도 + 졸음</span><span style={{ fontSize: '8px', opacity: 0.6 }}>전체 측정</span></span> },
                        { value: 'light', label: <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}><span>졸음만 (라이트)</span><span style={{ fontSize: '8px', opacity: 0.6 }}>저전력</span></span> },
                    ]}
                />
            )}

            {available && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={running ? stop : () => start({ lightMode })}
                        disabled={busy}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: '10px', fontSize: '12px', fontWeight: 800,
                            background: running ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                            color: running ? '#f87171' : '#4ade80',
                            border: `1px solid ${running ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1, transition: 'all 0.2s ease',
                        }}
                    >
                        {status === 'starting' ? '시작 중...' : running ? '측정 중지' : lightMode ? '졸음 감지 시작' : '측정 시작'}
                    </button>
                    {calibration && (
                        <button
                            onClick={() => startCalibration('monitor')}
                            style={{
                                padding: '10px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                                background: 'rgba(129,140,248,0.12)', color: '#a5b4fc',
                                border: '1px solid rgba(129,140,248,0.25)', cursor: 'pointer',
                            }}
                        >
                            캘리브레이션
                        </button>
                    )}
                </div>
            )}

            {/* 미리보기는 기본 접힘 — 펼쳐 두면 프레임 전송이 스로틀된다 */}
            {available && running && (
                <div>
                    <button
                        onClick={() => {
                            setCameraOpen(!cameraOpen);
                            setDebugMode(!cameraOpen);
                        }}
                        style={{
                            width: '100%', padding: '7px 12px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                            background: cameraOpen ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                            color: cameraOpen ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
                            border: `1px solid ${cameraOpen ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)'}`,
                            cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '6px',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        <span style={{ fontSize: '9px' }}>{cameraOpen ? '▼' : '▶'}</span>
                        카메라 미리보기 {cameraOpen ? '' : '(성능 영향 없음)'}
                    </button>
                    {cameraOpen && (
                        <div style={{ marginTop: '6px', position: 'relative', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#000' }}>
                            {cameraJpeg
                                ? <img src={cameraJpeg} alt="카메라 미리보기" style={{ width: '100%', display: 'block', objectFit: 'contain', maxHeight: '240px' }} />
                                : <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>프레임 대기 중...</div>}
                            {cameraJpeg && (
                                <div style={{ position: 'absolute', bottom: '6px', left: '8px', fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px' }}>
                                    LIVE · ROI 오버레이
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {available && showRating && (
                <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#a5b4fc', marginBottom: '10px', textAlign: 'center' }}>
                        세션 집중도를 평가해주세요 (점수 개인화에 사용됩니다)
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        {[1, 2, 3, 4, 5].map((r) => (
                            <button
                                key={r}
                                onClick={() => handleRating(r)}
                                onMouseEnter={() => setRatingHover(r)}
                                onMouseLeave={() => setRatingHover(0)}
                                style={{
                                    fontSize: '22px', background: 'none', border: 'none', cursor: 'pointer',
                                    opacity: ratingHover > 0 ? (r <= ratingHover ? 1 : 0.3) : 0.6,
                                    transform: r <= ratingHover ? 'scale(1.2)' : 'scale(1)',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                ★
                            </button>
                        ))}
                    </div>
                    {trainingState && (
                        <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: '6px' }}>
                            누적 {trainingState.session_count}회 · {trainingState.is_calibrated ? '✓ 개인화 적용 중' : `${3 - trainingState.session_count}회 더 필요`}
                        </p>
                    )}
                    <button
                        onClick={() => setShowRating(false)}
                        style={{ display: 'block', margin: '8px auto 0', fontSize: '9px', color: 'rgba(255,255,255,0.25)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                        건너뛰기
                    </button>
                </div>
            )}

            {!available && (
                <div style={{ padding: '16px', background: 'rgba(107,114,128,0.1)', borderRadius: '12px', border: '1px solid rgba(107,114,128,0.2)', textAlign: 'center' }}>
                    <p className="text-[11px] opacity-50">태블릿 자체 측정은 Android 앱에서만 사용 가능합니다</p>
                </div>
            )}

            {lightMode
                ? <LightModeStatus features={features} running={running} thresholdSec={drowsinessThresholdSec} />
                : <FocusTabs layoutId="focus-tab-local" score={score} etaS={etaS} features={features} scoreHistory={scoreHistory} gazeX={gazeX} gazeY={gazeY} roiColors={roiColors} />}

            {/* 졸음 경고는 집중도 측정 중에도, 라이트 모드 단독으로도 작동한다 */}
            <DrowsinessAlert features={features} running={running} thresholdSec={drowsinessThresholdSec} />
        </PanelShell>
    );
}

// ── 졸음 ─────────────────────────────────────────────────────────────────────

/**
 * 졸음 감지 경고. `mean_ear` 스트림으로 눈 감김 지속을 추적하다가 임계를 넘으면
 * 디바이스 벨소리 모드에 맞춰 소리/진동으로 알리고(무음이면 화면만), 눈을 다시
 * 뜰 때까지 전체화면 팝업을 띄운다.
 */
function DrowsinessAlert({ features, running, thresholdSec }: {
    features: FocusFeatures | null; running: boolean; thresholdSec: number;
}) {
    const { drowsy } = useDrowsiness(features, running, true, thresholdSec);
    const [ringerMode, setRingerMode] = useState<RingerMode>('normal');
    const stopAlarm = useRef<(() => void) | null>(null);

    const silence = () => {
        stopAlarm.current?.();
        stopAlarm.current = null;
    };

    // 알람(소리/진동)은 외부 시스템이라 effect 로 동기화한다. 눈을 뜨면 정지.
    useEffect(() => {
        if (!drowsy) return silence();
        incrementSessionDrowsyCount(); // 일기 자동 통계용
        let cancelled = false;
        (async () => {
            const mode = await NativeBridge.getRingerMode();
            if (cancelled) return;
            setRingerMode(mode);
            const modality: AlarmModality = mode === 'silent' ? 'silent' : mode === 'vibrate' ? 'vibrate' : 'sound';
            stopAlarm.current = startDrowsyAlarm(modality);
        })();
        return () => {
            cancelled = true;
            silence();
        };
    }, [drowsy]);

    if (!drowsy) return null;

    const modeLabel = ringerMode === 'silent'
        ? '무음 모드 — 소리·진동 없이 화면으로만 알립니다'
        : ringerMode === 'vibrate' ? '진동으로 알리는 중' : '소리로 알리는 중';

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}
                className="absolute inset-0 bg-red-950/60 backdrop-blur-md" />
            <motion.div variants={materialize} initial="initial" animate="animate"
                className="relative liquid-modal p-10 flex flex-col items-center gap-5 max-w-sm w-full text-center shadow-2xl border border-red-500/40">
                <Icon icon="mdi:sleep" className="text-7xl text-red-400" />
                <h3 className="text-3xl font-black tracking-tight text-display">졸음이 감지됐어요!</h3>
                <p className="font-bold opacity-70 leading-relaxed">
                    눈이 {thresholdSec}초 넘게 감겨 있었어요.<br />눈을 크게 뜨고 잠을 깨워주세요.
                </p>
                <p className="text-[11px] font-bold uppercase tracking-widest text-red-300/80">{modeLabel}</p>
                {/* "확인"은 현재 알람만 끈다 — 팝업은 눈을 다시 뜰 때까지 유지된다 */}
                <Pressable onClick={silence} pressScale={0.97}
                    className="w-full py-4 bg-red-500 text-white rounded-2xl font-black text-lg shadow-xl">
                    확인 (소리·진동 끄기)
                </Pressable>
                <p className="text-[10px] opacity-40">눈을 다시 뜨면 자동으로 닫힙니다</p>
            </motion.div>
        </div>,
        document.body,
    );
}

/** 라이트 모드(졸음 전용) 상태 카드. */
function LightModeStatus({ features, running, thresholdSec }: {
    features: FocusFeatures | null; running: boolean; thresholdSec: number;
}) {
    const eyesDetected = features != null && Number.isFinite(features.mean_ear);
    return (
        <div style={{ padding: '18px', borderRadius: '14px', background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center' }}>
            <Icon icon="mdi:eye-check-outline" style={{ fontSize: '34px', color: running ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }} />
            <p style={{ fontSize: '14px', fontWeight: 800, color: running ? '#c7d2fe' : 'rgba(255,255,255,0.5)' }}>
                {running ? (eyesDetected ? '눈 상태 감시 중' : '얼굴을 찾는 중…') : '졸음 감지 라이트 모드'}
            </p>
            <p style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                {running
                    ? `눈이 ${thresholdSec}초 넘게 감기면 알려드려요.`
                    : '“졸음 감지 시작”을 누르면 눈 상태만 가볍게 감시합니다.'}
                <br />집중 점수·심박(rPPG) 측정은 꺼져 <b>배터리를 절약</b>합니다.
            </p>
        </div>
    );
}
