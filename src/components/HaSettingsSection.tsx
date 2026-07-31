/**
 * HaSettingsSection — 설정 화면의 "홈 어시스턴트" 섹션.
 *
 * 엔티티 ID 는 사용자가 직접 고른다. 연결 테스트가 성공하면 HA 에서 엔티티
 * 목록을 받아와 드롭다운으로 채우므로, 코드에 방 구성이 박히지 않는다.
 */
import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@iconify/react';
import Pressable from './ui/Pressable';
import { spring, staggerItem } from '../lib/motion';
import { db, type Settings } from '../lib/db';
import { fetchEntityOptions, ping, HaAuthError } from '../lib/ha/client';
import { DEFAULT_HA_CONFIG, type HaConfig, type HaEntityOption } from '../lib/ha/types';

interface Props {
    settings: Settings;
    onSettingsChange: (s: Settings) => void;
}

type TestState =
    | { kind: 'idle' }
    | { kind: 'testing' }
    | { kind: 'ok'; count: number }
    | { kind: 'fail'; message: string };

const inputClass =
    'w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]';

/** 단일 엔티티 선택 드롭다운. */
function EntityPicker({ label, hint, value, options, onChange }: {
    label: string;
    hint?: string;
    value: string | undefined;
    options: HaEntityOption[];
    onChange: (v: string | undefined) => void;
}) {
    return (
        <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                {label}
                {hint && <span className="ml-1.5 text-xs opacity-50 font-normal">{hint}</span>}
            </label>
            <select
                value={value ?? ''}
                onChange={e => onChange(e.target.value || undefined)}
                className={inputClass}
            >
                <option value="">선택 안 함</option>
                {options.map(o => (
                    <option key={o.entityId} value={o.entityId}>
                        {o.name} — {o.entityId}
                    </option>
                ))}
            </select>
        </div>
    );
}

