import React, {useCallback, useEffect, useRef, useState} from 'react';
import Tts from 'react-native-tts';

import {

  ActivityIndicator,

  Alert,

  Image,

  RefreshControl,

  ScrollView,

  StatusBar,

  StyleSheet,

  Switch,

  Text,

  TouchableOpacity,

  View,

} from 'react-native';

import {

  detectObjectsFromJpeg,

  loadDrishtiModel,

  type DrishtiDetection,

} from '../services/AIModelService';

const BASE_URL = 'http://192.168.4.1';

const FRAME_URL = `${BASE_URL}/api/v1/frame`;

const VIDEO_URL = `${BASE_URL}/api/v1/video`;

const COLORS = {

  background: '#F5F7FB',

  white: '#FFFFFF',

  primary: '#2563EB',

  primaryLight: '#EFF6FF',

  text: '#172033',

  secondary: '#64748B',

  border: '#E8EDF4',

  green: '#16A34A',

  greenLight: '#DCFCE7',

  red: '#DC2626',

  redLight: '#FEE2E2',

  orange: '#EA580C',

};

type DeviceStatus = {

  device?: string;

  firmware_version?: string;

  wifi?: {

    ap_active?: boolean;

    connected_clients?: number;

  };

  camera?: {

    initialized?: boolean;

    ready?: boolean;

    stream_active?: boolean;

  };

  battery?: {

    available?: boolean;

    voltage_mv?: number | null;

    percentage?: number | null;

  };

  vibration?: {

    available?: boolean;

    enabled?: boolean;

    active?: boolean;

    left_available?: boolean;

    right_available?: boolean;

    left_active?: boolean;

    right_active?: boolean;

  };

  uptime_ms?: number;

};

type BatteryData = {

  available?: boolean;

  battery_present?: boolean;

  voltage_mv?: number | null;

  percentage?: number | null;

  charging?: boolean;

  charge_state?: string;

  current_ma?: number | null;

  capacity_mah?: number | null;

  estimated_remaining_minutes?: number | null;

};

type VideoState = 'not-tested' | 'working' | 'failed';

async function readJson(response: Response, endpoint: string) {

  let json: any = {};

  try {

    json = await response.json();

  } catch {

    throw new Error(`${endpoint}: response was not valid JSON`);

  }

  if (!response.ok || json?.success === false) {

    throw new Error(

      json?.error?.message ||

        json?.message ||

        `${endpoint} returned HTTP ${response.status}`,

    );

  }

  return json?.data ?? json;

}

async function getJson<T>(endpoint: string): Promise<T> {

  const response = await fetch(`${BASE_URL}${endpoint}`);

  return (await readJson(response, endpoint)) as T;

}

async function postJson<T = unknown>(

  endpoint: string,

  body: Record<string, unknown>,

): Promise<T> {

  const response = await fetch(`${BASE_URL}${endpoint}`, {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Accept: 'application/json',

    },

    body: JSON.stringify(body),

  });

  return (await readJson(response, endpoint)) as T;

}

function getDetectionPosition(detection: DrishtiDetection) {

  const centerX = (detection.box.left + detection.box.right) / 2;

  if (centerX < 0.33) {

    return 'LEFT';

  }

  if (centerX > 0.66) {

    return 'RIGHT';

  }

  return 'CENTER';

}

