import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    SafeAreaView,
    ScrollView,
    Alert,
    BackHandler,
    Pressable,
    Platform,
    StatusBar,
    ActivityIndicator,
    Animated,
    Modal,
    TextInput,
    KeyboardAvoidingView,
    AppState
} from 'react-native';
import { Thermometer, Wind, Power, Clock, Plus, Settings, Home, User as UserIcon, X, ChevronLeft, Dumbbell, Zap, Flower, Droplet, Star, Heart, Flame, Snowflake, Activity } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { NativeEventEmitter, NativeModules } from 'react-native';

const { TherapyTimer } = NativeModules;

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

import GradientBackground from '../components/GradientBackground';
import TemperatureDial from '../components/TemperatureDial';
import WheelTimer from '../components/WheelTimer';
import { COLORS, SPACING } from '../constants/theme';
import { sendCommandToDevice } from '../hooks/useBluetooth';
import { 
    monitorDeviceStatus, 
    stopDeviceStatusMonitoring, 
    onDeviceDisconnect,
    requestBluetoothPermission, 
    scanForDevices, 
    connectToGivenDevice,
    writeUserName
} from '../../BLE_connection/TherapyBle';
const DashboardScreen = ({ navigation, route }) => {
    const SESSION_STATE_KEY = 'therapy_session_state';
    const [mode, setMode] = useState('Off'); // Hot, Cold, Off
    const [temp, setTemp] = useState(15);
    const [timer, setTimer] = useState(0); // Selected timer (minutes)
    const [remainingSeconds, setRemainingSeconds] = useState(0); // Countdown (seconds)
    const [isTimerRunning, setIsTimerRunning] = useState(false);
    const [showTimerModal, setShowTimerModal] = useState(false);
    const [presets, setPresets] = useState([]);
    const [isConnected, setIsConnected] = useState(route?.params?.isConnected ?? false);
    const [isLoading, setIsLoading] = useState(false);
    const [showPresetModal, setShowPresetModal] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [newPresetIcon, setNewPresetIcon] = useState('Activity');
    const [editingPresetId, setEditingPresetId] = useState(null);
    const [activePresetId, setActivePresetId] = useState(null);

    const fadeAnim = React.useRef(new Animated.Value(1)).current;
    const frostAnim = React.useRef(new Animated.Value(1)).current;
    const flameAnim = React.useRef(new Animated.Value(1)).current;
    const timerIntervalRef = React.useRef(null);
    const notificationIdRef = React.useRef(null);
    const targetTimeRef = React.useRef(null);
    const lastRemainingSecondsRef = React.useRef(-1);
    const autoConnectAttemptedRef = React.useRef(false);
    const isConnectedRef = React.useRef(isConnected);
    const scanModalVisibleRef = React.useRef(false);
    const isUserAdjustingDialRef = React.useRef(false);
    const ignoreDeviceUpdateUntilRef = React.useRef(0);
    const lastTempUpdateSourceRef = React.useRef('init'); // 'user' | 'device' | 'init'
    const lastModeUpdateSourceRef = React.useRef('init'); // 'user' | 'device' | 'init'
    const lastHotTempRef = React.useRef(40);
    const lastColdTempRef = React.useRef(15);
    const cooldownDuration = 5000; // 5s cooldown as requested

    const [isScanning, setIsScanning] = useState(false);
    const [scanModalVisible, setScanModalVisible] = useState(false);

    const username = route?.params?.username || 'User';
    const deviceName = route?.params?.deviceName || 'Smart Band';
    const safeResume = route?.params?.safeResume === true;

    // Android Back Button Handling
    useFocusEffect(
        React.useCallback(() => {
            const onBackPress = () => {
                Alert.alert("Exit App", "Are you sure you want to exit?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Exit", onPress: () => BackHandler.exitApp() }
                ]);
                return true;
            };
            let backHandlerSubscription;

            if (Platform.OS === 'android') {
                backHandlerSubscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            }

            return () => {
                if (Platform.OS === 'android' && backHandlerSubscription?.remove) {
                    backHandlerSubscription.remove();
                } else if (Platform.OS === 'android' && BackHandler.removeEventListener) {
                    BackHandler.removeEventListener('hardwareBackPress', onBackPress);
                }
            };
        }, [])
    );

    useEffect(() => {
        if (mode === 'Cold') {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(frostAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(frostAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            frostAnim.setValue(1);
            frostAnim.stopAnimation();
        }

        if (mode === 'Hot') {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(flameAnim, {
                        toValue: 1.2,
                        duration: 700,
                        useNativeDriver: true,
                    }),
                    Animated.timing(flameAnim, {
                        toValue: 1,
                        duration: 700,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            flameAnim.setValue(1);
            flameAnim.stopAnimation();
        }
    }, [mode, frostAnim, flameAnim]);

    useEffect(() => {
        Notifications.requestPermissionsAsync().catch(() => {});
    }, []);

    useEffect(() => {
        if (!TherapyTimer) {
            return undefined;
        }

        const eventEmitter = new NativeEventEmitter(TherapyTimer);
        const subscription = eventEmitter.addListener('TherapyTimerEvent', event => {
            if (event?.event === 'timerCompleted') {
                setIsTimerRunning(false);
                setRemainingSeconds(0);
                setTimer(0);
                targetTimeRef.current = null;
                lastRemainingSecondsRef.current = 0;
                prevIsTimerRunningRef.current = false;
                AsyncStorage.removeItem('therapy_timer_target').catch(() => {});
                AsyncStorage.removeItem(SESSION_STATE_KEY).catch(() => {});
                setMode('Off');

                Alert.alert(
                    "Time's Up!",
                    "Your therapy session has finished.",
                    [
                        {
                            text: 'Stop Alarm',
                            onPress: () => {
                                TherapyTimer.stopAlarm?.().catch(() => {});
                            }
                        }
                    ],
                    { cancelable: false }
                );
            }
        });

        return () => subscription.remove();
    }, []);

    // Session Restoration (App Killed/Restarted)
    useEffect(() => {
        const restoreSession = async () => {
            try {
                // Prefer native module as the authoritative source of truth
                if (TherapyTimer) {
                    const active = await TherapyTimer.isTimerActive();
                    if (active) {
                        const rem = await TherapyTimer.getRemainingSeconds();
                        const sessionStateStr = await AsyncStorage.getItem(SESSION_STATE_KEY);
                        if (sessionStateStr) {
                            try {
                                const sessionState = JSON.parse(sessionStateStr);
                                if (sessionState?.mode && sessionState.mode !== 'Off') {
                                    setMode(sessionState.mode);
                                }
                                if (typeof sessionState?.temp === 'number') {
                                    setTemp(sessionState.temp);
                                }
                                if (typeof sessionState?.timer === 'number') {
                                    setTimer(sessionState.timer);
                                }
                            } catch (_) {}
                        }
                        const targetMs = Date.now() + rem * 1000;
                        targetTimeRef.current = targetMs;
                        lastRemainingSecondsRef.current = rem;
                        setRemainingSeconds(rem);
                        setIsTimerRunning(true);
                        prevIsTimerRunningRef.current = true;
                        return;
                    }
                }
            } catch (err) { }
        };
        restoreSession();
    }, []);

    // Handle App returning from background — sync JS UI with native service state
    useEffect(() => {
        const subscription = AppState.addEventListener('change', async nextAppState => {
            if (nextAppState === 'active') {
                // Re-sync from native service (non-blocking, only on app resume)
                if (TherapyTimer) {
                    TherapyTimer.isTimerActive()
                        .then(active => {
                            if (active) {
                                return TherapyTimer.getRemainingSeconds().then(rem => {
                                    AsyncStorage.getItem(SESSION_STATE_KEY)
                                        .then(sessionStateStr => {
                                            if (!sessionStateStr) return;
                                            try {
                                                const sessionState = JSON.parse(sessionStateStr);
                                                if (sessionState?.mode && sessionState.mode !== 'Off') {
                                                    setMode(sessionState.mode);
                                                }
                                                if (typeof sessionState?.temp === 'number') {
                                                    setTemp(sessionState.temp);
                                                }
                                                if (typeof sessionState?.timer === 'number') {
                                                    setTimer(sessionState.timer);
                                                }
                                            } catch (_) {}
                                        })
                                        .catch(() => {});
                                    // Re-anchor the local ref so JS countdown stays accurate
                                    targetTimeRef.current = Date.now() + rem * 1000;
                                    setRemainingSeconds(rem);
                                    setIsTimerRunning(true);
                                    prevIsTimerRunningRef.current = true;
                                });
                            } else if (isTimerRunning) {
                                // Timer finished while in background
                                setIsTimerRunning(false);
                                setRemainingSeconds(0);
                                targetTimeRef.current = null;
                                prevIsTimerRunningRef.current = false;
                                AsyncStorage.removeItem('therapy_timer_target').catch(() => {});
                                AsyncStorage.removeItem(SESSION_STATE_KEY).catch(() => {});
                                setMode('Off');
                                
                                Alert.alert(
                                    "Time's Up!",
                                    "Your therapy session has finished.",
                                    [
                                        {
                                            text: 'Stop Alarm',
                                            onPress: () => {
                                                if (TherapyTimer && TherapyTimer.stopAlarm) {
                                                    TherapyTimer.stopAlarm().catch(() => {});
                                                }
                                            }
                                        }
                                    ],
                                    { cancelable: false }
                                );
                            }
                        })
                        .catch(() => {});
                }
            }
        });

        return () => { subscription.remove(); };
    }, [isTimerRunning, temp]);

    useEffect(() => {
        isConnectedRef.current = isConnected;
    }, [isConnected]);

    useEffect(() => {
        scanModalVisibleRef.current = scanModalVisible;
    }, [scanModalVisible]);

    useEffect(() => {
        if (route?.params?.autoConnect && !safeResume) {
            setScanModalVisible(true);
            const autoScanTimer = setTimeout(() => {
                handleBluetoothScan();
            }, 700);
            navigation.setParams({ autoConnect: undefined });
            return () => clearTimeout(autoScanTimer);
        }
    }, [navigation, route?.params?.autoConnect, safeResume]);

    useEffect(() => {
        if (!isConnected) return;

        let lastHeartbeat = Date.now();
        const heartbeatInterval = setInterval(() => {
            if (Date.now() - lastHeartbeat > 4000) {
                console.log("[Dashboard] Heatbeat timeout! Disconnecting visibly.");
                clearInterval(heartbeatInterval);
                import('../../BLE_connection/TherapyBle').then(m => m.disconnectDevice());
                
                setIsConnected(false);
                Alert.alert("Disconnected", "The TherapyBand has been disconnected.");
                setMode('Off');
                setIsTimerRunning(false);
                setRemainingSeconds(0);
                if (TherapyTimer) {
                    TherapyTimer.stopTimer();
                    TherapyTimer.turnOffRememberedDevice?.();
                }
            }
        }, 1500);

        // Start monitoring from ESP32
        monitorDeviceStatus(
            (newMode) => {
                lastHeartbeat = Date.now();
                if (Date.now() < ignoreDeviceUpdateUntilRef.current) {
                    return;
                }
                lastModeUpdateSourceRef.current = 'device';
                setMode((prevMode) => {
                    if (prevMode !== newMode) return newMode;
                    return prevMode;
                });
            },
            (newTemp) => {
                lastHeartbeat = Date.now();
                if (isUserAdjustingDialRef.current) {
                    return;
                }
                if (Date.now() < ignoreDeviceUpdateUntilRef.current) {
                    return;
                }
                lastTempUpdateSourceRef.current = 'device';
                setTemp((prevTemp) => {
                    if (prevTemp !== newTemp) return newTemp;
                    return prevTemp;
                });
                
                // Extremely reliable background timer trick: 
                // Any time the ESP32 sends a temperature update (often), we use that hardware-triggered 
                // wake-up to also recalculate and pump our JS timer, preventing it from pausing when backgrounded.
                if (prevIsTimerRunningRef.current && targetTimeRef.current) {
                    const now = Date.now();
                    const rem = Math.round((targetTimeRef.current - now) / 1000);
                    if (rem >= 0 && rem !== lastRemainingSecondsRef.current) {
                        lastRemainingSecondsRef.current = rem;
                        setRemainingSeconds(rem);
                    }
                }
            },
            (newTimerSeconds) => {
                lastHeartbeat = Date.now();
                if (Date.now() < ignoreDeviceUpdateUntilRef.current) {
                    return;
                }
                
                if (newTimerSeconds > 0) {
                    if (prevIsTimerRunningRef.current) {
                        if (targetTimeRef.current) {
                            const now = Date.now();
                            const rem = Math.round((targetTimeRef.current - now) / 1000);
                            
                            // If hardware timer differs from app by > 3s, user likely adjusted it on the physical band
                            if (Math.abs(rem - newTimerSeconds) > 3) {
                                const targetMs = now + newTimerSeconds * 1000;
                                targetTimeRef.current = targetMs;
                                lastRemainingSecondsRef.current = newTimerSeconds;
                                setRemainingSeconds(newTimerSeconds);
                                setTimer(Math.ceil(newTimerSeconds / 60));
                                
                                if (TherapyTimer) {
                                    TherapyTimer.startTimer(newTimerSeconds).catch(e => console.warn('[Timer] startTimer error:', e));
                                }
                                AsyncStorage.setItem('therapy_timer_target', targetMs.toString()).catch(() => {});
                            } else if (rem > 0) {
                                setRemainingSeconds(rem);
                            }
                        }
                        return;
                    }

                    // User just started timer from physical band
                    const targetMs = Date.now() + newTimerSeconds * 1000;
                    targetTimeRef.current = targetMs;
                    lastRemainingSecondsRef.current = newTimerSeconds;
                    setRemainingSeconds(newTimerSeconds);
                    setIsTimerRunning(true);
                    setTimer(Math.ceil(newTimerSeconds / 60));
                    prevIsTimerRunningRef.current = true;
                    
                    if (TherapyTimer) {
                        TherapyTimer.startTimer(newTimerSeconds).catch(e => console.warn('[Timer] startTimer error:', e));
                    }
                    AsyncStorage.setItem('therapy_timer_target', targetMs.toString()).catch(() => {});
                } else {
                    if (isUserAdjustingDialRef.current) return;
                    if (prevIsTimerRunningRef.current) {
                        setIsTimerRunning(false);
                        setRemainingSeconds(0);
                        prevIsTimerRunningRef.current = false;
                        targetTimeRef.current = null;
                        if (timerIntervalRef.current) {
                            clearInterval(timerIntervalRef.current);
                            timerIntervalRef.current = null;
                        }
                        if (TherapyTimer) {
                            TherapyTimer.stopTimer();
                        }
                        AsyncStorage.removeItem('therapy_timer_target').catch(() => {});
                        AsyncStorage.removeItem(SESSION_STATE_KEY).catch(() => {});
                    }
                }
            }
        );
        // Listen for disconnect
        onDeviceDisconnect(() => {
            setIsConnected(false);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            Alert.alert("Disconnected", "The TherapyBand has been disconnected.");
            setMode('Off');
            setIsTimerRunning(false);
            setRemainingSeconds(0);
            if (TherapyTimer) {
                TherapyTimer.stopTimer();
                TherapyTimer.turnOffRememberedDevice?.();
            }
        });

        return () => {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            stopDeviceStatusMonitoring();
        };
    }, [isConnected]);

    // Temperature ranges
    const TEMP_RANGES = {
        Hot: { min: 25, max: 55 },
        Cold: { min: 10, max: 24 },
        Off: { min: 0, max: 0 },
    };

    useEffect(() => {
        const { min, max } = TEMP_RANGES[mode] || TEMP_RANGES.Cold;

        setIsLoading(true);
        Animated.timing(fadeAnim, {
            toValue: 0.5,
            duration: 200,
            useNativeDriver: true,
        }).start();

        if (mode === 'Hot' && temp < min) {
            setTimeout(() => {
                setTemp(min);
                setIsLoading(false);
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }).start();
            }, 300);
        } else if (mode === 'Cold' && temp > max) {
            setTimeout(() => {
                setTemp(max);
                setIsLoading(false);
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }).start();
            }, 300);
        } else {
            setTimeout(() => {
                setIsLoading(false);
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }).start();
            }, 200);
        }
    }, [mode]);

    const prevIsTimerRunningRef = React.useRef(false);

    useEffect(() => {
        if (mode === 'Hot') lastHotTempRef.current = temp;
        if (mode === 'Cold') lastColdTempRef.current = temp;

        if (lastModeUpdateSourceRef.current === 'device' || lastTempUpdateSourceRef.current === 'device') {
            lastModeUpdateSourceRef.current = 'init';
            lastTempUpdateSourceRef.current = 'init';
            return;
        }
        if (lastModeUpdateSourceRef.current === 'init' && lastTempUpdateSourceRef.current === 'init') {
            return;
        }

        if (isUserAdjustingDialRef.current) {
            // Do not send continuous commands to device while user is actively dragging the dial
            return;
        }

        // When changing mode or temp, skip sending the timer characteristic if it is already running
        // so we don't reset the device's own timer.
        sendCommandToDevice(mode, temp, -1); 
    }, [mode, temp]);

    // NOTE: We do NOT send BLE commands here on isTimerRunning change.
    // handleTimerSet and stopTimer each send their own correct command directly.
    // Sending here causes a race: remainingSeconds is still 0 (stale) when isTimerRunning
    // flips to true, which tells the ESP32 to stop — turning off its display.

    useEffect(() => {
        if (!isTimerRunning) {
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
                timerIntervalRef.current = null;
            }
            return;
        }

        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
        }

        // Pure JS local countdown using targetTimeRef — NO async native calls here.
        // This avoids blocking the JS thread (and BLE callbacks) with Promises every tick.
        timerIntervalRef.current = setInterval(() => {
            if (!targetTimeRef.current) return;
            const now = Date.now();
            const remaining = Math.round((targetTimeRef.current - now) / 1000);

            if (remaining <= 0) {
                if (lastRemainingSecondsRef.current !== 0) {
                    lastRemainingSecondsRef.current = 0;
                    setRemainingSeconds(0);
                }
            } else if (remaining !== lastRemainingSecondsRef.current) {
                lastRemainingSecondsRef.current = remaining;
                setRemainingSeconds(remaining);
            }
        }, 500); // 500ms tick so we don't miss the exact second boundary

        return () => {
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
                timerIntervalRef.current = null;
            }
        };
    }, [isTimerRunning]); // NOTE: removed remainingSeconds from deps — prevents interval churn

    const handleTimerSet = async (minutes) => {
        if (mode === 'Off') {
            Alert.alert("Mode Off", "Please select Hot or Cold mode to start the timer.");
            return;
        }
        setTimer(minutes);
        const totalSeconds = Math.max(0, Math.round(minutes * 60));

        // Start native foreground service — pass SECONDS (not minutes)
        // Native service uses: endTime = SystemClock.elapsedRealtime() + durationInMillis
        if (totalSeconds > 0 && TherapyTimer) {
            TherapyTimer.startTimer(totalSeconds).catch(e => console.warn('[Timer] startTimer error:', e));
        }

        // Anchor JS local countdown
        const targetMs = Date.now() + totalSeconds * 1000;
        targetTimeRef.current = targetMs;
        lastRemainingSecondsRef.current = totalSeconds;
        setRemainingSeconds(totalSeconds);
        setIsTimerRunning(totalSeconds > 0);
        prevIsTimerRunningRef.current = (totalSeconds > 0);
        ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;

        // Persist so session survives app kill
        if (totalSeconds > 0) {
            AsyncStorage.setItem('therapy_timer_target', targetMs.toString()).catch(() => {});
            AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify({ mode, temp, timer: minutes })).catch(() => {});
        }

        // Inform hardware — MUST send SECONDS (ESP32 expects seconds, e.g. 120 not 2).
        // Sending minutes meant "2 seconds" to hardware, causing instant shutdown.
        sendCommandToDevice(mode, temp, totalSeconds);
    };

    useEffect(() => {
        if (mode === 'Off' && isTimerRunning) {
            // ESP32 usually turns off slightly before the native alarm rings.
            // If the timer is almost done, do NOT cancel the native timer so the alarm sounds!
            if (lastRemainingSecondsRef.current > 3 && lastRemainingSecondsRef.current !== -1) {
                stopTimer();
            } else {
                setIsTimerRunning(false);
                setRemainingSeconds(0);
                prevIsTimerRunningRef.current = false;
            }
        }
    }, [mode]);

    const stopTimer = () => {
        setIsTimerRunning(false);
        prevIsTimerRunningRef.current = false;
        setRemainingSeconds(0);
        targetTimeRef.current = null;
        ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
        AsyncStorage.removeItem('therapy_timer_target').catch(() => {});
        AsyncStorage.removeItem(SESSION_STATE_KEY).catch(() => {});
        
        if (TherapyTimer) {
            TherapyTimer.stopTimer();
        }
        
        // Also inform the hardware to stop the timer
        sendCommandToDevice(mode, temp, 0); 
    };

    useEffect(() => {
        if (!isTimerRunning || mode === 'Off') return;
        AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify({ mode, temp, timer })).catch(() => {});
    }, [isTimerRunning, mode, temp, timer]);

    useEffect(() => {
        const loadPresets = async () => {
            try {
                const storedPresets = await AsyncStorage.getItem('custom_presets');
                if (storedPresets) {
                    setPresets(JSON.parse(storedPresets));
                }
            } catch (error) {
                console.error("Failed to load presets:", error);
            }
        };
        loadPresets();
    }, []);

    const savePresetsToStorage = async (newPresets) => {
        try {
            await AsyncStorage.setItem('custom_presets', JSON.stringify(newPresets));
        } catch (error) {
            console.error("Failed to save presets:", error);
        }
    };

    const handleSavePresetStart = () => {
        if (presets.length >= 6) {
            Alert.alert("Limit Reached", "You can only save up to 6 custom presets.");
            return;
        }
        setEditingPresetId(null);
        setNewPresetName(`Mode ${presets.length + 1}`);
        setNewPresetIcon('Activity');
        setShowPresetModal(true);
    };

    const handleSavePresetConfirm = () => {
        if (!newPresetName.trim()) {
            Alert.alert("Invalid Name", "Please enter a valid preset name.");
            return;
        }
        
        let updatedPresets;
        if (editingPresetId) {
            updatedPresets = presets.map(p => 
                p.id === editingPresetId ? { ...p, name: newPresetName.trim(), icon: newPresetIcon, mode, temp, timer } : p
            );
        } else {
            const newPreset = {
                id: Date.now().toString(),
                name: newPresetName.trim(),
                icon: newPresetIcon,
                mode,
                temp,
                timer,
            };
            updatedPresets = [...presets, newPreset];
        }
        
        setPresets(updatedPresets);
        savePresetsToStorage(updatedPresets);
        
        setShowPresetModal(false);
        setNewPresetName('');
        setEditingPresetId(null);
    };

    const handlePresetOptions = (preset) => {
        Alert.alert(
            "Preset Options",
            `What would you like to do with ${preset.name}?`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Edit",
                    onPress: () => {
                        setEditingPresetId(preset.id);
                        setNewPresetName(preset.name);
                        setNewPresetIcon(preset.icon || 'Activity');
                        setShowPresetModal(true);
                    }
                },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                        const updatedPresets = presets.filter(p => p.id !== preset.id);
                        setPresets(updatedPresets);
                        savePresetsToStorage(updatedPresets);
                    }
                }
            ]
        );
    };

    const applyPreset = (preset) => {
        if (!isConnected) {
            Alert.alert("Offline", "Please connect to the TherapyBand to use presets.");
            return;
        }
        setActivePresetId(preset.id);
        ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
        lastModeUpdateSourceRef.current = 'user';
        lastTempUpdateSourceRef.current = 'user';
        setMode(preset.mode);
        setTemp(preset.temp);
        if (preset.timer > 0 && preset.mode !== 'Off') {
            setTimer(preset.timer);
            const totalSeconds = Math.max(0, Math.round(preset.timer * 60));
            
            // Start native service with SECONDS (not minutes)
            if (totalSeconds > 0 && TherapyTimer) {
                TherapyTimer.startTimer(totalSeconds).catch(e => console.warn('[Timer] startTimer error:', e));
            }
            
            const targetMs = Date.now() + totalSeconds * 1000;
            targetTimeRef.current = targetMs;
            lastRemainingSecondsRef.current = totalSeconds;
            AsyncStorage.setItem('therapy_timer_target', targetMs.toString()).catch(() => {});
            AsyncStorage.setItem(SESSION_STATE_KEY, JSON.stringify({ mode: preset.mode, temp: preset.temp, timer: preset.timer })).catch(() => {});
            setRemainingSeconds(totalSeconds);
            setIsTimerRunning(totalSeconds > 0);
            prevIsTimerRunningRef.current = (totalSeconds > 0);
            
            // Inform hardware of preset timer (in SECONDS)
            sendCommandToDevice(preset.mode, preset.temp, totalSeconds);
        } else {
            setTimer(preset.timer);
            setRemainingSeconds(0);
            setIsTimerRunning(false);
            AsyncStorage.removeItem(SESSION_STATE_KEY).catch(() => {});
        }
    };

    const TimerDisplay = ({ selectedMinutes, remainingSeconds, isRunning, onPress, onStop }) => {
        const mm = isRunning ? Math.floor(remainingSeconds / 60) : selectedMinutes;
        const ss = isRunning ? remainingSeconds % 60 : 0;
        const displayMinutes = mm < 10 ? `0${mm}` : String(mm);
        const displaySeconds = ss < 10 ? `0${ss}` : String(ss);

        return (
            <View style={styles.timerWrapper}>
                <TouchableOpacity
                    style={[styles.timerContainer, isRunning && styles.timerContainerActive]}
                    onPress={onPress}
                    activeOpacity={0.7}
                >
                    <Clock color={isRunning ? COLORS.primary : 'rgba(255,255,255,0.5)'} size={22} />
                    <Text style={[styles.timerText, isRunning && styles.timerTextActive]}>
                        {displayMinutes}:{displaySeconds}
                    </Text>
                    {!isRunning && <Text style={styles.timerLabel}>min</Text>}
                </TouchableOpacity>
                {isRunning && (
                    <TouchableOpacity
                        style={styles.stopButton}
                        onPress={onStop}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.stopButtonText}>Stop Timer</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    const PresetTimerButton = ({ minutes, onPress, isActive }) => (
        <TouchableOpacity
            style={[styles.presetTimerButton, isActive && styles.presetTimerButtonActive]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <Text style={[styles.presetTimerText, isActive && styles.presetTimerTextActive]}>
                {minutes}m
            </Text>
        </TouchableOpacity>
    );

    const currentRange = TEMP_RANGES[mode] || TEMP_RANGES.Cold;

    const handleBluetoothScan = async () => {
        setScanModalVisible(true);
        autoConnectAttemptedRef.current = false;
        setIsScanning(true);
        try {
            await requestBluetoothPermission();
            scanForDevices((devices) => {
                if (devices && devices.length > 0) {
                    const therapyBand = devices.find(d => 
                        (d.name === "TherapyBand" || d.localName === "TherapyBand")
                    );
                    if (therapyBand) {
                        if (autoConnectAttemptedRef.current) return;
                        autoConnectAttemptedRef.current = true;
                        connectToGivenDevice(therapyBand, async (success) => {
    if (success) {

        try {
            const savedName = await AsyncStorage.getItem('username');

            const nameToSend =
                savedName?.trim() ||
                username ||
                'Guest';

            console.log('Sending username:', nameToSend);

            await new Promise(resolve => setTimeout(resolve, 1000));

            await writeUserName(nameToSend);

            console.log('Username sent successfully');
        }
        catch (err) {
            console.log('Failed to send username:', err);
        }

        setIsConnected(true);
        setIsScanning(false);
        setScanModalVisible(false);

        lastModeUpdateSourceRef.current = 'user';
        lastTempUpdateSourceRef.current = 'user';

        ignoreDeviceUpdateUntilRef.current =
            Date.now() + cooldownDuration;

        setMode('Hot');
        setTemp(lastHotTempRef.current);

    } else {
        autoConnectAttemptedRef.current = false;
        setIsScanning(false);
        setScanModalVisible(false);

        Alert.alert(
            "Connection Failed",
            "Could not connect to TherapyBand."
        );
    }
});
                    } else {
                        // Keep scanning or timeout handled by scanForDevices
                    }
                }
            }, 60000);

            // If not found after 60 seconds
            setTimeout(() => {
                setIsScanning(false);
                if (!isConnectedRef.current && scanModalVisibleRef.current) {
                    setScanModalVisible(false);
                    Alert.alert("Device Not Found", "Please ensure band is turned on.");
                }
            }, 60500);

        } catch (err) {
            console.error("Scan error:", err);
            setScanModalVisible(false);
        }
    };

    const handleDialInteractionStart = () => {
        isUserAdjustingDialRef.current = true;
        ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
    };

    const handleDialInteractionEnd = () => {
        isUserAdjustingDialRef.current = false;
        // Reset immediately so ESP32 temp updates flow through right after user lifts finger.
        // (Cooldown was already started in handleDialInteractionStart — extending it here
        //  was blocking all ESP32 temperature notifications for 5s after every touch.)
        ignoreDeviceUpdateUntilRef.current = 0;
        lastTempUpdateSourceRef.current = 'user';
        // Send -1 to preserve the hardware timer's current active countdown seamlessly
        sendCommandToDevice(mode, temp, -1);
    };

    const lastSentTimeRef = React.useRef(0);

    const handleTempChangeFromDial = (newTemp) => {
        if (!isConnected) return;
        lastTempUpdateSourceRef.current = 'user';
        setTemp(newTemp);
        
        // INSTANT FEEDBACK: send update every 150ms while dragging
        const now = Date.now();
        if (now - lastSentTimeRef.current > 150) {
            sendCommandToDevice(mode, newTemp, -1);
            lastSentTimeRef.current = now;
        }
    };

    const getPresetIcon = (iconName, color) => {
        const props = { color, size: 28, strokeWidth: 2 };
        switch(iconName) {
            case 'Dumbbell': return <Dumbbell {...props} />;
            case 'Zap': return <Zap {...props} />;
            case 'Flower': return <Flower {...props} />;
            case 'Droplet': return <Droplet {...props} />;
            case 'Star': return <Star {...props} />;
            case 'Heart': return <Heart {...props} />;
            case 'Flame': return <Flame {...props} />;
            case 'Snowflake': return <Snowflake {...props} />;
            default: return <Activity {...props} />;
        }
    };

    const ICON_OPTIONS = ['Activity', 'Dumbbell', 'Zap', 'Flower', 'Droplet', 'Star', 'Heart', 'Flame'];

    return (
        <GradientBackground mode={mode}>
            <SafeAreaView style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity 
                        style={styles.powerButton}
                        onPress={() => {
                            if (!isConnected) return;
                            lastModeUpdateSourceRef.current = 'user';
                            ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
                            setMode('Off');
                        }}
                    >
                        <Power color={mode === 'Off' ? COLORS.off : (mode === 'Cold' ? COLORS.cold : COLORS.hot)} size={24} />
                    </TouchableOpacity>
                    
                    <View style={styles.headerCenter}>
                        <Text style={styles.greetingHeader}>HELLO, {username.toUpperCase()}</Text>
                        <TouchableOpacity onPress={() => !isConnected && handleBluetoothScan()}>
                            <Text style={[styles.connStatus, { color: isConnected ? COLORS.success : COLORS.danger }]}>
                                ● {isConnected ? 'CONNECTED' : 'OFFLINE'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    
                    <TouchableOpacity style={styles.settingsButton} onPress={() => navigation.navigate('Profile', { username, deviceName })}>
                        <Settings color={mode === 'Cold' ? COLORS.cold : COLORS.hot} size={24} />
                    </TouchableOpacity>
                </View>

                {/* Custom Preset Section — right after header */}
                <View style={styles.presetSection}>
                    <View style={styles.presetSectionHeader}>
                        <Text style={styles.presetSectionTitle}>CUSTOM PRESETS</Text>
                        <TouchableOpacity onPress={handleSavePresetStart}>
                            <Text style={styles.addPresetBtn}>+ ADD NEW</Text>
                        </TouchableOpacity>
                    </View>
                    
                    <ScrollView style={styles.presetGridScroll} contentContainerStyle={styles.presetGrid} showsVerticalScrollIndicator={false} horizontal={false}>
                        {presets.map((preset) => {
                            const isActive = activePresetId === preset.id;
                            const glowColor = preset.mode === 'Hot' ? COLORS.hot : COLORS.cold;
                            return (
                                <TouchableOpacity
                                    key={preset.id}
                                    style={[
                                        styles.presetGridItem,
                                        preset.mode === 'Hot' ? styles.presetGridItemHot : styles.presetGridItemCold,
                                        isActive && {
                                            borderColor: glowColor,
                                            borderWidth: 1.5,
                                        },
                                        !isConnected && { opacity: 0.5 }
                                    ]}
                                    onPress={() => applyPreset(preset)}
                                    onLongPress={() => handlePresetOptions(preset)}
                                >
                                    {getPresetIcon(preset.icon || 'Activity', isActive ? glowColor : (preset.mode === 'Hot' ? COLORS.hot : COLORS.cold))}
                                    <Text style={[styles.presetGridItemText, isActive && { color: glowColor }]} numberOfLines={1}>{preset.name}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* Dial Section — centered, pushed down */}
                <Animated.View style={[styles.dialWrapper, { opacity: fadeAnim }]}>
                    {isLoading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="rgba(255,255,255,0.5)" />
                        </View>
                    ) : (
                        <TemperatureDial
                            value={temp}
                            min={currentRange.min}
                            max={currentRange.max}
                            onChange={handleTempChangeFromDial}
                            mode={mode}
                            isTimerRunning={isTimerRunning}
                            timerValue={`${Math.floor(remainingSeconds / 60) < 10 ? '0' : ''}${Math.floor(remainingSeconds / 60)}:${remainingSeconds % 60 < 10 ? '0' : ''}${remainingSeconds % 60}`}
                            onTimerPress={() => {
                                if (!isConnected) { Alert.alert("Offline", "Connect first."); return; }
                                if (isTimerRunning) stopTimer(); else setShowTimerModal(true);
                            }}
                            onInteractionStart={() => {
                                if (!isConnected) { Alert.alert("Offline", "Connect first."); }
                                handleDialInteractionStart();
                            }}
                            onInteractionEnd={handleDialInteractionEnd}
                        />
                    )}
                </Animated.View>

                {/* Bottom Navigation — Hot / Cold */}
                <View style={styles.bottomBar}>
                    <TouchableOpacity 
                        style={[styles.bottomBarItem, !isConnected && { opacity: 0.5 }]}
                        onPress={() => {
                            if (!isConnected) { Alert.alert("Offline", "Connect first."); return; }
                            lastModeUpdateSourceRef.current = 'user';
                            lastTempUpdateSourceRef.current = 'user';
                            ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
                            setMode('Hot');
                            setTemp(lastHotTempRef.current);
                        }}
                    >
                        <View style={[
                            styles.bottomBarGlowRing,
                            {
                                borderColor: mode === 'Hot' ? 'rgba(255, 140, 50, 0.7)' : (mode === 'Off' ? 'rgba(255, 160, 80, 0.35)' : 'rgba(200, 100, 30, 0.25)'),
                                backgroundColor: mode === 'Hot' ? 'rgba(255, 120, 40, 0.12)' : (mode === 'Off' ? 'rgba(255, 140, 60, 0.06)' : 'transparent'),
                                shadowColor: mode === 'Hot' ? '#FF8C32' : (mode === 'Off' ? '#FF8C32' : 'transparent'),
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: mode === 'Hot' ? 0.5 : (mode === 'Off' ? 0.2 : 0),
                                shadowRadius: mode === 'Hot' ? 12 : (mode === 'Off' ? 8 : 0),
                                elevation: mode === 'Hot' ? 8 : (mode === 'Off' ? 3 : 0),
                            },
                        ]}>
                            <View style={[
                                styles.bottomBarIconWrapper, 
                                mode === 'Hot' && styles.bottomBarIconActiveHot,
                            ]}>
                                <Animated.View style={{ transform: [{ scale: mode === 'Hot' ? flameAnim : 1 }] }}>
                                    <Flame color={mode === 'Hot' ? '#FFF0E0' : '#C88A5A'} size={28} />
                                </Animated.View>
                            </View>
                        </View>
                        <Text style={[styles.bottomBarLabel, mode === 'Hot' ? {color: COLORS.hot} : {color: COLORS.outline}]}>HOT</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.bottomBarItem, !isConnected && { opacity: 0.5 }]}
                        onPress={() => {
                            if (!isConnected) { Alert.alert("Offline", "Connect first."); return; }
                            lastModeUpdateSourceRef.current = 'user';
                            lastTempUpdateSourceRef.current = 'user';
                            ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
                            setMode('Cold');
                            setTemp(lastColdTempRef.current);
                        }}
                    >
                        <View style={[
                            styles.bottomBarGlowRing,
                            {
                                borderColor: mode === 'Cold' ? 'rgba(0, 200, 165, 0.7)' : (mode === 'Off' ? 'rgba(0, 200, 165, 0.35)' : 'rgba(0, 170, 140, 0.25)'),
                                backgroundColor: mode === 'Cold' ? 'rgba(0, 190, 155, 0.12)' : (mode === 'Off' ? 'rgba(0, 190, 155, 0.06)' : 'transparent'),
                                shadowColor: mode === 'Cold' ? '#00C8A5' : (mode === 'Off' ? '#00C8A5' : 'transparent'),
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: mode === 'Cold' ? 0.5 : (mode === 'Off' ? 0.2 : 0),
                                shadowRadius: mode === 'Cold' ? 12 : (mode === 'Off' ? 8 : 0),
                                elevation: mode === 'Cold' ? 8 : (mode === 'Off' ? 3 : 0),
                            },
                        ]}>
                            <View style={[
                                styles.bottomBarIconWrapper, 
                                mode === 'Cold' && styles.bottomBarIconActiveCold,
                            ]}>
                                <Animated.View style={{ transform: [{ scale: mode === 'Cold' ? frostAnim : 1 }] }}>
                                    <Snowflake color={mode === 'Cold' ? '#0C0500' : COLORS.outline} size={28} />
                                </Animated.View>
                            </View>
                        </View>
                        <Text style={[styles.bottomBarLabel, mode === 'Cold' ? {color: COLORS.cold} : {color: COLORS.outline}]}>COLD</Text>
                    </TouchableOpacity>
                </View>

            </SafeAreaView>

            {/* Timer Modal */}
            <WheelTimer
                visible={showTimerModal}
                value={timer}
                onClose={() => setShowTimerModal(false)}
                onSave={(val) => {
                    ignoreDeviceUpdateUntilRef.current = Date.now() + cooldownDuration;
                    lastModeUpdateSourceRef.current = 'user';
                    handleTimerSet(val);
                    setShowTimerModal(false);
                }}
            />

            {/* Scanning Modal */}
            <Modal visible={scanModalVisible} transparent animationType="fade" onRequestClose={() => setScanModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { alignItems: 'center', paddingVertical: 40 }]}>
                        <ActivityIndicator size="large" color={mode === 'Cold' ? COLORS.cold : COLORS.hot} />
                        <Text style={[styles.modalTitle, { marginTop: 20 }]}>Scanning...</Text>
                        <Text style={styles.modalSubtitle}>Press any button on your band to wake it up!</Text>
                        <TouchableOpacity style={[styles.saveBtn, { marginTop: 20, backgroundColor: 'rgba(255,255,255,0.1)' }]} onPress={() => setScanModalVisible(false)}>
                            <Text style={styles.saveBtnText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Icon Selection Preset Modal */}
            <Modal visible={showPresetModal} transparent animationType="slide" onRequestClose={() => setShowPresetModal(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                    <Pressable style={styles.modalOverlay} onPress={() => setShowPresetModal(false)}>
                        <Pressable style={styles.presetModalContent} onPress={(e) => e.stopPropagation()}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>New Preset</Text>
                                <TouchableOpacity hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }} onPress={() => setShowPresetModal(false)}>
                                    <X color="rgba(255,255,255,0.6)" size={24} />
                                </TouchableOpacity>
                            </View>
                            
                            <Text style={styles.modalLabelName}>PRESET NAME</Text>
                            <TextInput
                                style={styles.input}
                                value={newPresetName}
                                onChangeText={setNewPresetName}
                                placeholder="e.g. Morning Routine"
                                placeholderTextColor="rgba(255,255,255,0.3)"
                                maxLength={16}
                            />

                            <Text style={[styles.modalLabelName, { marginTop: 15 }]}>SELECT ICON</Text>
                            <View style={styles.iconGrid}>
                                {ICON_OPTIONS.map(icon => (
                                    <TouchableOpacity 
                                        key={icon}
                                        style={[
                                            styles.iconBtn,
                                            newPresetIcon === icon && { borderColor: mode === 'Cold' ? COLORS.cold : COLORS.hot }
                                        ]}
                                        onPress={() => setNewPresetIcon(icon)}
                                    >
                                        {getPresetIcon(icon, newPresetIcon === icon ? (mode === 'Cold' ? COLORS.cold : COLORS.hot) : COLORS.outline)}
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <TouchableOpacity
                                style={[styles.saveBtn, { backgroundColor: mode === 'Cold' ? COLORS.cold : COLORS.hot }, !newPresetName.trim() && { opacity: 0.5 }]}
                                onPress={handleSavePresetConfirm}
                                disabled={!newPresetName.trim()}
                            >
                                <Text style={styles.saveBtnText}>SAVE PRESET</Text>
                            </TouchableOpacity>
                        </Pressable>
                    </Pressable>
                </KeyboardAvoidingView>
            </Modal>
        </GradientBackground>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: SPACING.lg,
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 10 : 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    powerButton: {
        padding: 10,
        backgroundColor: COLORS.cardBackgroundHigh,
        borderRadius: 24,
    },
    headerCenter: {
        alignItems: 'center',
    },
    greetingHeader: {
        fontSize: 14,
        fontWeight: 'bold',
        color: COLORS.text,
        letterSpacing: 2,
    },
    connStatus: {
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 1,
        marginTop: 2,
    },
    settingsButton: {
        padding: 10,
        backgroundColor: COLORS.cardBackgroundHigh,
        borderRadius: 24,
    },
    modeContainer: {
        alignItems: 'center',
        marginVertical: 10,
    },
    modePill: {
        flexDirection: 'row',
        backgroundColor: COLORS.cardBackgroundHigh,
        borderRadius: 30,
        padding: 4,
        width: 240,
    },
    modeTab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 26,
    },
    hotTabActive: {
        backgroundColor: COLORS.hot,
    },
    coldTabActive: {
        backgroundColor: COLORS.cold,
    },
    modeTabText: {
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    dialWrapper: {
        alignItems: 'center',
        justifyContent: 'flex-end',
        flex: 1,
        alignSelf: 'center',
        width: '100%',
        paddingBottom: 20,
    },
    loadingContainer: {
        paddingVertical: 40,
    },
    programCardWrapper: {
        paddingHorizontal: 0,
        marginVertical: 0,
    },
    programCard: {
        backgroundColor: COLORS.surfaceContainer,
        borderLeftWidth: 4,
        borderLeftColor: COLORS.hot, 
        borderRadius: 8,
        padding: 16,
    },
    programLabel: {
        fontSize: 10,
        fontWeight: 'bold',
        color: COLORS.hot,
        letterSpacing: 1,
    },
    programTitle: {
        fontSize: 18,
        color: COLORS.text,
        fontWeight: 'bold',
        marginTop: 6,
    },
    programDesc: {
        fontSize: 12,
        color: COLORS.outline,
        marginTop: 4,
    },
    presetSection: {
        marginTop: 8,
        marginBottom: 8,
        maxHeight: 220,
    },
    presetSectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    presetSectionTitle: {
        fontSize: 10,
        color: COLORS.outline,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    addPresetBtn: {
        fontSize: 10,
        color: COLORS.text,
        letterSpacing: 1,
    },
    presetGridScroll: {
        flexGrow: 0,
    },
    presetGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        paddingBottom: 4,
    },
    presetGridItem: {
        width: '48%',
        backgroundColor: COLORS.cardBackgroundHigh,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    presetGridItemHot: {
        borderColor: 'rgba(255, 122, 32, 0.3)',
        shadowColor: '#FF7A20',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    presetGridItemCold: {
        borderColor: 'rgba(0, 229, 188, 0.3)',
        shadowColor: '#00E5BC',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    presetGridItemText: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 10,
        flex: 1,
    },
    bottomBar: {
        flexDirection: 'row',
        backgroundColor: COLORS.backgroundEnd,
        borderTopWidth: 1,
        borderTopColor: COLORS.surfaceContainer,
        borderRadius: 28,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginBottom: 16,
        marginTop: 10,
        justifyContent: 'space-around',
    },
    bottomBarItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    bottomBarLabel: {
        fontSize: 14,
        fontWeight: 'bold',
        marginLeft: 10,
    },
    bottomBarGlowRing: {
        width: 58,
        height: 58,
        borderRadius: 29,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomBarIconWrapper: {
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.cardBackgroundHigh,
    },
    bottomBarIconActiveHot: {
        backgroundColor: '#E06A10',
        shadowColor: '#FF8C32',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 10,
        elevation: 8,
    },
    bottomBarIconActiveCold: {
        backgroundColor: '#009E80',
        shadowColor: '#00C8A5',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 10,
        elevation: 8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(12, 5, 0, 0.8)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: COLORS.backgroundEnd,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
    },
    presetModalContent: {
        backgroundColor: COLORS.backgroundEnd,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 40,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: COLORS.text,
    },
    modalSubtitle: {
        fontSize: 14,
        color: COLORS.outline,
        marginBottom: 12,
    },
    modalLabelName: {
        fontSize: 10,
        color: COLORS.outline,
        fontWeight: 'bold',
        letterSpacing: 2,
    },
    input: {
        backgroundColor: COLORS.cardBackgroundHigh,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 16,
        color: COLORS.text,
        fontSize: 16,
        marginTop: 10,
        borderWidth: 1,
        borderColor: COLORS.surfaceContainerHighest,
    },
    iconGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        marginTop: 10,
        marginBottom: 20,
        gap: 12,
    },
    iconBtn: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: COLORS.surfaceContainerHighest,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    iconBtnActive: {
        borderColor: COLORS.hot,
    },
    saveBtn: {
        backgroundColor: COLORS.hot,
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 10,
    },
    saveBtnText: {
        color: '#1b1205',
        fontSize: 14,
        fontWeight: 'bold',
        letterSpacing: 2,
    }
});

export default DashboardScreen;
