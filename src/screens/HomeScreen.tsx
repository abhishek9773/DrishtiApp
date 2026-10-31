
import React, {useCallback, useEffect, useState} from 'react';
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

// =====================================================
// CONFIGURATION
// =====================================================

const BASE_URL = 'http://192.168.4.1';

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
  orangeLight: '#FFEDD5',
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
    active?: boolean;
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

// =====================================================
// MAIN SCREEN
// =====================================================

export default function HomeScreen() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [battery, setBattery] = useState<BatteryData | null>(null);

  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [sessionActive, setSessionActive] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(false);
  const [vibrationBusy, setVibrationBusy] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);

  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Not updated');
  const [error, setError] = useState('');

  // =====================================================
  // API: GET DEVICE STATUS
  // =====================================================

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/status`);

      if (!response.ok) {
        throw new Error(`Status API returned ${response.status}`);
      }

      const data: DeviceStatus = await response.json();

      setStatus(data);
      setConnected(true);
      setError('');

      if (data.vibration?.active !== undefined) {
        setVibrationEnabled(data.vibration.active);
      }

      return data;
    } catch (err) {
      setConnected(false);
      throw err;
    }
  }, []);

  // =====================================================
  // API: GET BATTERY
  // =====================================================

  const fetchBattery = useCallback(async () => {
    const response = await fetch(`${BASE_URL}/api/v1/battery`);

    if (!response.ok) {
      throw new Error(`Battery API returned ${response.status}`);
    }

    const data: BatteryData = await response.json();
    setBattery(data);

    return data;
  }, []);

  // =====================================================
  // REFRESH ALL DEVICE DATA
  // =====================================================

  const refreshAll = useCallback(async () => {
    setRefreshing(true);

    try {
      const results = await Promise.allSettled([
        fetchStatus(),
        fetchBattery(),
      ]);

      const statusFailed = results[0].status === 'rejected';

      if (statusFailed) {
        setError('Cannot connect to Drishti Smart Cap. Check Wi-Fi connection.');
      } else {
        setError('');
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [fetchStatus, fetchBattery]);

  // =====================================================
  // AUTO REFRESH
  // =====================================================

  useEffect(() => {
    refreshAll();

    const interval = setInterval(() => {
      refreshAll();
    }, 5000);

    return () => clearInterval(interval);
  }, [refreshAll]);

  // =====================================================
  // API: VIBRATION CONTROL
  // =====================================================

  const changeVibration = async (enabled: boolean) => {
    setVibrationBusy(true);

    try {
      const response = await fetch(`${BASE_URL}/api/v1/vibration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({enabled}),
      });

      if (!response.ok) {
        throw new Error(`Vibration API returned ${response.status}`);
      }

      setVibrationEnabled(enabled);
      Alert.alert(
        'Drishti',
        `Vibration ${enabled ? 'enabled' : 'disabled'} successfully.`,
      );
    } catch (err) {
      Alert.alert(
        'Vibration Error',
        err instanceof Error
          ? err.message
          : 'Unable to update vibration settings.',
      );
    } finally {
      setVibrationBusy(false);
    }
  };

  // =====================================================
  // API: VIBRATION TEST
  // =====================================================

  const runVibrationTest = async () => {
    setVibrationBusy(true);

    try {
      const response = await fetch(`${BASE_URL}/api/v1/vibration/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          duration_ms: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`Vibration test returned ${response.status}`);
      }

      Alert.alert(
        'Vibration Test',
        'The device accepted the vibration test request.',
      );
    } catch (err) {
      Alert.alert(
        'Vibration Error',
        err instanceof Error ? err.message : 'Unable to run vibration test.',
      );
    } finally {
      setVibrationBusy(false);
    }
  };

  // =====================================================
  // API: CAMERA FRAME
  // =====================================================

  const captureFrame = async () => {
    setCameraBusy(true);

    try {
      const response = await fetch(`${BASE_URL}/api/v1/frame`);

      if (!response.ok) {
        throw new Error(`Camera API returned ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('image/jpeg')) {
        throw new Error('Camera did not return a JPEG image.');
      }

      // Native Image loads the JPEG directly from this endpoint.
      setFrameUri(
        `${BASE_URL}/api/v1/frame?t=${Date.now()}`,
      );

      Alert.alert('Camera', 'Frame captured successfully.');
    } catch (err) {
      Alert.alert(
        'Camera Error',
        err instanceof Error ? err.message : 'Unable to capture frame.',
      );
    } finally {
      setCameraBusy(false);
    }
  };

  // =====================================================
  // SESSION CONTROL
  // =====================================================

  const startSession = async () => {
    try {
      await fetchStatus();

      setSessionActive(true);

      Alert.alert(
        'Drishti Started',
        'Device connection has been checked. Monitoring is active.',
      );
    } catch (err) {
      Alert.alert(
        'Connection Error',
        err instanceof Error
          ? `Connect your phone to the Drishti Smart Cap Wi-Fi first. ${err.message}`
          : 'Connect your phone to the Drishti Smart Cap Wi-Fi first.',
      );
    }
  };

  const stopSession = () => {
    setSessionActive(false);
    Alert.alert('Drishti Stopped', 'Monitoring session stopped.');
  };

  // =====================================================
  // HELPER VALUES
  // =====================================================

  const batteryPercentage =
    typeof battery?.percentage === 'number'
      ? Math.max(0, Math.min(100, battery.percentage))
      : null;

  const cameraReady = status?.camera?.ready === true;

  const uptime = status?.uptime_ms
    ? `${Math.floor(status.uptime_ms / 3600000)}h ${Math.floor(
        (status.uptime_ms % 3600000) / 60000,
      )}m`
    : '--';

  // =====================================================
  // LOADING SCREEN
  // =====================================================

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Connecting to Drishti...</Text>
        <Text style={styles.loadingSubtext}>{BASE_URL}</Text>
      </View>
    );
  }

  // =====================================================
  // MAIN UI
  // =====================================================

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
            <Text style={styles.subtitle}>Smart Assistive Technology</Text>
          </View>

          <View
            style={[
              styles.connectionBadge,
              connected ? styles.onlineBadge : styles.offlineBadge,
            ]}>
            <View
              style={[
                styles.connectionDot,
                {backgroundColor: connected ? COLORS.green : COLORS.red},
              ]}
            />
            <Text
              style={[
                styles.connectionText,
                {color: connected ? COLORS.green : COLORS.red},
              ]}>
              {connected ? 'Connected' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* ERROR */}

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

            <View
              style={[
                styles.statusPill,
                connected ? styles.successPill : styles.dangerPill,
              ]}>
              <Text style={styles.statusPillText}>
                {connected ? 'ONLINE' : 'OFFLINE'}
              </Text>
            </View>
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

        {/* DEVICE OVERVIEW */}

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

            <Text style={styles.smallText}>
              Voltage:{' '}
              {battery?.voltage_mv != null
                ? `${(battery.voltage_mv / 1000).toFixed(2)} V`
                : '--'}
            </Text>

            <Text style={styles.smallText}>
              Charging: {battery?.charging ? 'Yes' : 'No / Unknown'}
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
                  ? 'Monitoring session is active'
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
            onPress={sessionActive ? stopSession : startSession}>
            <Text style={styles.primaryButtonText}>
              {sessionActive ? 'Stop Session' : 'Start Smart Cap'}
            </Text>
          </TouchableOpacity>
        </Section>

        {/* CAMERA */}

        <Section title="Camera Preview">
          <View style={styles.cameraCard}>
            {frameUri ? (
              <Image
                source={{uri: frameUri}}
                style={styles.cameraImage}
                resizeMode="contain"
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
                <Text style={styles.cameraLoadingText}>Capturing frame...</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={captureFrame}
            disabled={cameraBusy}>
            <Text style={styles.secondaryButtonText}>
              {cameraBusy ? 'Capturing...' : 'Capture Camera Frame'}
            </Text>
          </TouchableOpacity>
        </Section>

        {/* VIBRATION */}

        <Section title="Haptic Feedback">
          <View style={styles.vibrationCard}>
            <View style={{flex: 1}}>
              <Text style={styles.cardTitle}>Vibration Motor</Text>
              <Text style={styles.mutedText}>
                Control the vibration feedback
              </Text>
            </View>

            <Switch
              value={vibrationEnabled}
              onValueChange={changeVibration}
              disabled={!connected || vibrationBusy}
              trackColor={{false: '#CBD5E1', true: '#93C5FD'}}
              thumbColor={vibrationEnabled ? COLORS.primary : '#F8FAFC'}
            />
          </View>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={runVibrationTest}
            disabled={!connected || vibrationBusy}>
            <Text style={styles.secondaryButtonText}>
              {vibrationBusy ? 'Please wait...' : 'Test Vibration'}
            </Text>
          </TouchableOpacity>
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

// =====================================================
// LOCAL UI COMPONENTS
// =====================================================

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

// =====================================================
// STYLES
// =====================================================

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
    height: 210,
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
