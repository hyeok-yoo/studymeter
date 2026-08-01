/**
 * RoomPanel — 공부 중 화면에 붙는 "내 방" 상태·제어 패널.
 *
 * 원칙:
 *  - 집(로컬 HA 도달)이 아니면 아무것도 렌더하지 않는다. 숨김이 아니라 미마운트.
 *  - 지표는 4개로 고정. 문제가 있는 값만 색이 붙어서 시선을 끈다.
 *  - 슬라이더는 드래그 중 1:1 로 숫자만 움직이고, 손을 뗄 때 한 번만 HA 를 부른다.
 *    (드래그마다 서비스 호출하면 저사양 HA 호스트가 그대로 얻어맞는다)
 *  - 조명 카드는 그 자체가 밝기 트랙이다. 짧게 누르면 토글, 끌면 밝기.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@iconify/react';
import Pressable from './ui/Pressable';
import { spring } from '../lib/motion';
import { useHomeAssistant } from '../lib/ha/useHomeAssistant';
import { DEFAULT_SUBJECT_LIGHT_PRESETS, findDefaultPreset, type LightPresetValue } from '../lib/ha/presets';
import { dewPoint, type HaConfig, type HaEntityState, type HaLightRef, type HaStateMap } from '../lib/ha/types';
import type { SubjectItem } from '../lib/db';

interface RoomPanelProps {
    config: HaConfig | undefined;
    /** 현재 공부 중인 과목 — 색온도 프리셋 저장 대상 */
    currentSubject: string;
    subjects: SubjectItem[];
    onSaveSubjectPreset: (subjectName: string, colorTempK: number) => void;
    /** 집중력 모니터 펼치기 토글 (패널 하단 바) */
    focusOpen: boolean;
    onToggleFocus: () => void;
    /**
     * 방 패널이 실제로 그려지는지 상위에 알린다. 집 밖이면 이 패널이 통째로
     * 사라지므로, 그때는 집중력 모니터를 원래대로 항상 보여줘야 한다.
     */
    onAvailabilityChange?: (available: boolean) => void;
}

const KELVIN_MIN = 2200;
const KELVIN_MAX = 6500;

/** 이만큼 못 움직였으면 드래그가 아니라 탭이다 (Apple 의 히스테리시스). */
const DRAG_THRESHOLD_PX = 6;
/** 이보다 오래 누르고 있었으면 탭으로 치지 않는다 — 망설이다 뗀 손가락이 조명을 끄면 곤란하다. */
const TAP_MAX_MS = 400;
/** 커밋 후 HA 가 실제 값을 되돌려줄 때까지 로컬 값을 우선 표시하는 시간. */
const OPTIMISTIC_HOLD_MS = 1500;
/** 키보드 좌우 화살표 한 칸. */
const KEY_STEP_PCT = 5;

/**
 * 바람 세기 한국어 라벨. LG ThinQ 가 어떤 문자열을 줄지 확정할 수 없으므로
 * 매핑에 없는 값은 원문 그대로 내보낸다 (fallback 이 본체다).
 */
const FAN_MODE_LABELS: Record<string, string> = {
    auto: '자동',
    off: '끄기',
    on: '켜기',
    low: '약',
    mid: '중',
    middle: '중',
    medium: '중',
    high: '강',
    quiet: '무음',
    silent: '무음',
    turbo: '터보',
    power: '강력',
    max: '최대',
    min: '최소',
    eco: '절전',
    sleep: '취침',
    nature: '자연풍',
    natural: '자연풍',
    diffuse: '확산',
    focus: '집중',
};

function fanModeLabel(mode: string): string {
    return FAN_MODE_LABELS[mode.trim().toLowerCase()] ?? mode;
}

function num(s: HaEntityState | undefined): number | null {
    if (!s) return null;
    const v = Number(s.state);
    return Number.isFinite(v) ? v : null;
}