export default function HomeScreen() {

  const [status, setStatus] = useState<DeviceStatus | null>(null);

  const [battery, setBattery] = useState<BatteryData | null>(null);

  const [connected, setConnected] = useState(false);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState('');

  const [lastUpdated, setLastUpdated] = useState('--');

  const [sessionActive, setSessionActive] = useState(false);

  const [vibrationEnabled, setVibrationEnabled] = useState(false);

  const [vibrationBusy, setVibrationBusy] = useState(false);

  const [cameraBusy, setCameraBusy] = useState(false);

  const [frameUri, setFrameUri] = useState<string | null>(null);

  const [frameUpdated, setFrameUpdated] = useState('Not captured');

  const [videoBusy, setVideoBusy] = useState(false);

  const [videoState, setVideoState] =

    useState<VideoState>('not-tested');

  const [videoMessage, setVideoMessage] = useState(

    'MJPEG stream has not been tested.',

  );

  // AI state

  const [aiLoading, setAiLoading] = useState(false);

  const [aiReady, setAiReady] = useState(false);

  const [aiError, setAiError] = useState('');

  const [detections, setDetections] = useState<DrishtiDetection[]>([]);

  const [inferenceTime, setInferenceTime] = useState<number | null>(null);

  const [preprocessTime, setPreprocessTime] = useState<number | null>(null);
  const [lastAlert, setLastAlert] = useState('No alert yet');
  const [ttsReady, setTtsReady] = useState(false);

  const lastAlertRef = useRef('');
  const lastAlertTimeRef = useRef(0);
  const lastMotorTimeRef = useRef(0);
  const alertBusyRef = useRef(false);
  const sessionActiveRef = useRef(false);

  const refreshInProgress = useRef(false);

  const frameRequestInProgress = useRef(false);

  const aiBusy = useRef(false);

  // ==========================================

  useEffect(() => {
    let mounted = true;

    Tts.getInitStatus()
      .then(() => {
        if (!mounted) return;
        Tts.setDefaultLanguage('en-IN');
        Tts.setDefaultRate(0.48);
        Tts.setDefaultPitch(1.0);
        setTtsReady(true);
        console.log('[DRISHTI TTS] Phone speech engine ready');
      })
      .catch((ttsError: unknown) => {
        console.error('[DRISHTI TTS] Initialization failed:', ttsError);
        if (mounted) setAiError('Phone speech engine could not initialize.');
      });

    return () => {
      mounted = false;
      Tts.stop();
    };
  }, []);

  // DEVICE STATUS API

  // ==========================================

  const fetchStatus = useCallback(async () => {

    const data = await getJson<DeviceStatus>('/api/v1/status');

    setStatus(data);

    setConnected(true);

    if (typeof data.vibration?.enabled === 'boolean') {

      setVibrationEnabled(data.vibration.enabled);

    }

    return data;

  }, []);

  // ==========================================

  // BATTERY API

  // ==========================================

  const fetchBattery = useCallback(async () => {

    const data = await getJson<BatteryData>('/api/v1/battery');

    setBattery(data);

    return data;

  }, []);

  // ==========================================

  // REFRESH DEVICE DATA

  // ==========================================

  const refreshAll = useCallback(async () => {

    if (refreshInProgress.current) {

      return;

    }

    refreshInProgress.current = true;

    setRefreshing(true);

    try {

      const results = await Promise.allSettled([

        fetchStatus(),

        fetchBattery(),

      ]);

      const statusResult = results[0];

      if (statusResult.status === 'rejected') {

        setConnected(false);

        setError(

          statusResult.reason instanceof Error

            ? statusResult.reason.message

            : 'Cannot connect to Drishti. Check the ESP32 Wi-Fi.',

        );

      } else {

        setConnected(true);

        setError('');

        setLastUpdated(new Date().toLocaleTimeString());

      }

    } finally {

      refreshInProgress.current = false;

      setRefreshing(false);

      setLoading(false);

    }

  }, [fetchStatus, fetchBattery]);

  // ==========================================

  // AUTO REFRESH

  // ==========================================

  useEffect(() => {

    refreshAll();

    const timer = setInterval(refreshAll, 5000);

    return () => clearInterval(timer);

  }, [refreshAll]);

  // ==========================================

  const processDetectionAlerts = useCallback(
    async (items: DrishtiDetection[]) => {
      if (!sessionActiveRef.current || items.length === 0) return;
      if (alertBusyRef.current) return;

      const strongest = items.reduce((best, item) =>
        item.confidence > best.confidence ? item : best,
      );
      const position = getDetectionPosition(strongest);
      const now = Date.now();
      const cooldownMs = lastAlertRef.current === position ? 3000 : 1500;

      if (now - lastAlertTimeRef.current < cooldownMs) return;

      alertBusyRef.current = true;
      lastAlertRef.current = position;
      lastAlertTimeRef.current = now;

      const message =
        position === 'LEFT'
          ? 'Object detected on your left'
          : position === 'RIGHT'
            ? 'Object detected on your right'
            : 'Object detected ahead';

      setLastAlert(message);

      try {
        if (ttsReady) {
          Tts.stop();
          Tts.speak(message);
        }

        if (
          sessionActiveRef.current &&
          connected &&
          vibrationEnabled &&
          status?.vibration?.available &&
          now - lastMotorTimeRef.current >= 1200
        ) {
          lastMotorTimeRef.current = now;
          const left = position === 'LEFT' || position === 'CENTER';
          const right = position === 'RIGHT' || position === 'CENTER';

          await postJson('/api/v1/vibration/directional', {
            left,
            right,
            duration_ms: 350,
          });
        }
      } catch (alertError) {
        console.warn('[DRISHTI ALERT] Alert failed:', alertError);
      } finally {
        alertBusyRef.current = false;
      }
    },
    [ttsReady, connected, vibrationEnabled, status],
  );

  const testPhoneSpeaker = () => {
    if (!ttsReady) {
      Alert.alert('Speaker Not Ready', 'The phone speech engine is not initialized.');
      return;
    }
    Tts.stop();
    Tts.speak('Drishti phone speaker is working correctly.');
  };

  // CAMERA FRAME + AI INFERENCE

  // ==========================================

  const captureFrame = useCallback(async () => {

    if (frameRequestInProgress.current) {

      return;

    }

    frameRequestInProgress.current = true;

    setCameraBusy(true);

    try {

      const response = await fetch(`${FRAME_URL}?t=${Date.now()}`);

      if (!response.ok) {

        throw new Error(`Camera returned HTTP ${response.status}`);

      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.toLowerCase().includes('image/jpeg')) {

        throw new Error(

          `Expected image/jpeg but received ${

            contentType || 'unknown content type'

          }`,

        );

      }

      // Update camera preview.

      setFrameUri(`${FRAME_URL}?t=${Date.now()}`);

      setFrameUpdated(new Date().toLocaleTimeString());

      // Run AI only after model is loaded.
      if (aiReady && !aiBusy.current) {
        aiBusy.current = true;

        try {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const result = await detectObjectsFromJpeg(bytes);

          setPreprocessTime(result.preprocessMs);
          setInferenceTime(result.inferenceMs);
          setDetections(result.detections);
          setAiError('');

          console.log('[DRISHTI AI] Performance:', {
            preprocessingMs: result.preprocessMs,
            inferenceMs: result.inferenceMs,
            totalMs: result.totalMs,
          });
          console.log('[DRISHTI AI] Detections:', JSON.stringify(result.detections));

          await processDetectionAlerts(result.detections);
        } catch (aiErr) {
          const message =
            aiErr instanceof Error ? aiErr.message : 'AI inference failed';
          setAiError(message);
          console.error('[DRISHTI AI] Inference failed:', aiErr);
        } finally {
          aiBusy.current = false;
        }
      }
    } catch (captureErr) {

      const message =

        captureErr instanceof Error

          ? captureErr.message

          : 'Unable to capture camera frame.';

      setError(message);

      console.error('[DRISHTI CAMERA]', captureErr);

    } finally {

      frameRequestInProgress.current = false;

      setCameraBusy(false);

    }

  }, [aiReady, processDetectionAlerts]);

  // ==========================================

  // ACTIVE SESSION FRAME MONITORING

  // ==========================================

  useEffect(() => {

    if (!sessionActive) {

      return;

    }

    captureFrame();

    const timer = setInterval(captureFrame, 1500);

    return () => clearInterval(timer);

  }, [sessionActive, captureFrame]);

  // ==========================================

  // START AI SESSION

  // ==========================================

  const startSession = async () => {

    setAiLoading(true);

    setAiError('');

    try {

      await fetchStatus();

      await loadDrishtiModel();

      setAiReady(true);

      setDetections([]);

      setInferenceTime(null);

      sessionActiveRef.current = true;
      setSessionActive(true);

      Alert.alert(

        'Drishti AI Started',

        'The model loaded. Camera inference will begin now. This is a prototype and must not replace a white cane or guide dog.',

      );

    } catch (startErr) {

      const message =

        startErr instanceof Error

          ? startErr.message

          : 'Unable to start Drishti AI.';

      setAiError(message);

      Alert.alert('AI Startup Failed', message);

    } finally {

      setAiLoading(false);

    }

  };

  // ==========================================

  // STOP SESSION

  // ==========================================

  const stopSession = async () => {

    sessionActiveRef.current = false;
    setSessionActive(false);
    Tts.stop();
    alertBusyRef.current = false;
    lastAlertRef.current = '';
    lastAlertTimeRef.current = 0;
    lastMotorTimeRef.current = 0;

    try {

      if (connected && vibrationEnabled) {

        await postJson('/api/v1/vibration/directional', {

          left: false,

          right: false,

          duration_ms: 0,

        });

        await fetchStatus();

      }

    } catch (stopErr) {

      console.warn(

        '[DRISHTI] Could not send motor stop command:',

        stopErr,

      );

    }

  };

  // ==========================================

  // MASTER VIBRATION CONTROL

  // ==========================================

  const changeVibration = async (enabled: boolean) => {

    setVibrationBusy(true);

    try {

      await postJson('/api/v1/vibration', {enabled});

      setVibrationEnabled(enabled);

      await fetchStatus();

    } catch (vibrationErr) {

      Alert.alert(

        'Vibration Error',

        vibrationErr instanceof Error

          ? vibrationErr.message

          : 'Unable to change vibration.',

      );

    } finally {

      setVibrationBusy(false);

    }

  };

  // ==========================================

  // DIRECTIONAL VIBRATION

  // ==========================================

  const sendDirectionalVibration = async (

    left: boolean,

    right: boolean,

  ) => {

    if (!connected) {

      Alert.alert(

        'Device Offline',

        'Connect to Drishti Wi-Fi first.',

      );

      return;

    }

    if (!status?.vibration?.available) {

      Alert.alert(

        'Unavailable',

        'Vibration hardware is unavailable.',

      );

      return;

    }

    if (!vibrationEnabled) {

      Alert.alert(

        'Vibration Disabled',

        'Enable master vibration before sending directional commands.',

      );

      return;

    }

    setVibrationBusy(true);

    try {

      await postJson('/api/v1/vibration/directional', {

        left,

        right,

        duration_ms: left || right ? 500 : 0,

      });

      await fetchStatus();

    } catch (vibrationErr) {

      Alert.alert(

        'Directional Vibration Error',

        vibrationErr instanceof Error

          ? vibrationErr.message

          : 'Command failed.',

      );

    } finally {

      setVibrationBusy(false);

    }

  };

  // ==========================================

  // BOTH MOTOR VIBRATION TEST

  // ==========================================

  const runVibrationTest = async () => {

    if (!vibrationEnabled) {

      Alert.alert(

        'Vibration Disabled',

        'Enable master vibration first.',

      );

      return;

    }

    setVibrationBusy(true);

    try {

      await postJson('/api/v1/vibration/test', {

        duration_ms: 500,

      });

      await fetchStatus();

      Alert.alert(

        'Vibration Test',

        'Firmware accepted the 500 ms test.',

      );

    } catch (vibrationErr) {

      Alert.alert(

        'Vibration Error',

        vibrationErr instanceof Error

          ? vibrationErr.message

          : 'Vibration test failed.',

      );

    } finally {

      setVibrationBusy(false);

    }

  };

  // ==========================================

  // MJPEG STREAM TEST

  // ==========================================

  const testVideoStream = async () => {

    setVideoBusy(true);

    setVideoState('not-tested');

    setVideoMessage('Connecting to MJPEG stream...');

    const controller = new AbortController();

    const timeout = setTimeout(() => {

      controller.abort();

    }, 10000);

    try {

      const response = await fetch(VIDEO_URL, {

        headers: {

          Accept: 'multipart/x-mixed-replace',

        },

        signal: controller.signal,

      });

      if (!response.ok) {

        throw new Error(

          `Video API returned HTTP ${response.status}`,

        );

      }

      const contentType = (

        response.headers.get('content-type') || ''

      ).toLowerCase();

      if (!contentType.includes('multipart/x-mixed-replace')) {

        throw new Error(

          `Unexpected video content type: ${

            contentType || 'missing'

          }`,

        );

      }

      setVideoState('working');

      setVideoMessage(

        'The endpoint returned the expected MJPEG content type. This does not prove that frames are playing.',

      );

    } catch (videoErr) {

      setVideoState('failed');

      setVideoMessage(

        videoErr instanceof Error

          ? videoErr.message

          : 'Unable to connect to the video stream.',

      );

    } finally {

      clearTimeout(timeout);

      controller.abort();

      setVideoBusy(false);

    }

  };

  // ==========================================

  // HELPER VALUES

  // ==========================================

  const batteryPercentage =

    typeof battery?.percentage === 'number'

      ? Math.max(0, Math.min(100, battery.percentage))

      : null;

  const voltage =

    typeof battery?.voltage_mv === 'number'

      ? `${(battery.voltage_mv / 1000).toFixed(2)} V`

      : '--';

  const uptime =

    typeof status?.uptime_ms === 'number'

      ? `${Math.floor(status.uptime_ms / 3600000)}h ${Math.floor(

          (status.uptime_ms % 3600000) / 60000,

        )}m`

      : '--';

  // ==========================================

  // LOADING SCREEN

  // ==========================================

  if (loading) {

    return (

      <View style={styles.loadingContainer}>

        <StatusBar barStyle="dark-content" />

        <ActivityIndicator

          size="large"

          color={COLORS.primary}

        />

        <Text style={styles.loadingText}>

          Connecting to Drishti...

        </Text>

        <Text style={styles.mutedText}>

          {BASE_URL}

        </Text>

      </View>

    );

  }

  // ==========================================

  // MAIN UI

  // ==========================================

  return (

    <View style={styles.container}>

      <StatusBar barStyle="dark-content" />

      <ScrollView

        showsVerticalScrollIndicator={false}

        refreshControl={

          <RefreshControl

            refreshing={refreshing}

            onRefresh={refreshAll}

          />

        }>

        {/* HEADER */}

        <View style={styles.header}>

          <View>

            <Text style={styles.brand}>DRISHTI</Text>

            <Text style={styles.mutedText}>

              Smart Assistive Technology

            </Text>

          </View>

          <Badge

            label={connected ? 'ONLINE' : 'OFFLINE'}

            success={connected}

          />

        </View>

        {!!error && (

          <Text style={styles.errorBox}>

            {error}

          </Text>

        )}

        {/* DEVICE CONNECTION */}

        <Section title="Device Connection">

          <View style={styles.card}>

            <Text style={styles.cardTitle}>

              {status?.device || 'ESP32-S3 Smart Cap'}

            </Text>

            <Text style={styles.mutedText}>

              {BASE_URL}

            </Text>

            <Text style={styles.smallText}>

              Firmware: {status?.firmware_version || '--'}

            </Text>

            <Text style={styles.smallText}>

              Wi-Fi AP: {status?.wifi?.ap_active ? 'Active' : 'Inactive'}

              {' · '}

              Clients: {status?.wifi?.connected_clients ?? '--'}

            </Text>

          </View>

        </Section>

        {/* DEVICE OVERVIEW */}

        <Section title="Device Overview">

          <View style={styles.card}>

            <View style={styles.rowBetween}>

              <Text style={styles.cardTitle}>

                Battery

              </Text>

              <Text style={styles.batteryValue}>

                {batteryPercentage === null

                  ? '--'

                  : `${batteryPercentage}%`}

              </Text>

            </View>

            <View style={styles.progressBackground}>

              <View

                style={[

                  styles.progressFill,

                  {

                    width: `${batteryPercentage ?? 0}%`,

                  },

                ]}

              />

            </View>

            <Text style={styles.smallText}>

              Voltage: {voltage}

            </Text>

            <Text style={styles.smallText}>

              Charging:{' '}

              {battery?.charging == null

                ? 'Unknown'

                : battery.charging

                ? 'Yes'

                : 'No'}

            </Text>

            <View style={styles.divider} />

            <View style={styles.rowBetween}>

              <Text style={styles.cardTitle}>

                Camera

              </Text>

              <Badge

                label={

                  status?.camera?.ready

                    ? 'READY'

                    : 'NOT READY'

                }

                success={status?.camera?.ready === true}

              />

            </View>

            <Text style={styles.smallText}>

              Initialized: {status?.camera?.initialized ? 'Yes' : 'No'}

            </Text>

          </View>

        </Section>

        {/* SESSION CONTROL */}

        <Section title="Smart Cap Control">

          <View style={styles.card}>

            <View style={styles.rowBetween}>

              <View style={{flex: 1}}>

                <Text style={styles.cardTitle}>

                  Assistive Session

                </Text>

                <Text style={styles.mutedText}>

                  {sessionActive

                    ? 'AI camera monitoring is active'

                    : 'Start the AI monitoring session'}

                </Text>

              </View>

              <Badge

                label={sessionActive ? 'ACTIVE' : 'STOPPED'}

                success={sessionActive}

              />

            </View>

            <TouchableOpacity

              style={[

                styles.primaryButton,

                sessionActive && styles.stopButton,

                (!connected || aiLoading) && styles.disabledButton,

              ]}

              onPress={

                sessionActive ? stopSession : startSession

              }

              disabled={!connected || aiLoading}>

              {aiLoading ? (

                <ActivityIndicator color={COLORS.white} />

              ) : (

                <Text style={styles.primaryButtonText}>

                  {sessionActive

                    ? 'Stop Session'

                    : 'Start Smart Cap + AI'}

                </Text>

              )}

            </TouchableOpacity>

          </View>

        </Section>

        {/* CAMERA PREVIEW */}

        <Section title="Camera Preview">

          <View style={styles.cameraCard}>

            {frameUri ? (

              <Image

                key={frameUri}

                source={{uri: frameUri}}

                style={styles.cameraImage}

                resizeMode="contain"

                onError={() => setFrameUri(null)}

              />

            ) : (

              <Text style={styles.cameraPlaceholder}>

                No camera frame captured

              </Text>

            )}

            {cameraBusy && (

              <View style={styles.cameraOverlay}>

                <ActivityIndicator color={COLORS.white} />

                <Text style={styles.cameraOverlayText}>

                  Capturing / analysing...

                </Text>

              </View>

            )}

          </View>

          <Text style={styles.smallText}>

            Last frame: {frameUpdated}

          </Text>

          <TouchableOpacity

            style={styles.secondaryButton}

            onPress={captureFrame}

            disabled={cameraBusy || !connected}>

            <Text style={styles.secondaryButtonText}>

              {cameraBusy

                ? 'Capturing...'

                : 'Capture Camera Frame'}

            </Text>

          </TouchableOpacity>

        </Section>

        {/* AI OBJECT DETECTION */}

        <Section title="Drishti AI Object Detection">

          <View style={styles.card}>

            <View style={styles.rowBetween}>

              <Text style={styles.cardTitle}>

                AI Engine

              </Text>

              <Badge

                label={

                  aiLoading

                    ? 'LOADING'

                    : aiReady

                    ? 'READY'

                    : 'NOT LOADED'

                }

                success={aiReady}

              />

            </View>

            <Text style={styles.smallText}>

              Inference time:{' '}

              {inferenceTime === null

                ? '--'

                : `${inferenceTime} ms`}

            </Text>

            <Text style={styles.smallText}>

              <Text style={styles.smallText}>
                Preprocessing: {preprocessTime === null ? '--' : `${preprocessTime} ms`}
              </Text>

              <Text style={styles.smallText}>
                TFLite inference: {inferenceTime === null ? '--' : `${inferenceTime} ms`}
              </Text>

              <Text style={styles.smallText}>
                Phone speaker: {ttsReady ? 'Ready' : 'Not ready'}
              </Text>

              <Text style={styles.smallText}>
                Last alert: {lastAlert}
              </Text>

              Objects detected: {detections.length}

            </Text>

            {!!aiError && (

              <Text style={styles.errorText}>

                {aiError}

              </Text>

            )}

            {detections.map((item, index) => (

              <View

                key={`${item.classId}-${index}`}

                style={styles.detectionRow}>

                <Text style={styles.cardTitle}>

                  Class ID: {item.classId}

                </Text>

                <Text style={styles.smallText}>

                  Confidence: {(item.confidence * 100).toFixed(1)}%

                </Text>

                <Text style={styles.smallText}>

                  Position: {getDetectionPosition(item)}

                </Text>

              </View>

            ))}

            {aiReady && detections.length === 0 && !aiError && (

              <Text style={styles.mutedText}>

                No objects detected above the confidence threshold in the latest analysed frame.

              </Text>

            )}

            <Text style={styles.warningText}>

              Prototype only: this generic model is not a validated

              pothole or road-hazard detector. Do not rely on it for

              safe navigation.

            </Text>

          </View>

        </Section>

        {/* MJPEG STREAM */}

        <Section title="MJPEG Stream Diagnostics">

          <View style={styles.card}>

            <View style={styles.rowBetween}>

              <Text style={styles.cardTitle}>

                GET /api/v1/video

              </Text>

              <Badge

                label={

                  videoState === 'working'

                    ? 'RESPONDING'

                    : videoState === 'failed'

                    ? 'FAILED'

                    : 'NOT TESTED'

                }

                success={videoState === 'working'}

              />

            </View>

            <Text style={styles.smallText}>

              {videoMessage}

            </Text>

            <TouchableOpacity

              style={styles.secondaryButton}

              onPress={testVideoStream}

              disabled={videoBusy || !connected}>

              {videoBusy ? (

                <ActivityIndicator color={COLORS.primary} />

              ) : (

                <Text style={styles.secondaryButtonText}>

                  Test MJPEG Endpoint

                </Text>

              )}

            </TouchableOpacity>

          </View>

        </Section>

        {/* HAPTIC FEEDBACK */}

        <Section title="Haptic Feedback">

          <View style={styles.card}>

            <View style={styles.rowBetween}>

              <View style={{flex: 1}}>

                <Text style={styles.cardTitle}>

                  Master Vibration

                </Text>

                <Text style={styles.mutedText}>

                  Enable or disable the motors

                </Text>

              </View>

              <Switch

                value={vibrationEnabled}

                onValueChange={changeVibration}

                disabled={!connected || vibrationBusy}

                trackColor={{

                  false: '#CBD5E1',

                  true: '#93C5FD',

                }}

                thumbColor={

                  vibrationEnabled

                    ? COLORS.primary

                    : '#F8FAFC'

                }

              />

            </View>

            <View style={styles.motorRow}>

              <Text style={styles.smallText}>

                Left:{' '}

                {!status?.vibration?.left_available

                  ? 'Unavailable'

                  : status.vibration.left_active

                  ? 'Active'

                  : 'Inactive'}

              </Text>

              <Text style={styles.smallText}>

                Right:{' '}

                {!status?.vibration?.right_available

                  ? 'Unavailable'

                  : status.vibration.right_active

                  ? 'Active'

                  : 'Inactive'}

              </Text>

            </View>

            <ActionButton

              title="Test Phone Speaker"
              disabled={!ttsReady}
              onPress={testPhoneSpeaker}
            />

            <ActionButton

              title="Vibrate Left (500 ms)"

              disabled={

                vibrationBusy || !connected || !vibrationEnabled

              }

              onPress={() =>

                sendDirectionalVibration(true, false)

              }

            />

            <ActionButton

              title="Vibrate Right (500 ms)"

              disabled={

                vibrationBusy || !connected || !vibrationEnabled

              }

              onPress={() =>

                sendDirectionalVibration(false, true)

              }

            />

            <ActionButton

              title="Vibrate Both (500 ms)"

              disabled={

                vibrationBusy || !connected || !vibrationEnabled

              }

              onPress={() =>

                sendDirectionalVibration(true, true)

              }

            />

            <ActionButton

              title="Stop Both Motors"

              disabled={vibrationBusy || !connected}

              onPress={() =>

                sendDirectionalVibration(false, false)

              }

              danger

            />

            <ActionButton

              title="Test Both Motors"

              disabled={

                vibrationBusy || !connected || !vibrationEnabled

              }

              onPress={runVibrationTest}

            />

          </View>

        </Section>

        {/* DEVICE INFORMATION */}

        <Section title="Device Information">

          <View style={styles.card}>

            <InfoRow

              label="Device"

              value={status?.device || 'ESP32-S3'}

            />

            <InfoRow

              label="Firmware"

              value={status?.firmware_version || '--'}

            />

            <InfoRow

              label="Uptime"

              value={uptime}

            />

            <InfoRow

              label="IP Address"

              value="192.168.4.1"

            />

            <InfoRow

              label="Last Updated"

              value={lastUpdated}

            />

          </View>

        </Section>

        {/* FOOTER */}

        <View style={styles.footer}>

          <Text style={styles.brand}>DRISHTI</Text>

          <Text style={styles.mutedText}>

            Assistive Technology for Accessibility

          </Text>

        </View>

      </ScrollView>

    </View>

  );

}

