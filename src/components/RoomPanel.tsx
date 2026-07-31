/**
 * RoomPanel — 공부 중 화면에 붙는 "내 방" 상태·제어 패널.
 *
 * 원칙:
 *  - 집(로컬 HA 도달)이 아니면 아무것도 렌더하지 않는다. 숨김이 아니라 미마운트.
 *  - 지표는 4개로 고정. 문제가 있는 값만 색이 붙어서 시선을 끈다.
 *  - 슬라이더는 드래그 중 1:1 로 숫자만 움직이고, 손을 뗄 때 한 번만 HA 를 부른다.
 *    (드래그마다 서비스 호출하면 저사양 HA 호스트가 그대로 얻어맞는다)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@iconify/react';
import Pressable from './ui/Pressable';
import { spring } from '../lib/motion';
import { useHomeAssistant } from '../lib/ha/useHomeAssistant';
import { dewPoint, type HaConfig, type HaEntityState, type HaStateMap } from '../lib/ha/types';
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

function num(s: HaEntityState | undefined): number | null {
    if (!s) return null;
    const v = Number(s.state);
    return Number.isFinite(v) ? v : null;
}

function pick(states: HaStateMap, id: string | undefined): HaEntityState | undefined {
    return id ? states[id] : undefined;
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

    const presetSubjects = useMemo(
        () => subjects.filter(s => typeof s.lightPreset?.colorTempK === 'number'),
        [subjects],
    );

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

            {/* 조명 */}
            {!!e?.lights.length && (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(122px, 1fr))' }}>
                    {e.lights.map(light => {
                        const st = states[light.entityId];
                        const on = st?.state === 'on';
                        const brightness = st?.attributes.brightness as number | undefined;
                        const pct = on && typeof brightness === 'number'
                            ? Math.max(1, Math.round((brightness / 255) * 100))
                            : null;
                        return (
                            <Pressable
                                key={light.entityId}
                                onClick={() => void actions.toggleLight(light.entityId)}
                                pressScale={0.95}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-left"
                                style={{
                                    background: on ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
                                    borderColor: on ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)',
                                }}
                            >
                                <Icon
                                    icon={on ? 'mdi:lightbulb' : 'mdi:lightbulb-outline'}
                                    className="text-[17px] shrink-0"
                                    style={{ color: on ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }}
                                />
                                <span className="min-w-0 flex-1">
                                    <span
                                        className="block text-[12px] font-bold truncate"
                                        style={{ color: on ? '#c7d2fe' : 'rgba(255,255,255,0.55)' }}
                                    >
                                        {light.name}
                                    </span>
                                    <span
                                        className="block text-[10px] font-medium"
                                        style={{ color: on ? 'rgba(199,210,254,0.7)' : 'rgba(255,255,255,0.3)' }}
                                    >
                                        {on ? (pct != null ? `${pct}%` : '켜짐') : '꺼짐'}
                                    </span>
                                </span>
                            </Pressable>
                        );
                    })}
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
                        {presetSubjects.map(s => {
                            const k = s.lightPreset!.colorTempK!;
                            const active = s.name === currentSubject;
                            return (
                                <Pressable
                                    key={s.name}
                                    onClick={() => { setKelvin(k); void actions.applyColorTemp(k, tempTargets); }}
                                    pressScale={0.95}
                                    className="px-3 py-1.5 rounded-xl text-[12px] font-bold border"
                                    style={{
                                        background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.05)',
                                        borderColor: active ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.1)',
                                        color: active ? '#c7d2fe' : 'rgba(255,255,255,0.6)',
                                    }}
                                >
                                    {s.name} {k}K
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