export default function HaSettingsSection({ settings, onSettingsChange }: Props) {
    const cfg = settings.haConfig ?? DEFAULT_HA_CONFIG;
    const [draft, setDraft] = useState<HaConfig>(cfg);
    const [test, setTest] = useState<TestState>({ kind: 'idle' });
    const [options, setOptions] = useState<HaEntityOption[]>([]);
    const [expanded, setExpanded] = useState(false);

    const persist = useCallback(async (next: HaConfig) => {
        setDraft(next);
        if (settings.id == null) return;
        await db.settings.update(settings.id, { haConfig: next });
        onSettingsChange({ ...settings, haConfig: next });
    }, [settings, onSettingsChange]);

    const patch = useCallback((partial: Partial<HaConfig>) => {
        void persist({ ...draft, ...partial });
    }, [draft, persist]);

    const byDomain = useMemo(() => {
        const group = (d: string) => options.filter(o => o.domain === d);
        return {
            lights: group('light'),
            sensors: group('sensor'),
            covers: group('cover'),
            climates: group('climate'),
        };
    }, [options]);

    const runTest = useCallback(async () => {
        setTest({ kind: 'testing' });
        try {
            const reachable = await ping(draft.localUrl, draft.token);
            if (!reachable) {
                setTest({ kind: 'fail', message: '로컬 주소로 연결하지 못했습니다. 집 Wi-Fi인지, 주소와 포트가 맞는지 확인해 주세요.' });
                return;
            }
            const list = await fetchEntityOptions(draft.localUrl, draft.token);
            setOptions(list);
            setExpanded(true);
            setTest({ kind: 'ok', count: list.length });
        } catch (e) {
            setTest({
                kind: 'fail',
                message: e instanceof HaAuthError
                    ? '토큰이 거부되었습니다. HA 프로필에서 장기 액세스 토큰을 다시 발급해 주세요.'
                    : e instanceof Error ? e.message : '연결에 실패했습니다',
            });
        }
    }, [draft.localUrl, draft.token]);

    const toggleLight = useCallback((opt: HaEntityOption) => {
        const exists = draft.entities.lights.some(l => l.entityId === opt.entityId);
        const lights = exists
            ? draft.entities.lights.filter(l => l.entityId !== opt.entityId)
            : [...draft.entities.lights, {
                entityId: opt.entityId,
                name: opt.name,
                supportsColorTemp: opt.supportsColorTemp,
            }];
        patch({ entities: { ...draft.entities, lights } });
    }, [draft.entities, patch]);

    return (
        <motion.div variants={staggerItem}>
            <p className="px-1.5 mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] opacity-60">
                홈 어시스턴트
            </p>

            <div className="glass-card p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text)]">방 상태·제어 연동</p>
                        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
                            켜면 공부 중 화면에 방 상태와 조명·책상·에어컨 제어가 나타납니다.
                            집 Wi-Fi에서 로컬 주소로 연결될 때만 표시됩니다.
                        </p>
                    </div>
                    <motion.button
                        onClick={() => patch({ enabled: !draft.enabled })}
                        whileTap={{ scale: 0.92 }}
                        transition={spring.snappy}
                        aria-label="홈 어시스턴트 연동 사용"
                        className="relative flex-shrink-0 w-12 h-7 rounded-full transition-colors duration-300"
                        style={{ background: draft.enabled ? 'var(--color-primary)' : 'rgba(120,120,128,0.24)' }}
                    >
                        <motion.div
                            className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-md"
                            animate={{ x: draft.enabled ? 20 : 0 }}
                            transition={spring.snappy}
                        />
                    </motion.button>
                </div>

                {draft.enabled && (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                                로컬 주소
                                <span className="ml-1.5 text-xs opacity-50 font-normal">집 판정에 쓰입니다</span>
                            </label>
                            <input
                                type="url"
                                inputMode="url"
                                value={draft.localUrl}
                                onChange={e => setDraft({ ...draft, localUrl: e.target.value })}
                                onBlur={() => patch({ localUrl: draft.localUrl })}
                                placeholder="http://192.168.0.10:8123"
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                                원격 주소
                                <span className="ml-1.5 text-xs opacity-50 font-normal">선택 · 집 밖에서도 제어는 안 됩니다</span>
                            </label>
                            <input
                                type="url"
                                inputMode="url"
                                value={draft.remoteUrl ?? ''}
                                onChange={e => setDraft({ ...draft, remoteUrl: e.target.value })}
                                onBlur={() => patch({ remoteUrl: draft.remoteUrl })}
                                placeholder="https://ha.example.com"
                                className={inputClass}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                                장기 액세스 토큰
                            </label>
                            <input
                                type="password"
                                autoComplete="off"
                                value={draft.token}
                                onChange={e => setDraft({ ...draft, token: e.target.value })}
                                onBlur={() => patch({ token: draft.token })}
                                placeholder="HA 프로필 맨 아래에서 발급"
                                className={inputClass}
                            />
                            <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 opacity-70">
                                토큰은 이 기기에만 저장되고 서버로 전송되지 않습니다.
                            </p>
                        </div>

                        <Pressable
                            onClick={runTest}
                            disabled={test.kind === 'testing' || !draft.localUrl || !draft.token}
                            pressScale={0.97}
                            className="w-full py-3 rounded-xl font-bold text-white disabled:opacity-40"
                            style={{ background: 'var(--color-primary)' }}
                        >
                            {test.kind === 'testing' ? '연결 확인 중…' : '연결 테스트'}
                        </Pressable>

                        {test.kind === 'ok' && (
                            <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: '#22c55e' }}>
                                <Icon icon="mdi:check-circle-outline" className="text-sm" />
                                연결됨 · 엔티티 {test.count}개를 불러왔습니다
                            </p>
                        )}
                        {test.kind === 'fail' && (
                            <p className="text-xs font-medium leading-relaxed" style={{ color: '#ef4444' }}>
                                {test.message}
                            </p>
                        )}

                        {expanded && !!options.length && (
                            <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
                                <div>
                                    <p className="text-sm font-medium text-[var(--color-text)] mb-2">
                                        조명
                                        <span className="ml-1.5 text-xs opacity-50 font-normal">
                                            {draft.entities.lights.length}개 선택됨
                                        </span>
                                    </p>
                                    <div className="glass-card-elevated p-2 max-h-56 overflow-y-auto space-y-1">
                                        {byDomain.lights.map(o => {
                                            const checked = draft.entities.lights.some(l => l.entityId === o.entityId);
                                            return (
                                                <label
                                                    key={o.entityId}
                                                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer"
                                                    style={{ background: checked ? 'rgba(99,102,241,0.12)' : 'transparent' }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleLight(o)}
                                                        className="shrink-0"
                                                    />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-sm text-[var(--color-text)] truncate">{o.name}</span>
                                                        <span className="block text-[11px] text-[var(--color-text-secondary)] truncate">
                                                            {o.entityId}{o.supportsColorTemp ? ' · 색온도 지원' : ''}
                                                        </span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                <EntityPicker
                                    label="온도 센서"
                                    value={draft.entities.temperature}
                                    options={byDomain.sensors}
                                    onChange={v => patch({ entities: { ...draft.entities, temperature: v } })}
                                />
                                <EntityPicker
                                    label="습도 센서"
                                    value={draft.entities.humidity}
                                    options={byDomain.sensors}
                                    onChange={v => patch({ entities: { ...draft.entities, humidity: v } })}
                                />
                                <EntityPicker
                                    label="이산화탄소 센서"
                                    value={draft.entities.co2}
                                    options={byDomain.sensors}
                                    onChange={v => patch({ entities: { ...draft.entities, co2: v } })}
                                />
                                <EntityPicker
                                    label="조도 센서"
                                    value={draft.entities.illuminance}
                                    options={byDomain.sensors}
                                    onChange={v => patch({ entities: { ...draft.entities, illuminance: v } })}
                                />
                                <EntityPicker
                                    label="책상 높이 센서"
                                    hint="표시 전용"
                                    value={draft.entities.deskHeight}
                                    options={byDomain.sensors}
                                    onChange={v => patch({ entities: { ...draft.entities, deskHeight: v } })}
                                />
                                <EntityPicker
                                    label="책상 제어"
                                    hint="cover"
                                    value={draft.entities.deskCover}
                                    options={byDomain.covers}
                                    onChange={v => patch({ entities: { ...draft.entities, deskCover: v } })}
                                />
                                <EntityPicker
                                    label="에어컨"
                                    value={draft.entities.climate}
                                    options={byDomain.climates}
                                    onChange={v => patch({ entities: { ...draft.entities, climate: v } })}
                                />

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">앉기 위치 %</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={draft.desk.sit}
                                            onChange={e => setDraft({ ...draft, desk: { ...draft.desk, sit: Number(e.target.value) } })}
                                            onBlur={() => patch({ desk: draft.desk })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">서기 위치 %</label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={draft.desk.stand}
                                            onChange={e => setDraft({ ...draft, desk: { ...draft.desk, stand: Number(e.target.value) } })}
                                            onBlur={() => patch({ desk: draft.desk })}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                                            CO₂ 경고 ppm
                                        </label>
                                        <input
                                            type="number"
                                            min={400}
                                            max={5000}
                                            step={50}
                                            value={draft.co2Warn}
                                            onChange={e => setDraft({ ...draft, co2Warn: Number(e.target.value) })}
                                            onBlur={() => patch({ co2Warn: draft.co2Warn })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                                            이슬점 경고 °C
                                        </label>
                                        <input
                                            type="number"
                                            min={5}
                                            max={30}
                                            value={draft.dewPointWarn}
                                            onChange={e => setDraft({ ...draft, dewPointWarn: Number(e.target.value) })}
                                            onBlur={() => patch({ dewPointWarn: draft.dewPointWarn })}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-[var(--color-text-secondary)] opacity-70 leading-relaxed">
                                    이슬점은 따로 표시하지 않고 습도 칩의 색 판정에만 씁니다.
                                    상대습도만으로는 실제로 끈적한지 알 수 없기 때문입니다.
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </motion.div>
    );
}
