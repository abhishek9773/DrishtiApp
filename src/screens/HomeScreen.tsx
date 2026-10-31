
import React, {useCallback, useEffect, useRef, useState} from 'react';
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

// ======================================================
// CONFIGURATION
// ======================================================

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

// ======================================================
// TYPES
// ======================================================

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
  } | null;
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

// ======================================================
// API HELPER
// ======================================================

async function getJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`);

  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        json?.message ||
        `${endpoint} returned HTTP ${response.status}`,
    );
  }

  if (json?.success === false) {
    throw new Error(
      json?.error?.message || 'The device returned an API error.',
    );
  }

  // Supports both wrapped and unwrapped firmware responses.
  return (json?.data ?? json) as T;
}

async function postJson<T>(
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

  const json = await response.json();

  if (!response.ok || json?.success === false) {
    throw new Error(
      json?.error?.message ||
        json?.message ||
        `${endpoint} returned HTTP ${response.status}`,
    );
  }

  return (json?.data ?? json) as T;
}

// ======================================================
// HOME SCREEN
// ======================================================

export default function HomeScreen() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [battery, setBattery] = useState<BatteryData | null>(null);

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [sessionActive, setSessionActive] = useState(false);

  const [vibrationEnabled, setVibrationEnabled] = useState(false);
  const [vibrationBusy, setVibrationBusy] = useState(false);

  const [cameraBusy, setCameraBusy] = useState(false);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameUpdated, setFrameUpdated] = useState('Not captured');

  const [videoBusy, setVideoBusy] = useState(false);
  const [videoState, setVideoState] = useState<VideoState>('not-tested');
  const [videoMessage, setVideoMessage] = useState(
    'MJPEG stream has not been tested.',
  );

  const [lastUpdated, setLastUpdated] = useState('--');

  const refreshInProgress = useRef(false);

  // ====================================================
  // STATUS API
  // ====================================================

  const fetchStatus = useCallback(async () => {
    const data = await getJson<DeviceStatus>('/api/v1/status');

    setStatus(data);
    setConnected(true);

    if (typeof data.vibration?.enabled === 'boolean') {
      setVibrationEnabled(data.vibration.enabled);
    }

    return data;
  }, []);

  // ====================================================
  // BATTERY API
  // ====================================================

  const fetchBattery = useCallback(async () => {
    const data = await getJson<BatteryData>('/api/v1/battery');

    setBattery(data);
    return data;
  }, []);

  // ====================================================
  // REFRESH DEVICE DATA
  // ====================================================

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
            : 'Cannot connect to Drishti. Check your Wi-Fi connection.',
        );
      } else {
        setConnected(true);
        setError('');
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
      refreshInProgress.current = false;
    }
  }, [fetchStatus, fetchBattery]);

  // ====================================================
  // AUTO REFRESH
  // ====================================================

  useEffect(() => {
    refreshAll();

    const interval = setInterval(() => {
      refreshAll();
    }, 5000);

    return () => clearInterval(interval);
  }, [refreshAll]);

  // ====================================================
  // CAMERA FRAME
  // ====================================================

  const captureFrame = useCallback(async () => {
    setCameraBusy(true);

    try {
      // Check whether the firmware returns a JPEG.
      const response = await fetch(
        `${FRAME_URL}?check=${Date.now()}`,
      );

      if (!response.ok) {
        let message = `Camera returned HTTP ${response.status}`;

        try {
          const json = await response.json();
          message = json?.error?.message || message;
        } catch {
          // The response was not JSON.
        }

        throw new Error(message);
      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.toLowerCase().includes('image/jpeg')) {
        throw new Error(
          `Expected image/jpeg but received ${contentType || 'unknown content type'}`,
        );
      }

      // Image component loads the JPEG directly from the ESP32.
      setFrameUri(`${FRAME_URL}?t=${Date.now()}`);
      setFrameUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      Alert.alert(
        'Camera Error',
        err instanceof Error ? err.message : 'Unable to capture camera frame.',
      );
    } finally {
      setCameraBusy(false);
    }
  }, []);

  // Refresh still frames during an active session.
  useEffect(() => {
    if (!sessionActive) {
      return;
    }

    captureFrame();

    const interval = setInterval(() => {
      captureFrame();
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionActive, captureFrame]);

  // ====================================================
  // MJPEG STREAM CHECK
  // ====================================================

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
        method: 'GET',
        headers: {
          Accept: 'multipart/x-mixed-replace',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Video API returned HTTP ${response.status}`);
      }

      const contentType = (
        response.headers.get('content-type') || ''
      ).toLowerCase();

      if (!contentType.includes('multipart/x-mixed-replace')) {
        throw new Error(
          `Unexpected video content type: ${contentType || 'missing'}`,
        );
      }

      setVideoState('working');
      setVideoMessage(
        'The ESP32 accepted the MJPEG connection and returned the expected content type. This checks the endpoint, not actual frame playback.',
      );
    } catch (err) {
      setVideoState('failed');

      setVideoMessage(
        err instanceof Error
          ? err.message
          : 'Unable to connect to the video stream.',
      );
    } finally {
      clearTimeout(timeout);
      controller.abort();
      setVideoBusy(false);
    }
  };

  // ====================================================
  // MASTER VIBRATION CONTROL
  // ====================================================

  const changeVibration = async (enabled: boolean) => {
    setVibrationBusy(true);

    try {
      await postJson('/api/v1/vibration', {enabled});

      setVibrationEnabled(enabled);

      // Refresh actual commanded state.
      await fetchStatus();

      Alert.alert(
        'Drishti',
        `Master vibration ${enabled ? 'enabled' : 'disabled'}.`,
      );
    } catch (err) {
      Alert.alert(
        'Vibration Error',
        err instanceof Error ? err.message : 'Unable to change vibration.',
      );
    } finally {
      setVibrationBusy(false);
    }
  };

  // ====================================================
  // DIRECTIONAL VIBRATION
  // ====================================================

  const sendDirectionalVibration = async (
    left: boolean,
    right: boolean,
  ) => {
    if (!connected) {
      Alert.alert('Device Offline', 'Connect to the Drishti Wi-Fi first.');
      return;
    }

    if (!status?.vibration?.available) {
      Alert.alert('Unavailable', 'Vibration hardware is unavailable.');
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
    } catch (err) {
      Alert.alert(
        'Directional Vibration Error',
        err instanceof Error ? err.message : 'Command failed.',
      );
    } finally {
      setVibrationBusy(false);
    }
  };

  // ====================================================
  // BOTH-MOTOR VIBRATION TEST
  // ====================================================

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

      Alert.alert(
        'Vibration Test',
        'The firmware accepted the 500 ms vibration test.',
      );

      await fetchStatus();
    } catch (err) {
      Alert.alert(
        'Vibration Error',
        err instanceof Error ? err.message : 'Vibration test failed.',
      );
    } finally {
      setVibrationBusy(false);
    }
  };

  // ====================================================
  // SESSION CONTROL
  // ====================================================

  const startSession = async () => {
    try {
      await fetchStatus();

      setSessionActive(true);

      Alert.alert(
        'Drishti Started',
        'Device connected. Camera frame monitoring has started.',
      );
    } catch (err) {
      Alert.alert(
        'Connection Error',
        err instanceof Error
          ? `Connect to Drishti Wi-Fi first. ${err.message}`
          : 'Connect to Drishti Wi-Fi first.',
      );
    }
  };

  const stopSession = async () => {
    setSessionActive(false);

    // Stop any currently commanded directional vibration.
    if (connected && vibrationEnabled) {
      try {
        await postJson('/api/v1/vibration/directional', {
          left: false,
          right: false,
          duration_ms: 0,
        });

        await fetchStatus();
      } catch {
        // Session still stops locally if the device is unreachable.
      }
    }

    Alert.alert('Drishti Stopped', 'Monitoring session stopped.');
  };

  // ====================================================
  // HELPER VALUES
  // ====================================================

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

  const cameraReady = status?.camera?.ready === true;

  // ====================================================
  // LOADING
  // ====================================================

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Connecting to Drishti...</Text>
        <Text style={styles.loadingSubtext}>{BASE_URL}</Text>
      </View>
    );
  }

  // ====================================================
  // MAIN UI
  // ====================================================

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
            <Text style={styles.subtitle}>
              Smart Assistive Technology
            </Text>
          </View>

          <View
            style={[
              styles.connectionBadge,
              connected ? styles.onlineBadge : styles.offlineBadge,
            ]}>
            <View
              style={[
                styles.connectionDot,
                {
                  backgroundColor: connected
                    ? COLORS.green
                    : COLORS.red,
                },
              ]}
            />
            <Text
              style={[
                styles.connectionText,
                {
                  color: connected ? COLORS.green : COLORS.red,
                },
              ]}>
              {connected ? 'Connected' : 'Offline'}
            </Text>
          </View>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* DEVICE CONNECTION */}

        <Section title="Device Connection">
          <View style={styles.connectionCard}>
            <View style={styles.deviceIcon}>
              <Text style={styles.deviceIconText}>⌁</Text>
            </View>

            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>ESP32-S3 Smart Cap</Text>
              <Text style={styles.mutedText}>{BASE_URL}</Text>
              <Text style={styles.smallText}>
                Firmware: {status?.firmware_version || '--'}
              </Text>
            </View>

            <Badge label={connected ? 'ONLINE' : 'OFFLINE'} success={connected} />
          </View>

          <View style={styles.twoColumns}>
            <InfoCard
              label="Wi-Fi Access Point"
              value={status?.wifi?.ap_active ? 'Active' : 'Inactive'}
            />
            <InfoCard
              label="Connected Clients"
              value={String(status?.wifi?.connected_clients ?? '--')}
            />
          </View>
        </Section>

        {/* BATTERY AND CAMERA STATUS */}

        <Section title="Device Overview">
          <View style={styles.overviewCard}>
            <View style={styles.overviewHeader}>
              <Text style={styles.cardTitle}>Battery Level</Text>
              <Text style={styles.batteryValue}>
                {batteryPercentage !== null
                  ? `${batteryPercentage}%`
                  : '--'}
              </Text>
            </View>

            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width:
                      batteryPercentage !== null
                        ? `${batteryPercentage}%`
                        : '0%',
                  },
                ]}
              />
            </View>

            <Text style={styles.smallText}>Voltage: {voltage}</Text>
            <Text style={styles.smallText}>
              Charging: {battery?.charging == null
                ? 'Unknown'
                : battery.charging
                ? 'Yes'
                : 'No'}
            </Text>

            <Text style={styles.smallText}>
              Charge state: {battery?.charge_state || '--'}
            </Text>

            <View style={styles.divider} />

            <View style={styles.overviewHeader}>
              <Text style={styles.cardTitle}>Camera Status</Text>
              <Badge
                label={cameraReady ? 'READY' : 'NOT READY'}
                success={cameraReady}
              />
            </View>

            <Text style={styles.smallText}>
              Initialized: {status?.camera?.initialized ? 'Yes' : 'No'}
            </Text>
            <Text style={styles.smallText}>
              Stream Active: {status?.camera?.stream_active ? 'Yes' : 'No'}
            </Text>
          </View>
        </Section>

        {/* SESSION CONTROL */}

        <Section title="Smart Cap Control">
          <View style={styles.sessionCard}>
            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>Assistive Session</Text>
              <Text style={styles.mutedText}>
                {sessionActive
                  ? 'Camera frame monitoring is active'
                  : 'Start your device monitoring session'}
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
            ]}
            onPress={sessionActive ? stopSession : startSession}
            disabled={!connected}>
            <Text style={styles.primaryButtonText}>
              {sessionActive ? 'Stop Session' : 'Start Smart Cap'}
            </Text>
          </TouchableOpacity>
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
                onError={() => {
                  setFrameUri(null);
                }}
              />
            ) : (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.cameraIcon}>◉</Text>
                <Text style={styles.cameraPlaceholderText}>
                  No camera frame captured
                </Text>
              </View>
            )}

            {cameraBusy && (
              <View style={styles.cameraLoading}>
                <ActivityIndicator color={COLORS.white} size="large" />
                <Text style={styles.cameraLoadingText}>
                  Capturing frame...
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
              {cameraBusy ? 'Capturing...' : 'Capture Camera Frame'}
            </Text>
          </TouchableOpacity>
        </Section>

        {/* MJPEG STREAM */}

        <Section title="MJPEG Stream Diagnostics">
          <View style={styles.videoCard}>
            <View style={styles.videoHeader}>
              <View style={{flex: 1}}>
                <Text style={styles.cardTitle}>ESP32 MJPEG Stream</Text>
                <Text style={styles.mutedText}>GET /api/v1/video</Text>
              </View>

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

            <View style={styles.divider} />

            <Text style={styles.videoMessage}>{videoMessage}</Text>

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

        {/* MASTER VIBRATION */}

        <Section title="Haptic Feedback">
          <View style={styles.vibrationCard}>
            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>Master Vibration</Text>
              <Text style={styles.mutedText}>
                Enable or disable vibration motors
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
                vibrationEnabled ? COLORS.primary : '#F8FAFC'
              }
            />
          </View>

          <View style={styles.overviewCard}>
            <Text style={styles.cardTitle}>Directional Vibration</Text>
            <Text style={styles.mutedText}>
              Test each motor independently
            </Text>

            <View style={styles.motorStatusRow}>
              <MotorStatus
                label="Left Motor"
                active={status?.vibration?.left_active === true}
                available={status?.vibration?.left_available === true}
              />
              <MotorStatus
                label="Right Motor"
                active={status?.vibration?.right_active === true}
                available={status?.vibration?.right_available === true}
              />
            </View>

            <TouchableOpacity
              style={styles.secondaryButton}
              disabled={vibrationBusy || !connected || !vibrationEnabled}
              onPress={() => sendDirectionalVibration(true, false)}>
              <Text style={styles.secondaryButtonText}>
                Vibrate Left Only (500 ms)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              disabled={vibrationBusy || !connected || !vibrationEnabled}
              onPress={() => sendDirectionalVibration(false, true)}>
              <Text style={styles.secondaryButtonText}>
                Vibrate Right Only (500 ms)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              disabled={vibrationBusy || !connected || !vibrationEnabled}
              onPress={() => sendDirectionalVibration(true, true)}>
              <Text style={styles.secondaryButtonText}>
                Vibrate Both (500 ms)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.stopVibrationButton}
              disabled={vibrationBusy || !connected}
              onPress={() => sendDirectionalVibration(false, false)}>
              <Text style={styles.stopVibrationText}>
                Stop Both Motors
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              disabled={vibrationBusy || !connected || !vibrationEnabled}
              onPress={runVibrationTest}>
              <Text style={styles.secondaryButtonText}>
                {vibrationBusy ? 'Please wait...' : 'Test Both Motors'}
              </Text>
            </TouchableOpacity>
          </View>
        </Section>

        {/* DEVICE INFORMATION */}

        <Section title="Device Information">
          <View style={styles.infoCard}>
            <InfoRow label="Device" value={status?.device || 'ESP32-S3'} />
            <InfoRow
              label="Firmware"
              value={status?.firmware_version || '--'}
            />
            <InfoRow label="Uptime" value={uptime} />
            <InfoRow label="IP Address" value="192.168.4.1" />
            <InfoRow
              label="Battery Available"
              value={battery?.available ? 'Yes' : 'No / Unknown'}
            />
            <InfoRow
              label="Vibration Available"
              value={status?.vibration?.available ? 'Yes' : 'No'}
            />
            <InfoRow label="Last Updated" value={lastUpdated} />
          </View>
        </Section>

        {/* FOOTER */}

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>DRISHTI</Text>
          <Text style={styles.footerText}>
            Assistive Technology for a More Accessible World
          </Text>
          <Text style={styles.footerText}>Smart Cap Control Panel</Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ======================================================