// ==========================================

// REUSABLE UI COMPONENTS

// ==========================================

function Section({

  title,

  children,

}: {

  title: string;

  children: React.ReactNode;

}) {

  return (

    <View style={styles.section}>

      <Text style={styles.sectionTitle}>

        {title}

      </Text>

      {children}

    </View>

  );

}

function Badge({

  label,

  success,

}: {

  label: string;

  success: boolean;

}) {

  return (

    <View

      style={[

        styles.badge,

        success ? styles.badgeSuccess : styles.badgeError,

      ]}>

      <Text style={styles.badgeText}>

        {label}

      </Text>

    </View>

  );

}

function ActionButton({

  title,

  onPress,

  disabled,

  danger = false,

}: {

  title: string;

  onPress: () => void;

  disabled: boolean;

  danger?: boolean;

}) {

  return (

    <TouchableOpacity

      style={[

        styles.secondaryButton,

        danger && styles.dangerButton,

        disabled && styles.disabledButton,

      ]}

      onPress={onPress}

      disabled={disabled}>

      <Text

        style={[

          styles.secondaryButtonText,

          danger && styles.dangerText,

        ]}>

        {title}

      </Text>

    </TouchableOpacity>

  );

}

function InfoRow({

  label,

  value,

}: {

  label: string;

  value: string;

}) {

  return (

    <View style={styles.infoRow}>

      <Text style={styles.mutedText}>

        {label}

      </Text>

      <Text style={styles.infoValue}>

        {value}

      </Text>

    </View>

  );

}