function pick(states: HaStateMap, id: string | undefined): HaEntityState | undefined {
    return id ? states[id] : undefined;
}

function clampPct(v: number): number {
    return Math.max(1, Math.min(100, Math.round(v)));
}

/**
 * 밝기를 조절할 수 있는 조명인지. onoff 전용 조명은 기존 토글 버튼 그대로 둔다.
 * (supported_color_modes 가 ['onoff'] 뿐이면 brightness 속성 자체가 없다)
 */
function supportsBrightness(st: HaEntityState | undefined): boolean {
    if (!st) return false;
    if (typeof st.attributes.brightness === 'number') return true;
    const modes = st.attributes.supported_color_modes;
    if (!Array.isArray(modes)) return false;
    return modes.some(m => typeof m === 'string' && m !== 'onoff' && m !== 'unknown');
}

/** 드래그 시작점. 렌더 중에는 절대 건드리지 않고 포인터 핸들러에서만 읽고 쓴다. */
interface DragOrigin {
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    trackWidth: number;
    /** 임계값을 넘은 순간의 좌표와 밝기 — 여기서부터 손가락과 1:1 로 간다 */
    originX: number;
    originPct: number;
    moved: boolean;
    pct: number;
}

/**
 * 조명 한 칸. 카드 전체가 밝기 트랙이다.
 *
 *  - 탭(6px 미만 이동 + 짧은 시간) = 토글
 *  - 드래그 = 밝기. 드래그 중엔 로컬 상태만 움직이고 HA 는 부르지 않는다.
 *  - 손을 뗄 때(또는 화살표 키를 뗄 때) 딱 한 번 setLightBrightness 를 부른다.
 */
