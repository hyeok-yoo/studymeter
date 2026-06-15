package com.studymeter.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * DeviceSound — 디바이스 벨소리(링거) 모드 조회 플러그인.
 *
 * 졸음 경고가 "소리 켜짐 → 소리 / 진동 → 진동 / 무음 → 출력 없음" 정책을 따르도록,
 * JS 쪽에서 현재 벨소리 모드를 읽기 위해 사용한다.
 *
 * 주의: 알림음/경고음 자체는 JS의 Web Audio(미디어 스트림)로 재생하므로 여기서는
 * 모드 조회만 제공한다. AudioManager.getRingerMode()는 권한이 필요 없다.
 */
@CapacitorPlugin(name = "DeviceSound")
public class DeviceSoundPlugin extends Plugin {

    @PluginMethod
    public void getRingerMode(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        String mode = "normal";
        if (am != null) {
            switch (am.getRingerMode()) {
                case AudioManager.RINGER_MODE_SILENT:
                    mode = "silent";
                    break;
                case AudioManager.RINGER_MODE_VIBRATE:
                    mode = "vibrate";
                    break;
                case AudioManager.RINGER_MODE_NORMAL:
                default:
                    mode = "normal";
                    break;
            }
        }
        JSObject ret = new JSObject();
        ret.put("mode", mode);
        call.resolve(ret);
    }
}