// ==========================================

// STYLES

// ==========================================

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: COLORS.background,

  },

  loadingContainer: {

    flex: 1,

    backgroundColor: COLORS.background,

    justifyContent: 'center',

    alignItems: 'center',

  },

  loadingText: {

    marginTop: 16,

    fontSize: 17,

    fontWeight: '700',

    color: COLORS.text,

  },

  header: {

    paddingHorizontal: 20,

    paddingTop: 22,

    paddingBottom: 18,

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

  },

  brand: {

    fontSize: 25,

    fontWeight: '900',

    letterSpacing: 2,

    color: COLORS.primary,

  },

  mutedText: {

    fontSize: 12,

    color: COLORS.secondary,

    marginTop: 4,

  },

  smallText: {

    fontSize: 12,

    color: COLORS.secondary,

    marginTop: 7,

  },

  section: {

    marginHorizontal: 20,

    marginBottom: 22,

  },

  sectionTitle: {

    fontSize: 17,

    fontWeight: '800',

    color: COLORS.text,

    marginBottom: 12,

  },

  card: {

    backgroundColor: COLORS.white,

    padding: 16,

    borderRadius: 15,

    borderWidth: 1,

    borderColor: COLORS.border,

  },

  cardTitle: {

    fontSize: 15,

    fontWeight: '700',

    color: COLORS.text,

  },

  rowBetween: {

    flexDirection: 'row',

    alignItems: 'center',

    justifyContent: 'space-between',

  },

  badge: {

    paddingHorizontal: 10,

    paddingVertical: 6,

    borderRadius: 20,

    alignSelf: 'flex-start',

  },

  badgeSuccess: {

    backgroundColor: COLORS.greenLight,

  },

  badgeError: {

    backgroundColor: COLORS.redLight,

  },

  badgeText: {

    fontSize: 10,

    fontWeight: '800',

    color: COLORS.text,

  },

  errorBox: {

    marginHorizontal: 20,

    marginBottom: 12,

    backgroundColor: COLORS.redLight,

    padding: 12,

    borderRadius: 10,

    color: COLORS.red,

  },

  errorText: {

    color: COLORS.red,

    marginTop: 10,

    fontSize: 12,

  },

  warningText: {

    color: COLORS.orange,

    fontSize: 11,

    lineHeight: 16,

    marginTop: 14,

  },

  batteryValue: {

    fontSize: 21,

    fontWeight: '900',

    color: COLORS.green,

  },

  progressBackground: {

    height: 9,

    backgroundColor: '#E2E8F0',

    borderRadius: 10,

    marginTop: 13,

    marginBottom: 8,

    overflow: 'hidden',

  },

  progressFill: {

    height: '100%',

    backgroundColor: COLORS.green,

    borderRadius: 10,

  },

  divider: {

    height: 1,

    backgroundColor: COLORS.border,

    marginVertical: 16,

  },

  primaryButton: {

    backgroundColor: COLORS.primary,

    padding: 16,

    borderRadius: 13,

    alignItems: 'center',

    marginTop: 16,

  },

  primaryButtonText: {

    color: COLORS.white,

    fontWeight: '800',

    fontSize: 15,

  },

  stopButton: {

    backgroundColor: COLORS.red,

  },

  disabledButton: {

    opacity: 0.45,

  },

  cameraCard: {

    height: 230,

    backgroundColor: '#101827',

    borderRadius: 15,

    overflow: 'hidden',

    justifyContent: 'center',

    alignItems: 'center',

  },

  cameraImage: {

    width: '100%',

    height: '100%',

  },

  cameraPlaceholder: {

    color: '#CBD5E1',

    fontSize: 13,

  },

  cameraOverlay: {

   ...StyleSheet.absoluteFill,

    backgroundColor: 'rgba(0,0,0,0.55)',

    justifyContent: 'center',

    alignItems: 'center',

  },

  cameraOverlayText: {

    color: COLORS.white,

    marginTop: 8,

  },

  secondaryButton: {

    marginTop: 11,

    padding: 14,

    borderRadius: 12,

    backgroundColor: COLORS.primaryLight,

    alignItems: 'center',

  },

  secondaryButtonText: {

    color: COLORS.primary,

    fontWeight: '800',

    fontSize: 13,

  },

  dangerButton: {

    backgroundColor: COLORS.redLight,

  },

  dangerText: {

    color: COLORS.red,

  },

  detectionRow: {

    paddingVertical: 10,

    borderBottomWidth: 1,

    borderBottomColor: COLORS.border,

  },

  motorRow: {

    flexDirection: 'row',

    justifyContent: 'space-between',

    marginTop: 8,

  },

  infoRow: {

    flexDirection: 'row',

    justifyContent: 'space-between',

    alignItems: 'center',

    paddingVertical: 13,

    borderBottomWidth: 1,

    borderBottomColor: COLORS.border,

  },

  infoValue: {

    fontSize: 12,

    fontWeight: '700',

    color: COLORS.text,

    maxWidth: '55%',

    textAlign: 'right',

  },

  footer: {

    alignItems: 'center',

    paddingVertical: 25,

    paddingHorizontal: 20,

  },

});