function LightRow({ light, state, onToggle, onCommitBrightness }: {
    light: HaLightRef;
    state: HaEntityState | undefined;
    onToggle: () => void;
    onCommitBrightness: (pct: number) => void;
}) {
    const on = state?.state === 'on';
    const brightness = state?.attributes.brightness as number | undefined;
    // HA 가 말하는 실제 밝기(%). 꺼져 있으면 의미가 없다.
    const haPct = on && typeof brightness === 'number'
        ? Math.max(1, Math.round((brightness / 255) * 100))
        : null;

    /** 드래그 중 + 커밋 직후에 화면에 우선 표시할 값 */
    const [localPct, setLocalPct] = useState<number | null>(null);
    const [dragging, setDragging] = useState(false);
    const [pressed, setPressed] = useState(false);
    /** 커밋 횟수 — 낙관 유지 타이머를 다시 거는 키로만 쓴다 */
    const [commitSeq, setCommitSeq] = useState(0);
    const dragRef = useRef<DragOrigin | null>(null);

    // 커밋 직후에는 잠깐 로컬 값을 붙잡아 둔다. 안 그러면 손을 뗀 순간
    // 아직 갱신되지 않은 옛 값으로 슬라이더가 튀어 돌아간다.
    useEffect(() => {
        if (!commitSeq || dragging) return;
        const timer = setTimeout(() => setLocalPct(null), OPTIMISTIC_HOLD_MS);
        return () => clearTimeout(timer);
    }, [commitSeq, dragging]);

    const shownPct = localPct ?? haPct;
    // 꺼진 조명을 끌면 그 밝기로 켜지므로, 드래그하는 동안은 켜진 것으로 보여준다
    const lit = on || localPct != null;

    const handlePointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
        ev.currentTarget.setPointerCapture(ev.pointerId);
        dragRef.current = {
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            startTime: ev.timeStamp,
            trackWidth: ev.currentTarget.getBoundingClientRect().width,
            originX: ev.clientX,
            originPct: haPct ?? 0,
            moved: false,
            pct: haPct ?? 0,
        };
        setPressed(true);
    };

    const handlePointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== ev.pointerId) return;
        if (!d.moved) {
            if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
            // 임계값을 넘은 지점을 새 원점으로 잡는다 — 안 그러면 인식되는 순간 6px 만큼 튄다
            d.moved = true;
            d.originX = ev.clientX;
            setDragging(true);
        }
        d.pct = clampPct(d.originPct + ((ev.clientX - d.originX) / Math.max(1, d.trackWidth)) * 100);
        setLocalPct(d.pct);
    };

    const handlePointerUp = (ev: React.PointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        dragRef.current = null;
        setPressed(false);
        if (!d || d.pointerId !== ev.pointerId) return;
        if (d.moved) {
            setDragging(false);
            setCommitSeq(n => n + 1);
            onCommitBrightness(d.pct);
            return;
        }
        if (ev.timeStamp - d.startTime <= TAP_MAX_MS) {
            // 토글은 밝기와 무관하니 붙잡아 둔 낙관 값도 같이 놓아준다
            setLocalPct(null);
            onToggle();
        }
    };

    const handlePointerCancel = () => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setPressed(false);
        setDragging(false);
        setLocalPct(null);
    };

    const handleKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
            ev.preventDefault();
            const step = ev.key === 'ArrowRight' ? KEY_STEP_PCT : -KEY_STEP_PCT;
            setLocalPct(clampPct((localPct ?? haPct ?? 0) + step));
            return;
        }
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            setLocalPct(null);
            onToggle();
        }
    };

    const handleKeyUp = (ev: React.KeyboardEvent<HTMLDivElement>) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        if (localPct == null) return;
        setCommitSeq(n => n + 1);
        onCommitBrightness(localPct);
    };

    const face = (
        <>
            <Icon
                icon={lit ? 'mdi:lightbulb' : 'mdi:lightbulb-outline'}
                className="relative text-[17px] shrink-0"
                style={{ color: lit ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }}
            />
            <span className="relative min-w-0 flex-1">
                <span
                    className="block text-[12px] font-bold truncate"
                    style={{ color: lit ? '#c7d2fe' : 'rgba(255,255,255,0.55)' }}
                >
                    {light.name}
                </span>
                <span
                    className="block text-[10px] font-medium"
                    style={{ color: lit ? 'rgba(199,210,254,0.7)' : 'rgba(255,255,255,0.3)' }}
                >
                    {lit ? (shownPct != null ? `${shownPct}%` : '켜짐') : '꺼짐'}
                </span>
            </span>
        </>
    );

    // 밝기가 없는 조명은 예전 그대로 토글 버튼
    if (!supportsBrightness(state)) {
        return (
            <Pressable
                onClick={onToggle}
                pressScale={0.95}
                className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-left"
                style={{
                    background: on ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                    borderColor: on ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)',
                }}
            >
                {face}
            </Pressable>
        );
    }

    return (
        <motion.div
            role="slider"
            tabIndex={0}
            aria-label={`${light.name} 밝기`}
            // 0 = 꺼짐. 드래그·화살표로 만드는 값은 1 이상으로 클램프한다
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={shownPct ?? 0}
            aria-valuetext={lit ? `${shownPct ?? 0}%` : '꺼짐'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            // 누르는 즉시 반응하고, 드래그로 판정되면 눌림을 풀어 손가락에 자리를 내준다
            animate={{ scale: pressed && !dragging ? 0.97 : 1 }}
            transition={spring.snappy}
            className="relative overflow-hidden flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-left
                       touch-pan-y select-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50"
            style={{
                background: lit ? 'rgba(99,102,241,0.14)' : 'rgba(255,255,255,0.04)',
                borderColor: lit ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)',
            }}
        >
            {/*
              밝기 채움 — 카드 자체가 트랙이라는 걸 눈으로 보여준다.
              유리 위에 유리를 겹치지 않도록 블러 없는 평면 색만 깔고,
              드래그 중엔 스프링을 끄고 손가락과 1:1 로 붙인다.
            */}
            <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 w-full origin-left"
                style={{ background: 'rgba(99,102,241,0.30)' }}
                initial={false}
                animate={{ scaleX: lit ? (shownPct ?? 0) / 100 : 0 }}
                transition={dragging ? { duration: 0 } : spring.default}
            />
            {face}
        </motion.div>
    );
}

