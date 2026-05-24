import { useEffect, useRef, useState, useCallback } from 'react';

interface TabletCameraProps {
    sendVideoFrame: (dataUrl: string) => void;
    connected: boolean;
    fps?: number;
    autoStart?: boolean;
}

export function TabletCamera({ sendVideoFrame, connected, fps = 10, autoStart = false }: TabletCameraProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const intervalRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [enabled, setEnabled] = useState(autoStart);
    const [cameraReady, setCameraReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const stopCamera = useCallback(() => {
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setCameraReady(false);
    }, []);

    const captureAndSend = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2 || !connected) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, 640, 480);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        sendVideoFrame(dataUrl);
    }, [sendVideoFrame, connected]);

    useEffect(() => {
        if (!enabled) {
            stopCamera();
            setError(null);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480, facingMode: 'user' },
                });
                if (cancelled) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }
                setCameraReady(true);
                intervalRef.current = window.setInterval(captureAndSend, 1000 / fps);
            } catch (e) {
                if (!cancelled) setError('카메라 접근 실패. 권한을 확인하세요.');
            }
        })();

        return () => {
            cancelled = true;
            stopCamera();
        };
    }, [enabled, fps, stopCamera, captureAndSend]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.4 }}>
                    태블릿 카메라
                </span>
                <button
                    onClick={() => setEnabled(v => !v)}
                    style={{
                        padding: '4px 12px',
                        borderRadius: '999px',
                        border: 'none',
                        background: enabled ? '#22c55e33' : 'rgba(255,255,255,0.08)',
                        color: enabled ? '#22c55e' : 'rgba(255,255,255,0.5)',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        outline: 'none',
                    }}
                >
                    {enabled ? '켜짐' : '꺼짐'}
                </button>
            </div>

            {enabled && (
                <div style={{ position: 'relative', width: '100%', maxWidth: '200px', margin: '0 auto' }}>
                    <video
                        ref={videoRef}
                        muted
                        playsInline
                        style={{
                            width: '100%',
                            borderRadius: '12px',
                            background: '#000',
                            display: cameraReady ? 'block' : 'none',
                        }}
                    />
                    {!cameraReady && !error && (
                        <div style={{
                            width: '100%', paddingBottom: '75%', borderRadius: '12px',
                            background: 'rgba(255,255,255,0.05)',
                            position: 'relative',
                        }}>
                            <span style={{
                                position: 'absolute', inset: 0, display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                fontSize: '11px', color: 'rgba(255,255,255,0.3)',
                            }}>
                                카메라 시작 중...
                            </span>
                        </div>
                    )}
                    {error && (
                        <div style={{
                            padding: '8px', borderRadius: '8px',
                            background: 'rgba(239,68,68,0.1)',
                            color: '#ef4444', fontSize: '11px', textAlign: 'center',
                        }}>
                            {error}
                        </div>
                    )}
                    {cameraReady && !connected && (
                        <div style={{
                            position: 'absolute', top: '6px', right: '6px',
                            padding: '2px 8px', borderRadius: '999px',
                            background: 'rgba(0,0,0,0.6)', color: '#f59e0b',
                            fontSize: '9px', fontWeight: 700,
                        }}>
                            PC 미연결
                        </div>
                    )}
                    {cameraReady && connected && (
                        <div style={{
                            position: 'absolute', top: '6px', right: '6px',
                            padding: '2px 8px', borderRadius: '999px',
                            background: 'rgba(0,0,0,0.6)', color: '#22c55e',
                            fontSize: '9px', fontWeight: 700,
                        }}>
                            송신 중 {fps}fps
                        </div>
                    )}
                </div>
            )}
            <canvas ref={canvasRef} width={640} height={480} style={{ display: 'none' }} />
        </div>
    );
}