// LOCAL UI COMPONENTS
// ======================================================

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
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
        styles.statusPill,
        success ? styles.successPill : styles.dangerPill,
      ]}>
      <Text style={styles.statusPillText}>{label}</Text>
    </View>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoSmallCard}>
      <Text style={styles.mutedText}>{label}</Text>
      <Text style={styles.infoSmallValue}>{value}</Text>
    </View>
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
      <Text style={styles.mutedText}>{label}</Text>
      <Text style={styles.infoRowValue}>{value}</Text>
    </View>
  );
}

function MotorStatus({
  label,
  active,
  available,
}: {
  label: string;
  active: boolean;
  available: boolean;
}) {
  return (
    <View style={styles.motorStatus}>
      <Text style={styles.mutedText}>{label}</Text>
      <Text
        style={[
          styles.motorStatusValue,
          {color: active ? COLORS.green : COLORS.secondary},
        ]}>
        {!available ? 'Unavailable' : active ? 'Active' : 'Inactive'}
      </Text>
    </View>
  );
}

// ======================================================
// STYLES
// ======================================================

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

  loadingSubtext: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.secondary,
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

  subtitle: {
    fontSize: 12,
    color: COLORS.secondary,
    marginTop: 3,
  },

  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 20,
  },

  onlineBadge: {
    backgroundColor: COLORS.greenLight,
  },

  offlineBadge: {
    backgroundColor: COLORS.redLight,
  },

  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 5,
    marginRight: 6,
  },

  connectionText: {
    fontSize: 12,
    fontWeight: '700',
  },

  errorBox: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: COLORS.redLight,
    padding: 13,
    borderRadius: 10,
  },

  errorText: {
    color: COLORS.red,
    fontSize: 13,
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

  connectionCard: {
    backgroundColor: COLORS.white,
    padding: 15,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  deviceIconText: {
    fontSize: 30,
    color: COLORS.primary,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
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

  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },

  successPill: {
    backgroundColor: COLORS.greenLight,
  },

  dangerPill: {
    backgroundColor: COLORS.redLight,
  },

  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.text,
  },

  twoColumns: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 10,
  },

  infoSmallCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 13,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  infoSmallValue: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 8,
  },

  overviewCard: {
    backgroundColor: COLORS.white,
    padding: 17,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  overviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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

  sessionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },

  primaryButton: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 13,
    alignItems: 'center',
  },

  stopButton: {
    backgroundColor: COLORS.red,
  },

  primaryButtonText: {
    color: COLORS.white,
    fontWeight: '800',
    fontSize: 15,
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
    alignItems: 'center',
  },

  cameraIcon: {
    fontSize: 45,
    color: '#94A3B8',
  },

  cameraPlaceholderText: {
    color: '#CBD5E1',
    fontSize: 13,
    marginTop: 10,
  },

  cameraLoading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  cameraLoadingText: {
    color: COLORS.white,
    marginTop: 10,
  },

  videoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  videoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  videoMessage: {
    color: COLORS.secondary,
    fontSize: 13,
    lineHeight: 19,
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
    fontSize: 14,
  },

  vibrationCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },

  motorStatusRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 15,
  },

  motorStatus: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 12,
    borderRadius: 10,
  },

  motorStatusValue: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },

  stopVibrationButton: {
    marginTop: 11,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.redLight,
    alignItems: 'center',
  },

  stopVibrationText: {
    color: COLORS.red,
    fontWeight: '800',
    fontSize: 14,
  },

  infoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  infoRowValue: {
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

  footerTitle: {
    color: COLORS.primary,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 2,
  },

  footerText: {
    color: COLORS.secondary,
    fontSize: 11,
    marginTop: 5,
    textAlign: 'center',
  },
});