/** 값 + 단위 + 상태색을 한 덩어리로 보여주는 칩. */
function StatChip({ label, value, unit, tone, trend }: {
    label: string;
    value: string;
    unit?: string;
    tone: 'normal' | 'warn';
    trend?: 'up' | 'down' | null;
}) {
    const warn = tone === 'warn';
    return (
        <div
            className="rounded-2xl px-3 py-2.5 border"
            style={{
                background: warn ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.05)',
                borderColor: warn ? 'rgba(245,158,11,0.28)' : 'rgba(255,255,255,0.08)',
            }}
        >
            <div
                className="text-[10px] font-bold tracking-wide mb-0.5"
                style={{ color: warn ? '#fcd34d' : 'rgba(255,255,255,0.45)' }}
            >
                {label}
            </div>
            <div
                className="text-[19px] font-bold leading-none flex items-baseline gap-0.5 text-display"
                style={{ color: warn ? '#fbbf24' : 'rgba(255,255,255,0.92)' }}
            >
                {value}
                {unit && <span className="text-[11px] font-medium opacity-60">{unit}</span>}
                {trend && (
                    <Icon
                        icon={trend === 'up' ? 'mdi:arrow-up' : 'mdi:arrow-down'}
                        className="text-[13px] ml-0.5"
                    />
                )}
            </div>
        </div>
    );
}

export default function RoomPanel({
    config,
    currentSubject,
    subjects,
    onSaveSubjectPreset,
    focusOpen,
    onToggleFocus,
    onAvailabilityChange,
}: RoomPanelProps) {
    const { connection, states, actions, lastError } = useHomeAssistant(config);

    const [kelvin, setKelvin] = useState(5000);
    const [kelvinTouched, setKelvinTouched] = useState(false);
    const [co2Prev, setCo2Prev] = useState<number | null>(null);
    const [co2Trend, setCo2Trend] = useState<'up' | 'down' | null>(null);

    const e = config?.entities;
    const tempS = pick(states, e?.temperature);
    const humS = pick(states, e?.humidity);
    const co2S = pick(states, e?.co2);
    const luxS = pick(states, e?.illuminance);
    const deskS = pick(states, e?.deskHeight);
    const climateS = pick(states, e?.climate);

    const temp = num(tempS);
    const hum = num(humS);
    const co2 = num(co2S);
    const lux = num(luxS);
    const deskHeight = num(deskS);

    // CO2 는 절대값보다 "지금 오르는 중인지" 가 행동을 유도한다.
    // 값이 바뀐 렌더에서만 조정하는 React 공식 패턴 — 잡음으로 화살표가 떨리지
    // 않게 15ppm 이상 움직였을 때만 방향을 갱신한다.
    if (co2 != null && co2 !== co2Prev) {
        setCo2Prev(co2);
        if (co2Prev != null && Math.abs(co2 - co2Prev) >= 15) {
            setCo2Trend(co2 > co2Prev ? 'up' : 'down');
        }
    }

    // 상대습도만으로는 끈적한지 알 수 없다 — 이슬점으로 판정해 습도 칩에 색만 얹는다
    const humidWarn = useMemo(() => {
        if (temp == null || hum == null) return false;
        const dp = dewPoint(temp, hum);
        return dp != null && dp >= (config?.dewPointWarn ?? 18);
    }, [temp, hum, config?.dewPointWarn]);

    const co2Warn = co2 != null && co2 >= (config?.co2Warn ?? 1000);

    const tempTargets = useMemo(
        () => (e?.lights ?? []).filter(l => l.supportsColorTemp).map(l => l.entityId),
        [e?.lights],
    );

    /**
     * 프리셋 칩 목록.
     * 사용자가 과목에 직접 저장한 값이 항상 이기고, 비어 있는 항목만 기본 프리셋으로 채운다.
     * 어느 과목에도 물리지 않은 기본 프리셋(야간·휴식 등)은 뒤에 그대로 붙인다.
     */
    const presetChips = useMemo(() => {
        const chips: Array<{ name: string; preset: LightPresetValue }> = [];
        const usedDefaults = new Set<string>();
        for (const s of subjects) {
            const def = findDefaultPreset(s.name);
            const colorTempK = s.lightPreset?.colorTempK ?? def?.colorTempK;
            if (colorTempK == null) continue;
            if (def) usedDefaults.add(def.subject);
            chips.push({
                name: s.name,
                preset: { colorTempK, brightnessPct: s.lightPreset?.brightnessPct ?? def?.brightnessPct },
            });
        }
        for (const def of DEFAULT_SUBJECT_LIGHT_PRESETS) {
            if (usedDefaults.has(def.subject)) continue;
            chips.push({
                name: def.subject,
                preset: { colorTempK: def.colorTempK, brightnessPct: def.brightnessPct },
            });
        }
        return chips;
    }, [subjects]);

    const commitKelvin = useCallback(() => {
        if (!kelvinTouched) return;
        void actions.applyColorTemp(kelvin, tempTargets);
    }, [actions, kelvin, kelvinTouched, tempTargets]);

    const available = connection === 'home';
    useEffect(() => {
        onAvailabilityChange?.(available);
    }, [available, onAvailabilityChange]);

    // 집이 아니면 존재 자체를 만들지 않는다
    if (!available) return null;

    const climateTarget = climateS?.attributes.temperature as number | undefined;
    const climateMode = climateS?.state ?? 'off';
    const climateOn = climateMode !== 'off' && climateMode !== 'unavailable';

    // 바람 세기 목록은 엔티티가 알려주는 것만 쓴다 — 기기마다 문자열이 다르므로 하드코딩하지 않는다
    const rawFanModes = climateS?.attributes.fan_modes;
    const fanModes = Array.isArray(rawFanModes)
        ? rawFanModes.filter((m): m is string => typeof m === 'string')
        : [];
    const fanMode = climateS?.attributes.fan_mode as string | undefined;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.default}
            className="mt-6 w-full max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/[0.06] p-5"
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon icon="mdi:home-outline" className="text-[17px] opacity-50" />
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">내 방</span>
                </div>
                {lastError && (
                    <span className="text-[10px] font-bold" style={{ color: '#fca5a5' }}>
                        {lastError}
                    </span>
                )}
            </div>

            {/* 상태 칩 */}
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))' }}>
                {temp != null && (
                    <StatChip label="온도" value={temp.toFixed(1)} unit="°C" tone="normal" />
                )}
                {hum != null && (
                    <StatChip label="습도" value={Math.round(hum).toString()} unit="%" tone={humidWarn ? 'warn' : 'normal'} />
                )}
                {co2 != null && (
                    <StatChip
                        label="이산화탄소"
                        value={Math.round(co2).toString()}
                        unit="ppm"
                        tone={co2Warn ? 'warn' : 'normal'}
                        trend={co2Trend}
                    />
                )}
                {lux != null && (
                    <StatChip label="조도" value={Math.round(lux).toString()} unit="lx" tone="normal" />
                )}
            </div>

            {/* 조명 — 카드 하나가 곧 밝기 슬라이더다 (탭=토글, 드래그=밝기) */}
            {!!e?.lights.length && (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(122px, 1fr))' }}>
                    {e.lights.map(light => (
                        <LightRow
                            key={light.entityId}
                            light={light}
                            state={states[light.entityId]}
                            onToggle={() => void actions.toggleLight(light.entityId)}
                            onCommitBrightness={pct => void actions.setLightBrightness(light.entityId, pct)}
                        />
                    ))}
                </div>
            )}

            {/* 책상 · 에어컨 */}
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))' }}>
                {e?.deskCover && (
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3">
                        <div className="flex items-baseline justify-between mb-2.5">
                            <span className="text-[10px] font-bold tracking-wide opacity-40">책상 높이</span>
                            <span className="text-[17px] font-bold text-display" style={{ color: 'rgba(255,255,255,0.92)' }}>
                                {deskHeight != null ? deskHeight.toFixed(1) : '—'}
                                <span className="text-[11px] font-medium opacity-50 ml-0.5">cm</span>
                            </span>
                        </div>
                        <div className="flex gap-1.5">
                            <Pressable
                                onClick={() => void actions.moveDesk(config?.desk.sit ?? 12)}
                                pressScale={0.95}
                                className="flex-1 py-2 rounded-xl text-[12px] font-bold border"
                                style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                            >
                                앉기
                            </Pressable>
                            <Pressable
                                onClick={() => void actions.moveDesk(config?.desk.stand ?? 68)}
                                pressScale={0.95}
                                className="flex-1 py-2 rounded-xl text-[12px] font-bold border"
                                style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                            >
                                서기
                            </Pressable>
                        </div>
                    </div>
                )}

                {e?.climate && (
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3">
                        <div className="flex items-baseline justify-between mb-2.5">
                            <span className="text-[10px] font-bold tracking-wide opacity-40">
                                에어컨 {climateOn ? `· ${climateMode}` : ''}
                            </span>
                            <span className="text-[17px] font-bold text-display" style={{ color: 'rgba(255,255,255,0.92)' }}>
                                {climateTarget != null ? climateTarget.toFixed(1) : '—'}
                                <span className="text-[11px] font-medium opacity-50 ml-0.5">°C</span>
                            </span>
                        </div>
                        <div className="flex gap-1.5">
                            <Pressable
                                onClick={() => climateTarget != null && void actions.setClimateTemperature(climateTarget - 0.5)}
                                pressScale={0.95}
                                aria-label="설정 온도 낮추기"
                                className="w-10 py-2 rounded-xl border flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                            >
                                <Icon icon="mdi:minus" className="text-[15px]" />
                            </Pressable>
                            <Pressable
                                onClick={() => climateTarget != null && void actions.setClimateTemperature(climateTarget + 0.5)}
                                pressScale={0.95}
                                aria-label="설정 온도 높이기"
                                className="w-10 py-2 rounded-xl border flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                            >
                                <Icon icon="mdi:plus" className="text-[15px]" />
                            </Pressable>
                            <Pressable
                                onClick={() => void actions.setClimateMode(climateOn ? 'off' : 'cool')}
                                pressScale={0.95}
                                className="flex-1 py-2 rounded-xl text-[12px] font-bold border"
                                style={{
                                    background: climateOn ? 'rgba(255,255,255,0.05)' : 'rgba(99,102,241,0.18)',
                                    borderColor: climateOn ? 'rgba(255,255,255,0.1)' : 'rgba(99,102,241,0.35)',
                                    color: climateOn ? 'rgba(255,255,255,0.7)' : '#c7d2fe',
                                }}
                            >
                                {climateOn ? '끄기' : '켜기'}
                            </Pressable>
                        </div>

                        {/* 바람 세기 — fan_modes 가 없는 기기면 이 줄 자체가 없다 */}
                        {!!fanModes.length && (
                            <div
                                className="flex gap-1 mt-2 p-1 rounded-xl border border-white/[0.06]"
                                style={{ background: 'rgba(255,255,255,0.03)' }}
                            >
                                {fanModes.map(m => {
                                    const active = m === fanMode;
                                    return (
                                        <Pressable
                                            key={m}
                                            onClick={() => void actions.setFanMode(m)}
                                            pressScale={0.95}
                                            aria-pressed={active}
                                            className="relative flex-1 min-w-0 py-1.5 rounded-lg text-[11px] font-bold truncate"
                                            style={{ color: active ? '#c7d2fe' : 'rgba(255,255,255,0.5)' }}
                                        >
                                            {/* 선택 표시는 칸 사이를 미끄러져 이동한다 — 어디서 어디로 갔는지 보이게 */}
                                            {active && (
                                                <motion.span
                                                    layoutId="ha-fan-mode-active"
                                                    className="absolute inset-0 rounded-lg border"
                                                    style={{
                                                        background: 'rgba(99,102,241,0.22)',
                                                        borderColor: 'rgba(99,102,241,0.38)',
                                                    }}
                                                    transition={spring.snappy}
                                                />
                                            )}
                                            <span className="relative">{fanModeLabel(m)}</span>
                                        </Pressable>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 색온도 */}
            {!!tempTargets.length && (
                <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-[10px] font-bold tracking-wide opacity-40">색온도</span>
                        <span className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>
                            {kelvin}K
                        </span>
                    </div>
                    <input
                        type="range"
                        min={KELVIN_MIN}
                        max={KELVIN_MAX}
                        step={100}
                        value={kelvin}
                        onChange={ev => { setKelvin(Number(ev.target.value)); setKelvinTouched(true); }}
                        onPointerUp={commitKelvin}
                        onKeyUp={commitKelvin}
                        aria-label="색온도"
                        className="w-full"
                    />
                    <div className="flex gap-1.5 flex-wrap mt-2">
                        {presetChips.map(chip => {
                            const active = chip.name === currentSubject;
                            return (
                                <Pressable
                                    key={chip.name}
                                    onClick={() => {
                                        setKelvin(chip.preset.colorTempK);
                                        void actions.applyLightPreset(chip.preset, tempTargets);
                                    }}
                                    pressScale={0.95}
                                    aria-label={`${chip.name} 조명 프리셋 적용`}
                                    className="px-3 py-1.5 rounded-xl text-[12px] font-bold border flex items-baseline gap-1"
                                    style={{
                                        background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.05)',
                                        borderColor: active ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.1)',
                                        color: active ? '#c7d2fe' : 'rgba(255,255,255,0.6)',
                                    }}
                                >
                                    {chip.name}
                                    <span className="text-[10px] font-medium opacity-60">
                                        {chip.preset.colorTempK}K
                                        {chip.preset.brightnessPct != null && `·${chip.preset.brightnessPct}%`}
                                    </span>
                                </Pressable>
                            );
                        })}
                        {!!currentSubject && (
                            <Pressable
                                onClick={() => onSaveSubjectPreset(currentSubject, kelvin)}
                                pressScale={0.95}
                                aria-label={`현재 색온도를 ${currentSubject} 프리셋으로 저장`}
                                className="px-3 py-1.5 rounded-xl text-[12px] font-bold border flex items-center gap-1"
                                style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
                            >
                                <Icon icon="mdi:plus" className="text-[13px]" />
                                {currentSubject}에 저장
                            </Pressable>
                        )}
                    </div>
                </div>
            )}

            {/* 집중력 모니터 — 기본은 접힌 한 줄 */}
            <button
                onClick={onToggleFocus}
                className="flex items-center justify-between pt-3 border-t border-white/[0.08] w-full"
                aria-expanded={focusOpen}
            >
                <span className="flex items-center gap-2">
                    <Icon icon="mdi:eye-outline" className="text-[16px] opacity-40" />
                    <span className="text-[12px] font-bold opacity-50">집중력 모니터</span>
                </span>
                <span className="flex items-center gap-1 text-[12px] font-bold opacity-40">
                    {focusOpen ? '접기' : '펼치기'}
                    <motion.span animate={{ rotate: focusOpen ? 180 : 0 }} transition={spring.snappy} className="flex">
                        <Icon icon="mdi:chevron-down" className="text-[15px]" />
                    </motion.span>
                </span>
            </button>
        </motion.div>
    );
}
